import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { config } from '../../config/index.js';
import { CATEGORY_DEFAULT_MODULES } from '../registry/index.js';
import { BusinessCategory, UserRole } from '../../types/index.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { backupThenWipe, computeStatus, confirmPasswordReset, deactivateInstallation, joinIfAccountLicensed, markAccountTakenOver, registerCustomer, rememberAccount, requestPasswordReset, serverSignIn } from '../../licensing/licenseClient.js';
import { emitLicenseChanged } from '../../licensing/events.js';
import { syncNow } from '../../sync/syncEngine.js';
import { getBusinessSettings } from '../../services/settingsService.js';
import { suggestionsFor } from '../catalog/categorySuggestions.js';
import { logAudit } from '../../services/auditService.js';
import { currentShopId, listShops, runInShop, setActiveShop, shopExists, shopForNewBusiness, shopsWithUser } from '../../db/shops.js';

const businessName = (shop: string) => listShops().find((s) => s.id === shop)?.name || 'another business';

// Brute-force protection: 10 failed attempts per email+IP per 15 minutes.
const failedLogins = new Map<string, { count: number; first: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED = 10;

function loginKey(req: Request, email: string) {
  return `${String(email).toLowerCase()}|${req.ip}`;
}
function isLocked(key: string) {
  const e = failedLogins.get(key);
  if (!e) return false;
  if (Date.now() - e.first > LOGIN_WINDOW_MS) {
    failedLogins.delete(key);
    return false;
  }
  return e.count >= MAX_FAILED;
}
function recordFailure(key: string) {
  const e = failedLogins.get(key);
  if (!e || Date.now() - e.first > LOGIN_WINDOW_MS) failedLogins.set(key, { count: 1, first: Date.now() });
  else e.count += 1;
}

/**
 * Sign-in on a computer with several businesses: the email (and password) finds the business. If the same sign-in
 * works for more than one (a staff member of two shops), the screen asks which one (shopId).
 */
export function login(req: Request, res: Response): void {
  const { email, password, shopId } = req.body;
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Email and password are required' });
    return;
  }
  const key = loginKey(req, email);
  if (isLocked(key)) {
    res.status(429).json({ code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed login attempts. Try again in 15 minutes.' });
    return;
  }

  const candidates = typeof shopId === 'string' && shopExists(shopId) ? [shopId] : shopsWithUser(email);
  const matches = candidates.filter((shop) => runInShop(shop, () => {
    const row = db.prepare('SELECT password_hash FROM users WHERE LOWER(email) = LOWER(?)').get(email) as { password_hash: string } | undefined;
    return !!row && bcrypt.compareSync(password, row.password_hash);
  }));
  if (matches.length > 1) {
    res.status(409).json({ code: 'CHOOSE_BUSINESS', message: 'This sign-in opens more than one business. Choose one.',
      details: { businesses: matches.map((id) => ({ id, name: businessName(id) })) } });
    return;
  }
  const shop = matches[0] ?? candidates[0];
  // Not on this computer: an account made on another computer (a licence for more than one device) opens from the
  // vendor's server
  if (!shop && config.singleTenant && config.licensing.enforce) {
    void openFromServer(req, res, key, String(email).trim().toLowerCase(), password);
    return;
  }
  if (!shop) {
    recordFailure(key);
    res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    return;
  }
  // The business is here but not connected to a licence: its account's licence is used (no trial screen)
  if (config.singleTenant && config.licensing.enforce && matches.includes(shop)) {
    void runInShop(shop, async () => {
      const join = await joinIfAccountLicensed(email, password);
      if (join.joined) await takeOverAccountData(email, password);
      loginToShop(req, res, key, email, password, join.code ? { licenseJoin: { code: join.code, message: join.message } } : {});
    }).catch((err) => {
      if (!res.headersSent) res.status(500).json({ code: 'SIGN_IN_FAILED', message: err?.message || 'Could not sign in' });
    });
    return;
  }
  runInShop(shop, () => loginToShop(req, res, key, email, password));
}

const CATEGORIES = ['RESTAURANT', 'GROCERY', 'CLOTHING', 'WHOLESALE', 'SERVICE', 'MANUFACTURING', 'PHARMACY', 'SCHOOL'];

/**
 * The account was made on another computer: the vendor's server checks the password, this computer is activated as
 * one more device on its licence, and the business and its owner are set up here (in a business file of their own).
 * Bills and stock are not copied: each computer keeps its own (a backup from the other computer can be restored).
 * Details the server does not have (older accounts: state, category) are asked for first (ACCOUNT_DETAILS_NEEDED).
 */
async function openFromServer(req: Request, res: Response, key: string, email: string, password: string): Promise<void> {
  try {
    const check = await serverSignIn(email, password, false);
    if (!check) {
      recordFailure(key);
      res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
      return;
    }
    const given = req.body?.details || {};
    const profile = { ...check.profile };
    if (typeof given.state === 'string' && given.state.trim()) profile.state = given.state.trim();
    if (CATEGORIES.includes(given.category)) profile.category = given.category;
    const category = CATEGORIES.includes(String(profile.category)) ? String(profile.category) : '';
    const needs = [!category && 'category', !profile.state && 'state'].filter(Boolean);
    if (needs.length) {
      res.status(409).json({ code: 'ACCOUNT_DETAILS_NEEDED', message: `Setting up ${profile.businessName} on this computer`,
        details: { needs, businessName: profile.businessName } });
      return;
    }
    const shop = shopForNewBusiness();
    await runInShop(shop, async () => {
      const opened = await serverSignIn(email, password, true);
      if (!opened) throw Object.assign(new Error('Invalid email or password'), { status: 401, code: 'INVALID_CREDENTIALS' });
      const { userId, businessId } = createBusinessWithOwner({
        ownerName: profile.ownerName || 'Owner', email, passwordHash: bcrypt.hashSync(password, 10), businessName: profile.businessName,
        category, phone: profile.phone, gstin: profile.gstin, city: profile.city, state: String(profile.state),
      });
      rememberAccount(userId, email, password, 'LOGIN', true); // the server has it already
      markAccountTakenOver(opened.accountRev ?? 0);
      logAudit({ businessId, userId, action: 'ACCOUNT_OPENED_ON_THIS_COMPUTER', entityType: 'USER', entityId: userId });
      await takeOverAccountData(email, password);
      loginToShop(req, res, key, email, password, { newOnThisComputer: true });
    });
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(err?.status || 502).json({ code: err?.code || 'SIGN_IN_FAILED', message: err?.message || 'Could not sign in' });
    }
  }
}

/**
 * This computer just joined the account's licence: its shared data (products, bills, customers, staff, …) comes over
 * now, before the dashboard opens. The password the vendor's server just accepted is the owner's password here too.
 */
async function takeOverAccountData(email: string, password: string) {
  await syncNow({ quiet: true, timeoutMs: 45_000 });
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE LOWER(email) = LOWER(?) AND role = 'BUSINESS_OWNER'")
    .run(bcrypt.hashSync(password, 10), email);
}

function loginToShop(req: Request, res: Response, key: string, email: string, password: string, extra: Record<string, unknown> = {}): void {
  const user = db.prepare(`
    SELECT u.*, b.name as business_name, b.category as business_category, b.status as business_status, b.plan_id
    FROM users u
    LEFT JOIN businesses b ON u.business_id = b.id
    WHERE LOWER(u.email) = LOWER(?)
  `).get(email) as any;

  if (!user) {
    recordFailure(key);
    res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    return;
  }

  if (user.status !== 'ACTIVE') {
    res.status(403).json({ code: 'ACCOUNT_SUSPENDED', message: 'User account is suspended' });
    return;
  }

  if (user.business_id && user.business_status !== 'ACTIVE') {
    res.status(403).json({ code: 'BUSINESS_SUSPENDED', message: 'Business account is suspended. Contact admin.' });
    return;
  }

  const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordValid) {
    recordFailure(key);
    res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    return;
  }

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      businessId: user.business_id,
      shopId: currentShopId(),
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as any }
  );
  failedLogins.delete(key);
  setActiveShop(currentShopId());
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  if (user.role === 'BUSINESS_OWNER') rememberAccount(user.id, user.email, password, 'LOGIN');
  logAudit({ businessId: user.business_id, userId: user.id, action: 'USER_LOGIN', entityType: 'USER', entityId: user.id });

  const activeModules = user.business_category 
    ? (CATEGORY_DEFAULT_MODULES[user.business_category as BusinessCategory] || ['pos_billing', 'products', 'inventory', 'customers', 'invoices'])
    : [];

  res.json({
    ...extra,
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      businessId: user.business_id,
      businessName: user.business_name,
      businessCategory: user.business_category,
      planId: user.plan_id,
      shopId: currentShopId(),
      activeModules,
    },
  });
}

