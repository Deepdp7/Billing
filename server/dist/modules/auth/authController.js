"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.registerBusiness = registerBusiness;
exports.getCurrentUser = getCurrentUser;
exports.eraseShop = eraseShop;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const connection_js_1 = require("../../db/connection.js");
const index_js_1 = require("../../config/index.js");
const index_js_2 = require("../registry/index.js");
const licenseClient_js_1 = require("../../licensing/licenseClient.js");
const events_js_1 = require("../../licensing/events.js");
const settingsService_js_1 = require("../../services/settingsService.js");
const auditService_js_1 = require("../../services/auditService.js");
// Brute-force protection: 10 failed attempts per email+IP per 15 minutes.
const failedLogins = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED = 10;
function loginKey(req, email) {
    return `${String(email).toLowerCase()}|${req.ip}`;
}
function isLocked(key) {
    const e = failedLogins.get(key);
    if (!e)
        return false;
    if (Date.now() - e.first > LOGIN_WINDOW_MS) {
        failedLogins.delete(key);
        return false;
    }
    return e.count >= MAX_FAILED;
}
function recordFailure(key) {
    const e = failedLogins.get(key);
    if (!e || Date.now() - e.first > LOGIN_WINDOW_MS)
        failedLogins.set(key, { count: 1, first: Date.now() });
    else
        e.count += 1;
}
function login(req, res) {
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
    const user = connection_js_1.db.prepare(`
    SELECT u.*, b.name as business_name, b.category as business_category, b.status as business_status, b.plan_id
    FROM users u
    LEFT JOIN businesses b ON u.business_id = b.id
    WHERE LOWER(u.email) = LOWER(?)
  `).get(email);
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
    const isPasswordValid = bcryptjs_1.default.compareSync(password, user.password_hash);
    if (!isPasswordValid) {
        recordFailure(key);
        res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
        return;
    }
    const token = jsonwebtoken_1.default.sign({
        userId: user.id,
        email: user.email,
        role: user.role,
        businessId: user.business_id,
    }, index_js_1.config.jwtSecret, { expiresIn: index_js_1.config.jwtExpiresIn });
    failedLogins.delete(key);
    connection_js_1.db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    (0, auditService_js_1.logAudit)({ businessId: user.business_id, userId: user.id, action: 'USER_LOGIN', entityType: 'USER', entityId: user.id });
    const activeModules = user.business_category
        ? (index_js_2.CATEGORY_DEFAULT_MODULES[user.business_category] || ['pos_billing', 'products', 'inventory', 'customers', 'invoices'])
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
function registerBusiness(req, res) {
    const { ownerName, email, password, businessName, category, phone, gstin, city, state, } = req.body;
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
    if (index_js_1.config.singleTenant) {
        const count = connection_js_1.db.prepare('SELECT COUNT(*) AS c FROM businesses').get().c;
        if (count > 0) {
            res.status(403).json({ code: 'SETUP_COMPLETE', message: 'This installation is already set up. Ask the owner to add you as staff.' });
            return;
        }
    }
    // First run creates the owner account before any license step (the app then asks for a trial or key);
    // every other write stays blocked until one is active. Expired, suspended or tampered installs cannot register.
    const license = (0, licenseClient_js_1.computeStatus)();
    if (license.enforced && !license.canWrite && license.mode !== 'UNLICENSED') {
        res.status(402).json({ code: `LICENSE_${license.mode}`, message: license.message });
        return;
    }
    if (!state || typeof state !== 'string') {
        res.status(400).json({ code: 'STATE_REQUIRED', message: 'Select the state where the business is registered (needed for correct GST)' });
        return;
    }
    const existing = connection_js_1.db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
    if (existing) {
        res.status(409).json({ code: 'EMAIL_EXISTS', message: 'An account with this email already exists' });
        return;
    }
    const validCategories = [
        'RESTAURANT', 'GROCERY', 'CLOTHING', 'WHOLESALE', 'SERVICE', 'MANUFACTURING', 'PHARMACY', 'SCHOOL'
    ];
    if (!validCategories.includes(category)) {
        res.status(400).json({ code: 'INVALID_CATEGORY', message: 'Invalid business category selected' });
        return;
    }
    const businessId = `biz_${(0, uuid_1.v4)().substring(0, 8)}`;
    const userId = (0, uuid_1.v4)();
    const passwordHash = bcryptjs_1.default.hashSync(password, 10);
    const prefix = businessName.substring(0, 3).toUpperCase() + '-';
    const transaction = connection_js_1.db.transaction(() => {
        // 1. Create Business
        connection_js_1.db.prepare(`
      INSERT INTO businesses (id, name, category, gstin, phone, email, city, state, plan_id, status, invoice_prefix, next_invoice_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'plan_pro', 'ACTIVE', ?, 1001)
    `).run(businessId, businessName, category, gstin || null, phone || null, email, city || null, state, prefix);
        // 2. Create Owner User
        connection_js_1.db.prepare(`
      INSERT INTO users (id, business_id, name, email, password_hash, role, status)
      VALUES (?, ?, ?, ?, ?, 'BUSINESS_OWNER', 'ACTIVE')
    `).run(userId, businessId, ownerName, email, passwordHash);
        // 3. Create Default Category
        const defaultCatId = (0, uuid_1.v4)();
        connection_js_1.db.prepare(`
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
        }
        else if (category === 'PHARMACY') {
            sampleProdName = 'Multivitamin Syrup 200ml';
            sampleUnit = 'bottle';
            sampleHsn = '3004';
            sampleTax = 12;
        }
        else if (category === 'GROCERY') {
            sampleProdName = 'Basmati Premium Rice 1kg';
            sampleUnit = 'kg';
            sampleHsn = '1006';
            sampleTax = 0;
        }
        if (index_js_1.config.demoMode) {
            connection_js_1.db.prepare(`
        INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise, tax_rate, stock_quantity, low_stock_threshold)
        VALUES (?, ?, ?, ?, 'SKU-001', '890000000001', ?, ?, 10000, 15000, 18000, ?, 50, 10)
      `).run((0, uuid_1.v4)(), businessId, defaultCatId, sampleProdName, sampleUnit, sampleHsn, sampleTax);
        }
        if (category === 'SERVICE' || category === 'SCHOOL') {
            connection_js_1.db.prepare('UPDATE products SET track_stock = 0 WHERE business_id = ?').run(businessId);
        }
    });
    try {
        transaction();
        const token = jsonwebtoken_1.default.sign({ userId, email, role: 'BUSINESS_OWNER', businessId }, index_js_1.config.jwtSecret, { expiresIn: index_js_1.config.jwtExpiresIn });
        const activeModules = index_js_2.CATEGORY_DEFAULT_MODULES[category] || [];
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
    }
    catch (err) {
        console.error('Registration failed:', err);
        res.status(500).json({ code: 'REGISTRATION_FAILED', message: err.message || 'Failed to create business' });
    }
}
function getCurrentUser(req, res) {
    if (!req.user) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: 'Not logged in' });
        return;
    }
    const user = connection_js_1.db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.business_id,
           b.name as business_name, b.category as business_category, b.plan_id, b.gstin, b.invoice_prefix, b.address, b.city, b.state, b.phone
    FROM users u
    LEFT JOIN businesses b ON u.business_id = b.id
    WHERE u.id = ?
  `).get(req.user.userId);
    if (!user) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
        return;
    }
    const activeModules = user.business_category
        ? (index_js_2.CATEGORY_DEFAULT_MODULES[user.business_category] || [])
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
            settings: user.business_id ? (0, settingsService_js_1.getBusinessSettings)(user.business_id) : undefined,
        },
    });
}
/** Owner-only. Erases this computer's Apna Billing shop so the same email can sign up again. Nothing outside this app is touched. */
async function eraseShop(req, res) {
    if (req.user?.role !== 'BUSINESS_OWNER' && req.user?.role !== 'SUPER_ADMIN') {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Only the business owner can erase this shop.' });
        return;
    }
    const business = (req.user.businessId
        ? connection_js_1.db.prepare('SELECT name FROM businesses WHERE id = ?').get(req.user.businessId)
        : connection_js_1.db.prepare('SELECT name FROM businesses LIMIT 1').get());
    const expected = String(business?.name || '').trim();
    const typed = String(req.body?.confirmName || '').trim();
    if (!expected || typed.toLowerCase() !== expected.toLowerCase()) {
        res.status(400).json({ code: 'CONFIRMATION_MISMATCH', message: expected ? `Type "${expected}" to erase this shop.` : 'No shop is set up on this computer.' });
        return;
    }
    // Safety backup first; only if it succeeds is the computer deactivated and the shop erased.
    const r = await (0, licenseClient_js_1.backupThenWipe)('LOCAL_ERASED', async () => {
        try {
            await (0, licenseClient_js_1.deactivateInstallation)();
        }
        catch { /* not activated, or the license server is offline */ }
    });
    if (!r.erased) {
        res.status(500).json({ code: 'BACKUP_FAILED', message: `Nothing was erased: a safety backup could not be saved first (${r.error}). Check the backup folder on the Backup page.` });
        return;
    }
    (0, events_js_1.emitLicenseChanged)('session-ended', { sessionEnded: true, reason: 'LOCAL_ERASED', erased: true, backupFile: r.backupFile });
    res.json({ ok: true, backupFile: r.backupFile });
}
