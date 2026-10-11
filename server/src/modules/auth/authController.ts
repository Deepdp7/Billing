import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/connection.js';
import { config } from '../../config/index.js';
import { CATEGORY_DEFAULT_MODULES } from '../registry/index.js';
import { BusinessCategory, UserRole } from '../../types/index.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

export function login(req: Request, res: Response): void {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'Email and password are required' });
    return;
  }

  const user = db.prepare(`
    SELECT u.*, b.name as business_name, b.category as business_category, b.status as business_status, b.plan_id
    FROM users u
    LEFT JOIN businesses b ON u.business_id = b.id
    WHERE LOWER(u.email) = LOWER(?)
  `).get(email) as any;

  if (!user) {
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
    { expiresIn: '7d' }
  );

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
      city || 'Mumbai',
      state || 'Maharashtra',
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

    db.prepare(`
      INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise, tax_rate, stock_quantity, low_stock_threshold)
      VALUES (?, ?, ?, ?, 'SKU-001', '890000000001', ?, ?, 10000, 15000, 18000, ?, 50, 10)
    `).run(uuidv4(), businessId, defaultCatId, sampleProdName, sampleUnit, sampleHsn, sampleTax);
  });

  try {
    transaction();

    const token = jwt.sign(
      { userId, email, role: 'BUSINESS_OWNER', businessId },
      config.jwtSecret,
      { expiresIn: '7d' }
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
    },
  });
}