/**
 * Sign-up. On a computer that already has a business this adds another one, in its own database file, with its own
 * licence (a separate customer for the vendor). Each business needs its own sign-in email.
 */
export function registerBusiness(req: Request, res: Response): void {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (email && config.singleTenant) {
    const taken = shopsWithUser(email);
    if (taken.length) {
      res.status(409).json({ code: 'EMAIL_EXISTS', message: `${email} already signs in to ${businessName(taken[0])} on this computer. `
        + 'Sign in with it, or use a different email for the new business (Gmail tip: yourname+shop2@gmail.com arrives in the same inbox).' });
      return;
    }
  }
  // Signing up again with an account that already exists (made on another computer, with this password): it is opened
  // here as that account, on its licence, instead of a second business that would only be offered a trial
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (email && password && config.singleTenant && config.licensing.enforce) {
    void (async () => {
      try {
        if (await serverSignIn(email.toLowerCase(), password, false)) {
          req.body.details = { state: req.body.state, category: req.body.category };
          await openFromServer(req, res, loginKey(req, email), email.toLowerCase(), password);
          return;
        }
      } catch (err: any) {
        // The account exists but cannot be used here: say why rather than set up a business that cannot be licensed
        if (['DEVICE_LIMIT_REACHED', 'ACTIVATION_LIMIT_REACHED', 'CUSTOMER_SUSPENDED', 'NO_ACTIVE_LICENSE'].includes(err?.code)) {
          res.status(err.status || 409).json({ code: err.code, message: err.message });
          return;
        }
        // Offline, or the account is not on the server yet: set up here as before
      }
      runInShop(shopForNewBusiness(), () => registerInShop(req, res));
    })();
    return;
  }
  // The desktop app: a new business gets its own file. (The multi-business server mode keeps one database.)
  const shop = config.singleTenant ? shopForNewBusiness() : currentShopId();
  runInShop(shop, () => registerInShop(req, res));
}

