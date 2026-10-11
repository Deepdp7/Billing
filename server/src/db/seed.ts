import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from './connection.js';

export function runSeed() {
  console.log('[Seed] Checking database seeding...');

  // Check if already seeded
  const existingPlans = db.prepare('SELECT COUNT(*) as count FROM plans').get() as { count: number };
  if (existingPlans && existingPlans.count > 0) {
    console.log('[Seed] Database is already seeded.');
    seedClothingDemo();
    seedStoreAndManufacturingDemo();
    seedLoyaltyAndSchoolDemo();
    seedWholesaleAndServices();
    return;
  }

  console.log('[Seed] Seeding initial plans, admin, and demo businesses...');

  const passwordHash = bcrypt.hashSync('admin123', 10);
  const userPasswordHash = bcrypt.hashSync('password123', 10);

  // 1. Insert Plans
  const insertPlan = db.prepare(`
    INSERT INTO plans (id, name, tier, price_paise, billing_period, max_users, max_branches, max_invoices_per_month, features_json, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const freePlanId = 'plan_free';
  const proPlanId = 'plan_pro';
  const businessPlanId = 'plan_business';

  insertPlan.run(
    freePlanId,
    'Starter Free',
    'FREE',
    0,
    'MONTHLY',
    2,
    1,
    100,
    JSON.stringify(['POS Billing', 'Product Catalog', 'GST Invoices', 'Basic Reports']),
    1
  );

  insertPlan.run(
    proPlanId,
    'Growth Pro',
    'PRO',
    99900, // ₹999.00
    'MONTHLY',
    10,
    3,
    5000,
    JSON.stringify(['All Starter Features', 'Industry Vertical Modules', 'Stock Alerts', 'Customer Credit Ledger', 'Thermal + A4 Printing', 'Audit Logs']),
    1
  );

  insertPlan.run(
    businessPlanId,
    'Enterprise Scale',
    'BUSINESS',
    249900, // ₹2499.00
    'MONTHLY',
    50,
    10,
    100000,
    JSON.stringify(['All Pro Features', 'Multi-Branch Sync', 'Unlimited Invoices', 'Advanced Analytics', 'Priority 24/7 Support', 'Custom Branding']),
    1
  );

  // 2. Insert Platform Super Admin
  const adminId = uuidv4();
  db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, NULL, ?, ?, ?, 'SUPER_ADMIN', 'ACTIVE')
  `).run(adminId, 'Platform Super Admin', 'admin@apnabilling.com', passwordHash);

  // 3. Insert Business 1: Apna Supermart (GROCERY)
  const groceryBizId = 'biz_supermart';
  db.prepare(`
    INSERT INTO businesses (id, name, category, gstin, address, city, state, pincode, phone, email, plan_id, status, invoice_prefix, next_invoice_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'ASM-', 1005)
  `).run(
    groceryBizId,
    'Apna Supermart & Retail',
    'GROCERY',
    '27AABCA1234A1Z5',
    'Shop 12-14, Sunrise Plaza, MG Road',
    'Pune',
    'Maharashtra',
    '411001',
    '+91 9823012345',
    'owner@apnasupermart.com',
    proPlanId
  );

  // Grocery Owner User
  const groceryOwnerId = uuidv4();
  db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, 'BUSINESS_OWNER', 'ACTIVE')
  `).run(groceryOwnerId, groceryBizId, 'Rajesh Agrawal', 'owner@apnasupermart.com', userPasswordHash);

  // Grocery Categories
  const catGroceries = uuidv4();
  const catDairy = uuidv4();
  const catSnacks = uuidv4();
  const catPersonal = uuidv4();

  const insertCategory = db.prepare(`INSERT INTO categories (id, business_id, name, description) VALUES (?, ?, ?, ?)`);
  insertCategory.run(catGroceries, groceryBizId, 'Foodgrains & Staples', 'Atta, rice, dal, oils, spices');
  insertCategory.run(catDairy, groceryBizId, 'Dairy & Breakfast', 'Milk, butter, cheese, bread, cereals');
  insertCategory.run(catSnacks, groceryBizId, 'Snacks & Packaged Food', 'Biscuits, noodles, chips, beverages');
  insertCategory.run(catPersonal, groceryBizId, 'Personal & Home Care', 'Soaps, detergents, toiletries');

  // Grocery Products (with real barcodes, HSN, taxes in paise)
  const insertProduct = db.prepare(`
    INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise, tax_rate, stock_quantity, low_stock_threshold, is_active, extra_attributes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const prod1 = uuidv4();
  insertProduct.run(prod1, groceryBizId, catGroceries, 'Aashirvaad Shudh Chakki Atta 5kg', 'SKU-ATTA-5KG', '8901030382012', 'bag', '1101', 22000, 25000, 27500, 0, 48, 10, '{}');

  const prod2 = uuidv4();
  insertProduct.run(prod2, groceryBizId, catDairy, 'Amul Butter Pasteurised 500g', 'SKU-AMUL-500G', '8901262010053', 'pack', '0405', 24000, 27000, 28500, 12, 32, 8, '{}');

  const prod3 = uuidv4();
  insertProduct.run(prod3, groceryBizId, catGroceries, 'Tata Salt Vacuum Evaporated 1kg', 'SKU-SALT-1KG', '8904004400018', 'pkt', '2501', 2000, 2500, 2800, 0, 120, 25, '{}');

  const prod4 = uuidv4();
  insertProduct.run(prod4, groceryBizId, catSnacks, 'Maggi 2-Minute Masala Noodles 280g', 'SKU-MAGGI-280', '8901058852375', 'pkt', '1902', 4600, 5400, 6000, 18, 85, 20, '{}');

  const prod5 = uuidv4();
  insertProduct.run(prod5, groceryBizId, catPersonal, 'Dettol Original Bathing Soap 125g', 'SKU-DETT-125G', '8901396112015', 'bar', '3401', 4800, 5800, 6500, 18, 6, 10, '{}'); // Low stock demo!

  const prod6 = uuidv4();
  insertProduct.run(prod6, groceryBizId, catGroceries, 'Fortune Sunlite Sunflower Oil 1L Pouch', 'SKU-FORT-1L', '8906007281023', 'pouch', '1512', 12800, 14900, 16500, 5, 42, 10, '{}');

  const prod7 = uuidv4();
  insertProduct.run(prod7, groceryBizId, catSnacks, 'Parle-G Gold Biscuits 1kg Family Pack', 'SKU-PARLE-1KG', '8901719101019', 'pack', '1905', 9200, 10500, 12000, 18, 55, 15, '{}');

  const prod8 = uuidv4();
  insertProduct.run(prod8, groceryBizId, catSnacks, 'Coca-Cola Soft Drink 750ml Bottle', 'SKU-COKE-750', '8901764012018', 'bottle', '2202', 3200, 4000, 4500, 28, 4, 12, '{}'); // Low stock demo!

  // Grocery Customers
  const cust1 = uuidv4();
  const cust2 = uuidv4();
  const insertCustomer = db.prepare(`
    INSERT INTO customers (id, business_id, name, phone, email, gstin, address, credit_limit_paise, outstanding_balance_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertCustomer.run(cust1, groceryBizId, 'Ramesh Sharma', '+91 9876543210', 'ramesh@gmail.com', '', 'Flat 402, Green Acres, Pune', 1000000, 0);
  insertCustomer.run(cust2, groceryBizId, 'Priya Patel', '+91 9811223344', 'priya.patel@outloook.com', '27AABCP1234F1Z5', 'Bungalow 7, Koregaon Park, Pune', 2500000, 145000); // Has ₹1450 outstanding

  // Grocery Past Invoices (to give rich initial graphs and stats!)
  const insertInvoice = db.prepare(`
    INSERT INTO invoices (
      id, business_id, invoice_number, customer_id, customer_name, customer_phone,
      invoice_date, subtotal_paise, discount_paise, tax_paise, cgst_paise, sgst_paise,
      total_paise, payment_mode, payment_status, amount_paid_paise, notes, created_by, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO invoice_items (id, business_id, invoice_id, product_id, product_name, sku, hsn_code, quantity, unit_price_paise, discount_paise, tax_rate, tax_paise, total_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertStockMovement = db.prepare(`
    INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Invoice 1 (Today)
  const inv1 = uuidv4();
  const today = new Date().toISOString().split('T')[0];
  insertInvoice.run(
    inv1, groceryBizId, 'ASM-1001', cust1, 'Ramesh Sharma', '+91 9876543210',
    today, 62400, 2400, 5400, 2700, 2700,
    65400, 'UPI', 'PAID', 65400, 'Counter 1 UPI QR payment', groceryOwnerId, new Date().toISOString()
  );
  insertItem.run(uuidv4(), groceryBizId, inv1, prod1, 'Aashirvaad Shudh Chakki Atta 5kg', 'SKU-ATTA-5KG', '1101', 2, 25000, 0, 0, 0, 50000);
  insertItem.run(uuidv4(), groceryBizId, inv1, prod4, 'Maggi 2-Minute Masala Noodles 280g', 'SKU-MAGGI-280', '1902', 2, 5400, 0, 18, 1944, 12744);
  insertStockMovement.run(uuidv4(), groceryBizId, prod1, -2, 48, 'INVOICE', inv1, 'Sale in ASM-1001', new Date().toISOString());
  insertStockMovement.run(uuidv4(), groceryBizId, prod4, -2, 85, 'INVOICE', inv1, 'Sale in ASM-1001', new Date().toISOString());

  // Invoice 2 (Today)
  const inv2 = uuidv4();
  insertInvoice.run(
    inv2, groceryBizId, 'ASM-1002', null, 'Walk-in Customer', '',
    today, 41900, 0, 3240, 1620, 1620,
    45140, 'CASH', 'PAID', 45140, 'Cash checkout', groceryOwnerId, new Date().toISOString()
  );
  insertItem.run(uuidv4(), groceryBizId, inv2, prod2, 'Amul Butter Pasteurised 500g', 'SKU-AMUL-500G', '0405', 1, 27000, 0, 12, 3240, 30240);
  insertItem.run(uuidv4(), groceryBizId, inv2, prod6, 'Fortune Sunlite Sunflower Oil 1L Pouch', 'SKU-FORT-1L', '1512', 1, 14900, 0, 5, 745, 15645);

  // 4. Insert Business 2: Spice Garden Cafe (RESTAURANT)
  const restBizId = 'biz_spicegarden';
  db.prepare(`
    INSERT INTO businesses (id, name, category, gstin, address, city, state, pincode, phone, email, plan_id, status, invoice_prefix, next_invoice_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'SGC-', 2001)
  `).run(
    restBizId,
    'Spice Garden Cafe & Fine Dining',
    'RESTAURANT',
    '27AABCS9876C1Z8',
    'Plot 45, FC Road',
    'Pune',
    'Maharashtra',
    '411005',
    '+91 9890112233',
    'manager@spicegarden.com',
    proPlanId
  );

  const restOwnerId = uuidv4();
  db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, 'BUSINESS_OWNER', 'ACTIVE')
  `).run(restOwnerId, restBizId, 'Chef Vikram Malhotra', 'manager@spicegarden.com', userPasswordHash);

  const catMains = uuidv4();
  const catBeverages = uuidv4();
  insertCategory.run(catMains, restBizId, 'Main Course & Breads', 'Gravies, paneer dishes, rotis and rice');
  insertCategory.run(catBeverages, restBizId, 'Beverages & Mocktails', 'Fresh coolers, milkshakes, coffees');

  insertProduct.run(uuidv4(), restBizId, catMains, 'Paneer Butter Masala', 'DISH-PBM', '', 'portion', '9963', 12000, 32000, 35000, 5, 999, 10, '{}');
  insertProduct.run(uuidv4(), restBizId, catMains, 'Butter Garlic Naan', 'DISH-BGN', '', 'pcs', '9963', 2000, 7500, 8500, 5, 999, 10, '{}');
  insertProduct.run(uuidv4(), restBizId, catMains, 'Dum Biryani Pot (Serves 2)', 'DISH-DBIR', '', 'pot', '9963', 16000, 42000, 46000, 5, 999, 10, '{}');
  insertProduct.run(uuidv4(), restBizId, catBeverages, 'Iced Hazelnut Frappe', 'BEV-FRA', '', 'glass', '9963', 4500, 18000, 19900, 5, 999, 10, '{}');

  // 5. Insert Business 3: Apollo Care Pharmacy (PHARMACY)
  const pharmBizId = 'biz_apollocare';
  db.prepare(`
    INSERT INTO businesses (id, name, category, gstin, address, city, state, pincode, phone, email, plan_id, status, invoice_prefix, next_invoice_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'ACP-', 3001)
  `).run(
    pharmBizId,
    'Apollo Care Chemist & Druggist',
    'PHARMACY',
    '27AABCA5555M1Z2',
    'Civil Hospital Road',
    'Pune',
    'Maharashtra',
    '411002',
    '+91 9765443322',
    'pharmacist@apollocare.com',
    proPlanId
  );

  const pharmOwnerId = uuidv4();
  db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, 'BUSINESS_OWNER', 'ACTIVE')
  `).run(pharmOwnerId, pharmBizId, 'Dr. Neha Kulkarni', 'pharmacist@apollocare.com', userPasswordHash);

  const catRx = uuidv4();
  insertCategory.run(catRx, pharmBizId, 'Tablets & Capsules', 'Prescription medicines');

  insertProduct.run(
    uuidv4(), pharmBizId, catRx, 'Dolo 650mg Paracetamol Tablets (Strip of 15)',
    'MED-DOLO650', '8901234567890', 'strip', '3004', 2200, 3150, 3500, 12, 140, 20,
    JSON.stringify({ batch_no: 'DL-2026-B8', expiry_date: '2028-06-30', composition: 'Paracetamol 650mg' })
  );

  insertProduct.run(
    uuidv4(), pharmBizId, catRx, 'Augmentin 625 Duo Tablets (Strip of 10)',
    'MED-AUG625', '8909876543211', 'strip', '3004', 16500, 21500, 23000, 12, 12, 15,
    JSON.stringify({ batch_no: 'AUG-991A', expiry_date: '2027-01-15', composition: 'Amoxicillin + Potassium Clavulanate' })
  );

  // 6. Seed Suppliers (Grocery)
  const supp1 = uuidv4();
  db.prepare(`
    INSERT INTO suppliers (id, business_id, name, phone, email, gstin, address, outstanding_balance_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(supp1, groceryBizId, 'Hindustan Unilever Distribution Hub', '+91 9988776655', 'sales@hul-distributor.com', '27AABCH1234H1Z1', 'Plot 10, MIDC Bhosari, Pune', 4500000);

  const supp2 = uuidv4();
  db.prepare(`
    INSERT INTO suppliers (id, business_id, name, phone, email, gstin, address, outstanding_balance_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(supp2, groceryBizId, 'Amul Dairy Co-op Wholesale', '+91 9822110033', 'orders@amuldairy.com', '27AABCA9999D1Z9', 'Khadki Market, Pune', 1850000);

  // 7. Seed Expenses (Grocery)
  const todayStr = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO expenses (id, business_id, category, amount_paise, expense_date, payment_mode, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), groceryBizId, 'Electricity & Utilities', 450000, todayStr, 'UPI', 'Store Main Meter Electricity Bill');

  db.prepare(`
    INSERT INTO expenses (id, business_id, category, amount_paise, expense_date, payment_mode, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), groceryBizId, 'Packaging & Bags', 120000, todayStr, 'CASH', 'Eco-friendly biodegradable carry bags');

  // 8. Seed Staff Accounts (Grocery)
  db.prepare(`
    INSERT INTO staff (id, business_id, name, email, phone, role, status)
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(uuidv4(), groceryBizId, 'Sunil Verma', 'cashier.sunil@apnasupermart.com', '+91 9870011223', 'CASHIER');

  db.prepare(`
    INSERT INTO staff (id, business_id, name, email, phone, role, status)
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(uuidv4(), groceryBizId, 'Pooja Mehra', 'accountant.pooja@apnasupermart.com', '+91 9870044556', 'ACCOUNTANT');

  // 9. Seed Restaurant Tables (Restaurant)
  const insertTable = db.prepare(`
    INSERT INTO restaurant_tables (id, business_id, table_number, capacity, status)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertTable.run(uuidv4(), restBizId, 'T1 - Window View', 4, 'OCCUPIED');
  insertTable.run(uuidv4(), restBizId, 'T2 - Couple Booth', 2, 'VACANT');
  insertTable.run(uuidv4(), restBizId, 'T3 - Family Lounge', 6, 'BILLED');
  insertTable.run(uuidv4(), restBizId, 'T4 - Garden Patio', 4, 'VACANT');

  // 10. Seed Notifications
  db.prepare(`
    INSERT INTO notifications (id, business_id, title, message, type)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), groceryBizId, 'Low Stock Alert', 'Dettol Original Soap (SKU-DETT-125G) has only 6 units remaining.', 'LOW_STOCK');

  db.prepare(`
    INSERT INTO notifications (id, business_id, title, message, type)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), groceryBizId, 'Supplier Payment Reminder', 'Payment of ₹45,000 due to Hindustan Unilever Distribution Hub.', 'PAYMENT_DUE');

  console.log('[Seed] Database successfully seeded with 3 demo businesses, realistic products, GST invoices, suppliers, expenses, staff, and platform admin!');
  seedClothingDemo();
}

export function seedClothingDemo() {
  const existing = db.prepare("SELECT id FROM businesses WHERE id = 'biz_zarafashion'").get();
  if (existing) return;

  console.log('[Seed] Seeding Clothing & Fashion demo business (Zara Trends Boutique)...');
  const bizId = 'biz_zarafashion';
  const userPasswordHash = bcrypt.hashSync('password123', 10);

  db.prepare(`
    INSERT INTO businesses (id, name, category, gstin, address, city, state, pincode, phone, email, plan_id, status, invoice_prefix, next_invoice_number)
    VALUES (?, ?, 'CLOTHING', '27AABCT7777F1Z3', 'Shop 4-5, Fashion Street', 'Mumbai', 'Maharashtra', '400001', '+91 9833445566', 'fashion@zaratrends.com', 'plan_pro', 'ACTIVE', 'ZT-', 1015)
  `).run(bizId, 'Zara Trends Fashion & Boutique');

  db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, ?, 'Ananya Roy', 'fashion@zaratrends.com', ?, 'BUSINESS_OWNER', 'ACTIVE')
  `).run(uuidv4(), bizId, userPasswordHash);

  // Categories
  const catMens = uuidv4();
  const catDenim = uuidv4();
  const catWomens = uuidv4();
  const insertCat = db.prepare(`INSERT INTO categories (id, business_id, name, description) VALUES (?, ?, ?, ?)`);
  insertCat.run(catMens, bizId, "Men's Casuals & Formals", 'Shirts, polos, formal wear');
  insertCat.run(catDenim, bizId, 'Denims & Trousers', 'Stretch jeans, chinos, joggers');
  insertCat.run(catWomens, bizId, "Women's Ethnic & Fusion", 'Kurtis, dresses, fusion tops');

  // Product 1: Oxford Shirt
  const prod1Id = uuidv4();
  db.prepare(`
    INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise, tax_rate, stock_quantity, low_stock_threshold, is_active, extra_attributes_json)
    VALUES (?, ?, ?, 'Slim Fit Oxford Cotton Shirt', 'SHIRT-OXF', 'SHIRT-OXF-BASE', 'Pcs', '6109', 55000, 119900, 149900, 5, 88, 10, 1, ?)
  `).run(prod1Id, bizId, catMens, JSON.stringify({ fabric: '100% Egyptian Cotton', sizes: ['S', 'M', 'L', 'XL'], colors: ['Navy Blue', 'Off-White'] }));

  // Variants for Product 1
  const shirtVariants = [
    { size: 'S', color: 'Navy Blue', stock: 12, barcode: '8901234001' },
    { size: 'M', color: 'Navy Blue', stock: 25, barcode: '8901234002' },
    { size: 'L', color: 'Navy Blue', stock: 18, barcode: '8901234003' },
    { size: 'XL', color: 'Navy Blue', stock: 8, barcode: '8901234004' },
    { size: 'S', color: 'Off-White', stock: 15, barcode: '8901234005' },
    { size: 'M', color: 'Off-White', stock: 30, barcode: '8901234006' },
    { size: 'L', color: 'Off-White', stock: 22, barcode: '8901234007' },
    { size: 'XL', color: 'Off-White', stock: 10, barcode: '8901234008' },
  ];

  const insertVar = db.prepare(`
    INSERT INTO clothing_variants (id, business_id, parent_product_id, variant_sku, barcode, size, color, fabric, stock_quantity, sale_price_paise, mrp_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 119900, 149900)
  `);

  for (const v of shirtVariants) {
    insertVar.run(uuidv4(), bizId, prod1Id, `SHIRT-OXF-${v.color.slice(0, 3).toUpperCase()}-${v.size}`, v.barcode, v.size, v.color, '100% Egyptian Cotton', v.stock);
  }

  // Product 2: Denim Jeans
  const prod2Id = uuidv4();
  db.prepare(`
    INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise, tax_rate, stock_quantity, low_stock_threshold, is_active, extra_attributes_json)
    VALUES (?, ?, ?, 'Stretch Denim Slim Jeans', 'JEANS-STR', 'JEANS-STR-BASE', 'Pcs', '6203', 95000, 189900, 249900, 12, 70, 10, 1, ?)
  `).run(prod2Id, bizId, catDenim, JSON.stringify({ fabric: '98% Cotton 2% Spandex Denim', sizes: ['30', '32', '34', '36'], colors: ['Dark Indigo', 'Washed Grey'] }));

  const jeansVariants = [
    { size: '30', color: 'Dark Indigo', stock: 14, barcode: '8901234009' },
    { size: '32', color: 'Dark Indigo', stock: 28, barcode: '8901234010' },
    { size: '34', color: 'Dark Indigo', stock: 20, barcode: '8901234011' },
    { size: '36', color: 'Dark Indigo', stock: 8, barcode: '8901234012' },
    { size: '30', color: 'Washed Grey', stock: 10, barcode: '8901234013' },
    { size: '32', color: 'Washed Grey', stock: 18, barcode: '8901234014' },
    { size: '34', color: 'Washed Grey', stock: 12, barcode: '8901234015' },
  ];

  for (const v of jeansVariants) {
    insertVar.run(uuidv4(), bizId, prod2Id, `JEANS-STR-${v.color.slice(0, 3).toUpperCase()}-${v.size}`, v.barcode, v.size, v.color, '98% Cotton 2% Spandex', v.stock);
  }

  // Demo Exchange
  db.prepare(`
    INSERT INTO garment_exchanges (
      id, business_id, exchange_number, original_invoice_number, customer_name, customer_phone,
      returned_product_name, returned_size, returned_color, returned_quantity,
      issued_product_name, issued_size, issued_color, issued_quantity,
      price_difference_paise, payment_mode, reason, notes
    ) VALUES (?, ?, 'EX-2001', 'ZT-1002', 'Rohit Sharma', '+91 9898980011',
      'Slim Fit Oxford Cotton Shirt', 'M', 'Navy Blue', 1,
      'Slim Fit Oxford Cotton Shirt', 'L', 'Navy Blue', 1,
      0, 'CASH', 'WRONG_SIZE', 'Size exchanged at trial counter, perfect fit')
  `).run(uuidv4(), bizId);

  console.log('[Seed] Zara Trends Fashion demo business seeded with variant matrix and demo exchange!');
}

function seedStoreAndManufacturingDemo() {
  console.log('[Seed] Checking Online Storefront and Manufacturing demo seeding...');

  // 1. Seed Online Storefront for Apna Supermart
  const existingSupermartStore = db.prepare("SELECT id FROM online_stores WHERE slug = 'apna-supermart'").get();
  if (!existingSupermartStore) {
    const storeId = uuidv4();
    db.prepare(`
      INSERT INTO online_stores (
        id, business_id, slug, store_name, tagline, banner_message,
        is_active, min_order_amount_paise, delivery_fee_paise,
        accept_cod, accept_online, contact_phone, contact_whatsapp
      ) VALUES (
        ?, 'biz_supermart', 'apna-supermart', 'Apna Supermart & Fresh Grocery',
        'Daily Essentials, Fresh Dairy & Farm Produce Delivered to Your Home',
        '⚡ Express 30-Min Delivery across Metro · Free Delivery on Orders over ₹499',
        1, 15000, 4000, 1, 1, '+91 98200 12345', '+91 98200 12345'
      )
    `).run(storeId);

    // Seed a demo online order
    const orderId = uuidv4();
    db.prepare(`
      INSERT INTO online_orders (
        id, business_id, order_number, customer_name, customer_phone, customer_email,
        delivery_address, delivery_city, delivery_pincode, notes,
        subtotal_paise, delivery_fee_paise, total_paise, status, payment_mode, payment_status
      ) VALUES (
        ?, 'biz_supermart', 'ORD-20261011-001', 'Anjali Verma', '+91 98190 44552', 'anjali.v@example.com',
        'Flat 402, Sunshine Heights, MG Road', 'Mumbai', '400001', 'Please ring the bell twice and leave at doorstep if not answered',
        42500, 4000, 46500, 'PENDING', 'COD', 'UNPAID'
      )
    `).run(orderId);

    // Add demo items from supermart products
    const prods = db.prepare("SELECT id, name, sku, sale_price_paise FROM products WHERE business_id = 'biz_supermart' LIMIT 2").all() as any[];
    if (prods.length > 0) {
      const insertItm = db.prepare(`
        INSERT INTO online_order_items (id, business_id, order_id, product_id, product_name, sku, quantity, unit_price_paise, total_paise)
        VALUES (?, 'biz_supermart', ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const p of prods) {
        insertItm.run(uuidv4(), orderId, p.id, p.name, p.sku, 2, p.sale_price_paise, p.sale_price_paise * 2);
      }
    }

    console.log('[Seed] Online Storefront seeded for Apna Supermart (slug: apna-supermart)');
  }

  // 2. Seed Manufacturing Demo Business: Apex Garment & Packaging Industries
  const mfgBizId = 'biz_apex_mfg';
  const existingMfg = db.prepare('SELECT id FROM businesses WHERE id = ?').get(mfgBizId);
  if (existingMfg) {
    return;
  }

  console.log('[Seed] Seeding Manufacturing demo business (Apex Garment & Packaging Industries)...');

  const userPasswordHash = bcrypt.hashSync('password123', 10);

  db.prepare(`
    INSERT INTO businesses (
      id, name, category, gstin, address, city, state, pincode, phone, email,
      plan_id, status, invoice_prefix, next_invoice_number
    ) VALUES (
      ?, 'Apex Garments & Industrial Packaging', 'MANUFACTURING', '27AAPCA1234F1Z8',
      'Plot 14-B, MIDC Industrial Area, Turbhe', 'Navi Mumbai', 'Maharashtra', '400705',
      '+91 98205 99887', 'admin@apexindustries.com', 'plan_pro', 'ACTIVE', 'APX-', 1001
    )
  `).run(mfgBizId);

  // User
  db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, ?, 'Vikramaditya Roy (Plant Head)', 'owner@apexindustries.com', ?, 'BUSINESS_OWNER', 'ACTIVE')
  `).run(uuidv4(), mfgBizId, userPasswordHash);

  // Categories
  const catRawId = uuidv4();
  const catTrimId = uuidv4();
  const catFinId = uuidv4();

  const insertCat = db.prepare('INSERT INTO categories (id, business_id, name, description) VALUES (?, ?, ?, ?)');
  insertCat.run(catRawId, mfgBizId, 'Raw Materials & Textiles', 'Fabrics, yarn, and unprocessed raw stock');
  insertCat.run(catTrimId, mfgBizId, 'Trims & Packaging Supplies', 'Buttons, zippers, threads, cartons');
  insertCat.run(catFinId, mfgBizId, 'Finished Manufactured Goods', 'Ready for wholesale distribution or retail');

  // Products: Raw materials
  const rawFabricId = uuidv4();
  const rawThreadId = uuidv4();
  const rawButtonId = uuidv4();
  const rawBoxId = uuidv4();
  const finShirtBoxId = uuidv4();

  const insertProd = db.prepare(`
    INSERT INTO products (
      id, business_id, category_id, name, sku, barcode, unit, hsn_code,
      purchase_price_paise, sale_price_paise, mrp_paise, tax_rate,
      stock_quantity, low_stock_threshold, is_active, extra_attributes_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  insertProd.run(
    rawFabricId, mfgBizId, catRawId, 'Combed Pure Cotton Fabric Roll', 'RM-FAB-100', 'RM-FAB-100',
    'Mtr', '5208', 14000, 0, 0, 5.0, 650.0, 50.0, JSON.stringify({ is_raw_material: true, material_type: 'Fabric' })
  );

  insertProd.run(
    rawThreadId, mfgBizId, catTrimId, 'High-Tensile Polyester Sewing Thread Spool', 'RM-THRD-01', 'RM-THRD-01',
    'Spool', '5401', 4500, 0, 0, 12.0, 180.0, 20.0, JSON.stringify({ is_raw_material: true, material_type: 'Trims' })
  );

  insertProd.run(
    rawButtonId, mfgBizId, catTrimId, 'Mother of Pearl Resin Buttons (Pack of 100)', 'RM-BTN-100', 'RM-BTN-100',
    'Pkt', '9606', 7500, 0, 0, 12.0, 95.0, 15.0, JSON.stringify({ is_raw_material: true, material_type: 'Trims' })
  );

  insertProd.run(
    rawBoxId, mfgBizId, catTrimId, 'Rigid Export Presentation Gift Box', 'RM-BOX-GIFT', 'RM-BOX-GIFT',
    'Box', '4819', 4200, 0, 0, 18.0, 210.0, 30.0, JSON.stringify({ is_raw_material: true, material_type: 'Packaging' })
  );

  // Finished Product
  insertProd.run(
    finShirtBoxId, mfgBizId, catFinId, 'Executive Pure Cotton Shirts (Gift Box of 3)', 'FG-SHIRT-BOX3', '890987654321',
    'Box', '6205', 95000, 249900, 349900, 12.0, 35.0, 5.0, JSON.stringify({ is_finished_good: true })
  );

  // BOM Recipe
  const bomId = uuidv4();
  db.prepare(`
    INSERT INTO bom_recipes (
      id, business_id, bom_code, finished_product_id, finished_product_name,
      output_quantity, output_unit, estimated_labor_cost_paise,
      estimated_overhead_cost_paise, notes, is_active
    ) VALUES (
      ?, ?, 'BOM-SHIRT-3BX', ?, 'Executive Pure Cotton Shirts (Gift Box of 3)',
      1, 'Box', 28000, 12000,
      'Standard BOM formulation for 3-shirt executive presentation gift box including precision stitching, button attachment, and rigid box packaging',
      1
    )
  `).run(bomId, mfgBizId, finShirtBoxId);

  // BOM Items (Components)
  const insertBomItem = db.prepare(`
    INSERT INTO bom_items (id, business_id, bom_id, raw_material_id, raw_material_name, quantity_required, unit, wastage_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertBomItem.run(uuidv4(), mfgBizId, bomId, rawFabricId, 'Combed Pure Cotton Fabric Roll', 5.5, 'Mtr', 2.0);
  insertBomItem.run(uuidv4(), mfgBizId, bomId, rawThreadId, 'High-Tensile Polyester Sewing Thread Spool', 0.5, 'Spool', 0.0);
  insertBomItem.run(uuidv4(), mfgBizId, bomId, rawButtonId, 'Mother of Pearl Resin Buttons (Pack of 100)', 0.35, 'Pkt', 5.0);
  insertBomItem.run(uuidv4(), mfgBizId, bomId, rawBoxId, 'Rigid Export Presentation Gift Box', 1.0, 'Box', 0.0);

  // Seed Completed Production Run
  const order1Id = uuidv4();
  db.prepare(`
    INSERT INTO production_orders (
      id, business_id, order_number, bom_id, finished_product_id, finished_product_name,
      target_quantity, completed_quantity, batch_number, status, start_date, completed_date,
      total_raw_material_cost_paise, total_labor_cost_paise, total_overhead_cost_paise,
      total_cost_paise, cost_per_unit_paise, notes
    ) VALUES (
      ?, ?, 'MFG-20261011-001', ?, ?, 'Executive Pure Cotton Shirts (Gift Box of 3)',
      20, 20, 'BATCH-OCT-2601', 'COMPLETED', date('now', '-2 days'), date('now', '-1 days'),
      174800, 56000, 24000, 254800, 12740,
      'First festival season production batch successfully passed quality check'
    )
  `).run(order1Id, mfgBizId, bomId, finShirtBoxId);

  // Seed In-Progress Production Run
  const order2Id = uuidv4();
  db.prepare(`
    INSERT INTO production_orders (
      id, business_id, order_number, bom_id, finished_product_id, finished_product_name,
      target_quantity, completed_quantity, batch_number, status, start_date,
      notes
    ) VALUES (
      ?, ?, 'MFG-20261011-002', ?, ?, 'Executive Pure Cotton Shirts (Gift Box of 3)',
      30, 0, 'BATCH-OCT-2602', 'IN_PROGRESS', date('now'),
      'Floor assembly run currently on cutting and overlock stage'
    )
  `).run(order2Id, mfgBizId, bomId, finShirtBoxId);

  console.log('[Seed] Manufacturing demo business (Apex Garments & Packaging) seeded successfully!');
}

function seedLoyaltyAndSchoolDemo() {
  console.log('[Seed] Checking Loyalty and School demo seeding...');

  // 1. Seed Loyalty Rules for Apna Supermart
  const existingLoyalty = db.prepare("SELECT id FROM loyalty_rules WHERE business_id = 'biz_supermart'").get();
  if (!existingLoyalty) {
    db.prepare(`
      INSERT INTO loyalty_rules (id, business_id, earn_points_per_rupees, point_value_paise, min_redeem_points, is_active)
      VALUES (?, 'biz_supermart', 100, 100, 10, 1)
    `).run(uuidv4());

    // Give some initial loyalty points to existing customers
    const customers = db.prepare("SELECT id, name FROM customers WHERE business_id = 'biz_supermart' LIMIT 3").all() as any[];
    if (customers.length > 0) {
      const updateCust = db.prepare('UPDATE customers SET loyalty_points = ? WHERE id = ?');
      const insertTrans = db.prepare(`
        INSERT INTO loyalty_transactions (id, business_id, customer_id, transaction_type, points, balance_after, notes)
        VALUES (?, 'biz_supermart', ?, 'EARNED', ?, ?, ?)
      `);

      const pointsArr = [185, 340, 520];
      customers.forEach((c, i) => {
        const pts = pointsArr[i % pointsArr.length];
        updateCust.run(pts, c.id);
        insertTrans.run(uuidv4(), c.id, pts, pts, 'Points earned on initial customer purchases');
      });
    }
    console.log('[Seed] Customer loyalty rules and points seeded for Apna Supermart');
  }

  // 2. Seed School Business: Vidyaniketan Public School & Academy
  const schoolBizId = 'biz_vidyaniketan';
  const existingSchool = db.prepare('SELECT id FROM businesses WHERE id = ?').get(schoolBizId);
  if (existingSchool) {
    return;
  }

  console.log('[Seed] Seeding School demo business (Vidyaniketan Academy)...');
  const userPasswordHash = bcrypt.hashSync('password123', 10);

  db.prepare(`
    INSERT INTO businesses (
      id, name, category, gstin, address, city, state, pincode, phone, email,
      plan_id, status, invoice_prefix, next_invoice_number
    ) VALUES (
      ?, 'Vidyaniketan Public School & Academy', 'SCHOOL', '27AABCV9988D1Z2',
      'Sector 12, Education Enclave, Kopar Khairane', 'Navi Mumbai', 'Maharashtra', '400709',
      '+91 98204 88776', 'principal@vidyaniketan.edu', 'plan_pro', 'ACTIVE', 'VPA-', 1001
    )
  `).run(schoolBizId);

  // User
  db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, ?, 'Dr. Aniruddha Sen (Principal)', 'principal@vidyaniketan.edu', ?, 'BUSINESS_OWNER', 'ACTIVE')
  `).run(uuidv4(), schoolBizId, userPasswordHash);

  // Fee Structures
  const insertFee = db.prepare(`
    INSERT INTO fee_structures (id, business_id, fee_name, grade_class, term_period, amount_paise, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertFee.run(uuidv4(), schoolBizId, 'Monthly Tuition Fee', 'Class 8', 'MONTHLY', 250000, 'Academic curriculum, lecture and mentoring');
  insertFee.run(uuidv4(), schoolBizId, 'Science & Computer Lab Fee', 'Class 8', 'MONTHLY', 60000, 'Laboratory materials and STEM software');
  insertFee.run(uuidv4(), schoolBizId, 'Annual Sports & Library Fee', 'Class 8', 'ANNUAL', 300000, 'Library subscription, sports gear, gymnasium');

  insertFee.run(uuidv4(), schoolBizId, 'Monthly Tuition Fee', 'Class 9', 'MONTHLY', 300000, 'Senior academic classes and science stream');
  insertFee.run(uuidv4(), schoolBizId, 'Computer Lab Fee', 'Class 9', 'MONTHLY', 80000, 'Coding, robotics, and multimedia lab');

  insertFee.run(uuidv4(), schoolBizId, 'Monthly Tuition Fee', 'Class 10', 'MONTHLY', 350000, 'Board preparation, mock exams and coaching');
  insertFee.run(uuidv4(), schoolBizId, 'Board Examination Prep & Lab', 'Class 10', 'ANNUAL', 450000, 'Special board test series and materials');

  // Students
  const insertStudent = db.prepare(`
    INSERT INTO students (
      id, business_id, admission_number, student_name, grade_class, section,
      roll_number, guardian_name, guardian_phone, guardian_email,
      annual_fees_paise, paid_fees_paise, outstanding_fees_paise, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `);

  const s1Id = uuidv4();
  const s2Id = uuidv4();
  const s3Id = uuidv4();

  // Student 1: Aarav Sharma (Class 10-A, ₹46,500 annual, ₹32,000 paid, ₹14,500 dues)
  insertStudent.run(
    s1Id, schoolBizId, 'ADM-2026-0101', 'Aarav Sharma', 'Class 10', 'A',
    '01', 'Rajesh Sharma', '+91 98201 11223', 'rajesh.sharma@example.com',
    4650000, 3200000, 1450000
  );

  // Student 2: Diya Mukherjee (Class 9-A, ₹45,600 annual, ₹45,600 paid, ₹0 dues)
  insertStudent.run(
    s2Id, schoolBizId, 'ADM-2026-0204', 'Diya Mukherjee', 'Class 9', 'A',
    '04', 'Ananya Mukherjee', '+91 98201 44556', 'ananya.m@example.com',
    4560000, 4560000, 0
  );

  // Student 3: Rohan Gupta (Class 8-B, ₹40,200 annual, ₹20,000 paid, ₹20,200 dues)
  insertStudent.run(
    s3Id, schoolBizId, 'ADM-2026-0312', 'Rohan Gupta', 'Class 8', 'B',
    '12', 'Manoj Gupta', '+91 98201 77889', 'manoj.gupta@example.com',
    4020000, 2000000, 2020000
  );

  // Sample Fee Receipts
  const insertReceipt = db.prepare(`
    INSERT INTO fee_receipts (
      id, business_id, receipt_number, student_id, student_name, grade_class,
      amount_paise, payment_mode, receipt_date, term_period, fee_breakdown_json, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertReceipt.run(
    uuidv4(), schoolBizId, 'FEE-20261001-001', s1Id, 'Aarav Sharma', 'Class 10',
    1600000, 'UPI', '2026-10-01', 'QUARTERLY',
    JSON.stringify([{ name: 'Quarter 1 Tuition Fee', amount_paise: 1050000 }, { name: 'Board Examination Prep', amount_paise: 550000 }]),
    'Fee paid via UPI QR at school accounts office'
  );

  insertReceipt.run(
    uuidv4(), schoolBizId, 'FEE-20261005-002', s2Id, 'Diya Mukherjee', 'Class 9',
    2280000, 'BANK_TRANSFER', '2026-10-05', 'QUARTERLY',
    JSON.stringify([{ name: 'Term 1 Tuition Fee', amount_paise: 1800000 }, { name: 'Computer Lab Fee', amount_paise: 480000 }]),
    'Full term fee received via NEFT transfer'
  );

  console.log('[Seed] School demo business (Vidyaniketan Public School) seeded successfully!');
}

function seedWholesaleAndServices() {
  console.log('[Seed] Checking Wholesale, Distribution and Service Business seeding...');
  const prodAtta = db.prepare(`SELECT id FROM products WHERE sku = 'ATT-AAR-10K' LIMIT 1`).get() as any;
  if (prodAtta?.id) {
    db.prepare(`
      INSERT OR IGNORE INTO bulk_price_slabs (id, business_id, product_id, min_quantity, max_quantity, slab_price_paise)
      VALUES (?, ?, ?, 10, 49, 44000)
    `).run('slab_demo_1', 'biz_supermart', prodAtta.id);

    db.prepare(`
      INSERT OR IGNORE INTO bulk_price_slabs (id, business_id, product_id, min_quantity, max_quantity, slab_price_paise)
      VALUES (?, ?, ?, 50, NULL, 41500)
    `).run('slab_demo_2', 'biz_supermart', prodAtta.id);
  }

  db.prepare(`
    INSERT OR IGNORE INTO distributor_routes (id, business_id, route_name, salesperson_name, area_zone)
    VALUES (?, ?, 'Route 1 - Western Suburbs Market', 'Suresh Parab', 'Andheri to Borivali North')
  `).run('route_demo_1', 'biz_supermart');

  // Customer Wholesale Credit update
  const custSharma = db.prepare(`SELECT id FROM customers WHERE name LIKE '%Sharma%' AND business_id = 'biz_supermart' LIMIT 1`).get() as any;
  if (custSharma?.id) {
    db.prepare(`
      UPDATE customers 
      SET customer_type = 'WHOLESALE', credit_limit_paise = 5000000, credit_days = 45, outstanding_balance_paise = 1450000
      WHERE id = ?
    `).run(custSharma.id);

    db.prepare(`
      INSERT OR IGNORE INTO party_ledger_entries (id, business_id, customer_id, entry_type, reference_no, debit_paise, credit_paise, running_balance_paise, notes)
      VALUES (?, 'biz_supermart', ?, 'INVOICE_DEBIT', 'INV-1002', 1450000, 0, 1450000, 'Wholesale bulk order invoice')
    `).run('ledger_demo_1', custSharma.id);
  }

  // =========================================================================
  // SEED SERVICE BUSINESS & JOB CARDS (PRD §5)
  // =========================================================================
  console.log('[Seed] Seeding Service Appointments & Job Cards demo data...');
  const today = new Date().toISOString().split('T')[0];

  db.prepare(`
    INSERT OR IGNORE INTO service_appointments (
      id, business_id, customer_name, customer_phone, service_name, staff_name, appointment_date, appointment_time, estimated_cost_paise, status, notes
    ) VALUES (
      'apt_demo_1', 'biz_supermart', 'Rajesh K. Mehta', '+91 98200 44332',
      'Commercial Air Conditioner Annual Servicing', 'Vinay Technician', ?, '11:00 AM', 250000, 'SCHEDULED', 'Customer requested pre-inspection call'
    )
  `).run(today);

  db.prepare(`
    INSERT OR IGNORE INTO service_records (
      id, business_id, job_card_number, customer_name, customer_phone, asset_item_name,
      serial_or_reg_number, issue_reported, diagnosis_notes, parts_cost_paise, labor_cost_paise, total_cost_paise, status, assigned_technician
    ) VALUES (
      'job_demo_1', 'biz_supermart', 'JOB-2026-0001', 'Sunil Deshmukh', '+91 98190 88776',
      'Electronic POS Billing Terminal & Thermal Printer', 'POS-HW-8892', 'Printer paper feed roller jamming intermittently',
      'Roller gear worn out; cleaned sensor and replaced 58mm gear assembly', 45000, 35000, 80000, 'COMPLETED', 'Vinay Technician'
    )
  `).run();

  const sharmaCustId = custSharma?.id || 'cust_demo_sharma';
  db.prepare(`
    INSERT OR IGNORE INTO recurring_invoices (
      id, business_id, customer_id, customer_name, frequency, amount_paise, description, next_run_date, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rec_demo_1',
    'biz_supermart',
    sharmaCustId,
    'Sharma Departmental Stores',
    'MONTHLY',
    1200000,
    'Monthly IT Maintenance & POS Cloud Retainer Support',
    today,
    'ACTIVE'
  );

  // Seed Hardware & Gateway Settings
  db.prepare(`
    INSERT OR IGNORE INTO hardware_settings (
      id, business_id, printer_type, printer_interface, auto_cut_paper, open_cash_drawer,
      weighing_scale_enabled, weighing_scale_baud_rate, sms_gateway_provider, sms_sender_id, auto_send_bill_sms, auto_send_appointment_sms
    ) VALUES (
      'hw_demo_1', 'biz_supermart', 'THERMAL_80MM', 'BROWSER_POPUP', 1, 1, 1, 9600, 'WHATSAPP_DIRECT', 'APNA-BILL', 1, 1
    )
  `).run();
}

// Run directly if called from CLI
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  runSeed();
}


