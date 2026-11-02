import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { config } from '../../config/index.js';
import { CATEGORY_DEFAULT_MODULES } from '../registry/index.js';
import { BusinessCategory, UserRole } from '../../types/index.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { backupThenWipe, computeStatus, deactivateInstallation } from '../../licensing/licenseClient.js';
import { emitLicenseChanged } from '../../licensing/events.js';
import { getBusinessSettings } from '../../services/settingsService.js';
import { logAudit } from '../../services/auditService.js';

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

export function login(req: Request, res: Response): void {
  const { email, password } = req.body;
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Email and password are required' });
    return;
  }
  const key = loginKey(req, email);
  if (isLocked(key)) {
    res.status(429).json({ code: 'TOO_MANY_ATTEMPTS', message: 'Too many failed login attempts. Try again in 15 minutes.' });
    return;
  }

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
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as any }
  );
  failedLogins.delete(key);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  logAudit({ businessId: user.business_id, userId: user.id, action: 'USER_LOGIN', entityType: 'USER', entityId: user.id });

  const activeModules = user.business_category 
    ? (CATEGORY_DEFAULT_MODULES[user.business_category as BusinessCategory] || ['pos_billing', 'products', 'inventory', 'customers', 'invoices'])
    : [];

  res.json({
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
      activeModules,
    },
  });
}

export function registerBusiness(req: Request, res: Response): void {
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
  if (config.singleTenant) {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM businesses').get() as any).c;
    if (count > 0) {
      res.status(403).json({ code: 'SETUP_COMPLETE', message: 'This installation is already set up. Ask the owner to add you as staff.' });
      return;
    }
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

  const businessId = `biz_${uuidv4().substring(0, 8)}`;
  const userId = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
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

  try {
    transaction();

    const token = jwt.sign(
      { userId, email, role: 'BUSINESS_OWNER', businessId },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    const activeModules = CATEGORY_DEFAULT_MODULES[category as BusinessCategory] || [];

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
        activeModules,
      },
    });
  } catch (err: any) {
    console.error('Registration failed:', err);
    res.status(500).json({ code: 'REGISTRATION_FAILED', message: err.message || 'Failed to create business' });
  }
}

export function getCurrentUser(req: AuthenticatedRequest, res: Response): void {
  if (!req.user) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Not logged in' });
    return;
  }

  const user = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.business_id,
           b.name as business_name, b.category as business_category, b.plan_id, b.gstin, b.invoice_prefix, b.address, b.city, b.state, b.phone
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

  res.json({
    user: {
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