function registerInShop(req: Request, res: Response): void {
  const {
    ownerName,
    email,
    password,
    businessName,
    category,
    phone,
    gstin,
    city,
    state,
  } = req.body;

  if (!ownerName || !email || !password || !businessName || !category) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Missing required onboarding fields' });
    return;
  }
  if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(String(gstin).trim().toUpperCase())) {
    res.status(400).json({ code: 'INVALID_GSTIN', message: 'GSTIN format is invalid (expected e.g. 27AABCT1234A1Z5)' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters' });
    return;
  }
  // First run creates the owner account before any license step (the app then asks for a trial or key);
  // every other write stays blocked until one is active. Expired, suspended or tampered installs cannot register.
  const license = computeStatus();
  if (license.enforced && !license.canWrite && license.mode !== 'UNLICENSED') {
    res.status(402).json({ code: `LICENSE_${license.mode}`, message: license.message });
    return;
  }
  if (!state || typeof state !== 'string') {
    res.status(400).json({ code: 'STATE_REQUIRED', message: 'Select the state where the business is registered (needed for correct GST)' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
  if (existing) {
    res.status(409).json({ code: 'EMAIL_EXISTS', message: 'An account with this email already exists' });
    return;
  }

  const validCategories: BusinessCategory[] = [
    'RESTAURANT', 'GROCERY', 'CLOTHING', 'WHOLESALE', 'SERVICE', 'MANUFACTURING', 'PHARMACY', 'SCHOOL'
  ];

  if (!validCategories.includes(category)) {
    res.status(400).json({ code: 'INVALID_CATEGORY', message: 'Invalid business category selected' });
    return;
  }

  try {
    const { businessId, userId } = createBusinessWithOwner({ ownerName, email, passwordHash: bcrypt.hashSync(password, 10), businessName, category, phone, gstin, city, state });

    const token = jwt.sign(
      { userId, email, role: 'BUSINESS_OWNER', businessId, shopId: currentShopId() },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    const activeModules = CATEGORY_DEFAULT_MODULES[category as BusinessCategory] || [];

    // The vendor sees the new customer at once and can issue a licence key (in the background; retried at start-up)
    void registerCustomer({ name: ownerName, businessName, email, phone, category }).catch(() => {});
    rememberAccount(userId, email, password, 'SIGNUP');
    setActiveShop(currentShopId());

    res.status(201).json({
      message: 'Business registered successfully',
      token,
      user: {
        id: userId,
        name: ownerName,
        email,
        role: 'BUSINESS_OWNER',
        businessId,
        businessName,
        businessCategory: category,
        planId: 'plan_pro',
        shopId: currentShopId(),
        activeModules,
      },
    });
  } catch (err: any) {
    console.error('Registration failed:', err);
    res.status(500).json({ code: 'REGISTRATION_FAILED', message: err.message || 'Failed to create business' });
  }
}

/** Creates a business and its owner in the current business file (a sign-up, or an account opened from the server) */
export function createBusinessWithOwner(f: {
  ownerName: string; email: string; passwordHash: string; businessName: string; category: string;
  phone?: string | null; gstin?: string | null; city?: string | null; state: string;
}): { businessId: string; userId: string } {
  const { ownerName, email, passwordHash, businessName, category, phone, gstin, city, state } = f;
  const businessId = `biz_${uuidv4().substring(0, 8)}`;
  const userId = uuidv4();
  const prefix = businessName.substring(0, 3).toUpperCase() + '-';

  const transaction = db.transaction(() => {
    // 1. Create Business
    db.prepare(`
      INSERT INTO businesses (id, name, category, gstin, phone, email, city, state, plan_id, status, invoice_prefix, next_invoice_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plan_pro', 'ACTIVE', ?, 1001)
    `).run(
      businessId,
      businessName,
      category,
      gstin || null,
      phone || null,
      email,
      city || null,
      state,
      prefix
    );

    // 2. Create Owner User
    db.prepare(`
      INSERT INTO users (id, business_id, name, email, password_hash, role, status)
      VALUES (?, ?, ?, ?, ?, 'BUSINESS_OWNER', 'ACTIVE')
    `).run(userId, businessId, ownerName, email, passwordHash);

    // 3. Create Default Category
    const defaultCatId = uuidv4();
    db.prepare(`
      INSERT INTO categories (id, business_id, name, description)
      VALUES (?, ?, 'General Products', 'Default category for initial products')
    `).run(defaultCatId, businessId);
    // ...and the categories that fit this kind of business (more can be added from the product form)
    const addCategory = db.prepare('INSERT INTO categories (id, business_id, name, description) VALUES (?, ?, ?, ?)');
    for (const name of suggestionsFor(category)) addCategory.run(uuidv4(), businessId, name, '');

    // 4. Create sample product based on category
    let sampleProdName = 'Sample Product 1';
    let sampleUnit = 'pcs';
    let sampleHsn = '9988';
    let sampleTax = 18;

    if (category === 'RESTAURANT') {
      sampleProdName = 'Special Thali Meal';
      sampleUnit = 'portion';
      sampleHsn = '9963';
      sampleTax = 5;
    } else if (category === 'PHARMACY') {
      sampleProdName = 'Multivitamin Syrup 200ml';
      sampleUnit = 'bottle';
      sampleHsn = '3004';
      sampleTax = 12;
    } else if (category === 'GROCERY') {
      sampleProdName = 'Basmati Premium Rice 1kg';
      sampleUnit = 'kg';
      sampleHsn = '1006';
      sampleTax = 0;
    }

    if (config.demoMode) {
      db.prepare(`
        INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise, tax_rate, stock_quantity, low_stock_threshold)
        VALUES (?, ?, ?, ?, 'SKU-001', '890000000001', ?, ?, 10000, 15000, 18000, ?, 50, 10)
      `).run(uuidv4(), businessId, defaultCatId, sampleProdName, sampleUnit, sampleHsn, sampleTax);
    }
    if (category === 'SERVICE' || category === 'SCHOOL') {
      db.prepare('UPDATE products SET track_stock = 0 WHERE business_id = ?').run(businessId);
    }
  });
  transaction();
  return { businessId, userId };
}

// ---- Forgot password: a code sent to the sign-in email by the vendor's server, then a new password

type ResetUser = { id: string; business_id: string | null; email: string; role: string; status: string };

function userByEmail(email: string): ResetUser | null {
  return (db.prepare('SELECT id, business_id, email, role, status FROM users WHERE LOWER(email) = LOWER(?)').get(email.trim()) as ResetUser | undefined) ?? null;
}

/** Runs `fn` in the business where this email signs in (its owner first) */
function withResetUser<T>(email: unknown, fn: (user: ResetUser | null) => T): T {
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) return fn(null);
  const shops = shopsWithUser(email.trim());
  const owner = shops.find((shop) => runInShop(shop, () => userByEmail(email)?.role === 'BUSINESS_OWNER'));
  const shop = owner ?? shops[0];
  return shop ? runInShop(shop, () => fn(userByEmail(email))) : fn(null);
}

export function forgotPassword(req: Request, res: Response): Promise<void> {
  return withResetUser(req.body?.email, (user) => sendResetCode(res, user));
}

async function sendResetCode(res: Response, user: ResetUser | null): Promise<void> {
  if (!user) {
    res.status(404).json({ code: 'NO_ACCOUNT', message: 'No account on this computer uses this email. Check the email you signed up with.' });
    return;
  }
  if (user.role !== 'BUSINESS_OWNER') {
    res.status(403).json({ code: 'ASK_OWNER', message: 'Ask the shop owner to set a new password for you.' });
    return;
  }
  try {
    const { minutes } = await requestPasswordReset(user.email.toLowerCase());
    res.json({ ok: true, minutes });
  } catch (err: any) {
    res.status(err?.status || 502).json({ code: err?.code || 'RESET_FAILED', message: err?.message || 'Could not send the code' });
  }
}

export function resetPassword(req: Request, res: Response): Promise<void> {
  return withResetUser(req.body?.email, (user) => setNewPassword(req, res, user));
}

async function setNewPassword(req: Request, res: Response, user: ResetUser | null): Promise<void> {
  const { code, password } = req.body || {};
  if (!user || user.role !== 'BUSINESS_OWNER') {
    res.status(404).json({ code: 'NO_ACCOUNT', message: 'No account on this computer uses this email.' });
    return;
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    res.status(400).json({ code: 'BAD_CODE', message: 'Enter the 6-digit code from the email.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ code: 'WEAK_PASSWORD', message: 'The new password needs at least 8 characters.' });
    return;
  }
  try {
    await confirmPasswordReset(user.email.toLowerCase(), code.trim(), password);
  } catch (err: any) {
    res.status(err?.status || 502).json({ code: err?.code || 'RESET_FAILED', message: err?.message || 'Could not reset the password' });
    return;
  }
  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(bcrypt.hashSync(password, 10), user.id);
  for (const k of failedLogins.keys()) if (k.startsWith(`${user.email.toLowerCase()}|`)) failedLogins.delete(k);
  rememberAccount(user.id, user.email, password, 'RESET', true); // the vendor's server already has it
  logAudit({ businessId: user.business_id, userId: user.id, action: 'PASSWORD_RESET', entityType: 'USER', entityId: user.id });
  res.json({ ok: true });
}

export function getCurrentUser(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Not logged in' });
    return;
  }

  const user = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.business_id,
           b.name as business_name, b.category as business_category, b.plan_id, b.gstin, b.invoice_prefix, b.address, b.city, b.state, b.phone, b.logo_url
    FROM users u
    LEFT JOIN businesses b ON u.business_id = b.id
    WHERE u.id = ?
  `).get(req.user.userId) as any;

  if (!user) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
    return;
  }

  const activeModules = user.business_category 
    ? (CATEGORY_DEFAULT_MODULES[user.business_category as BusinessCategory] || [])
    : [];

  // Opening the app (or switching to this business) makes it the one licence checks and backups run for
  setActiveShop(currentShopId());

  res.json({
    user: {
      shopId: currentShopId(),
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      businessId: user.business_id,
      businessName: user.business_name,
      businessCategory: user.business_category,
      planId: user.plan_id,
      gstin: user.gstin,
      invoicePrefix: user.invoice_prefix,
      address: user.address,
      city: user.city,
      state: user.state,
      phone: user.phone,
      businessLogo: user.logo_url || null,
      activeModules,
      settings: user.business_id ? getBusinessSettings(user.business_id) : undefined,
    },
  });
}

/** Owner-only. Erases this computer's Apna Billing shop so the same email can sign up again. Nothing outside this app is touched. */
export async function eraseShop(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (req.user?.role !== 'BUSINESS_OWNER' && req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ code: 'FORBIDDEN', message: 'Only the business owner can erase this shop.' });
    return;
  }
  const business = (req.user.businessId
    ? db.prepare('SELECT name FROM businesses WHERE id = ?').get(req.user.businessId)
    : db.prepare('SELECT name FROM businesses LIMIT 1').get()) as { name?: string } | undefined;
  const expected = String(business?.name || '').trim();
  const typed = String(req.body?.confirmName || '').trim();
  if (!expected || typed.toLowerCase() !== expected.toLowerCase()) {
    res.status(400).json({ code: 'CONFIRMATION_MISMATCH', message: expected ? `Type "${expected}" to erase this shop.` : 'No shop is set up on this computer.' });
    return;
  }
  // Safety backup first; only if it succeeds is the computer deactivated and the shop erased.
  const r = await backupThenWipe('LOCAL_ERASED', async () => {
    try { await deactivateInstallation(); } catch { /* not activated, or the license server is offline */ }
  });
  if (!r.erased) {
    res.status(500).json({ code: 'BACKUP_FAILED', message: `Nothing was erased: a safety backup could not be saved first (${r.error}). Check the backup folder on the Backup page.` });
    return;
  }
  emitLicenseChanged('session-ended', { sessionEnded: true, reason: 'LOCAL_ERASED', erased: true, backupFile: r.backupFile });
  res.json({ ok: true, backupFile: r.backupFile });
}
