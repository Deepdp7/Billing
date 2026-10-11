"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSeed = runSeed;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const uuid_1 = require("uuid");
const connection_js_1 = require("./connection.js");
function runSeed() {
    console.log('[Seed] Checking database seeding...');
    // Check if already seeded
    const existingPlans = connection_js_1.db.prepare('SELECT COUNT(*) as count FROM plans').get();
    if (existingPlans && existingPlans.count > 0) {
        console.log('[Seed] Database is already seeded.');
        return;
    }
    console.log('[Seed] Seeding initial plans, admin, and demo businesses...');
    const passwordHash = bcryptjs_1.default.hashSync('admin123', 10);
    const userPasswordHash = bcryptjs_1.default.hashSync('password123', 10);
    // 1. Insert Plans
    const insertPlan = connection_js_1.db.prepare(`
    INSERT INTO plans (id, name, tier, price_paise, billing_period, max_users, max_branches, max_invoices_per_month, features_json, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const freePlanId = 'plan_free';
    const proPlanId = 'plan_pro';
    const businessPlanId = 'plan_business';
    insertPlan.run(freePlanId, 'Starter Free', 'FREE', 0, 'MONTHLY', 2, 1, 100, JSON.stringify(['POS Billing', 'Product Catalog', 'GST Invoices', 'Basic Reports']), 1);
    insertPlan.run(proPlanId, 'Growth Pro', 'PRO', 99900, // ₹999.00
    'MONTHLY', 10, 3, 5000, JSON.stringify(['All Starter Features', 'Industry Vertical Modules', 'Stock Alerts', 'Customer Credit Ledger', 'Thermal + A4 Printing', 'Audit Logs']), 1);
    insertPlan.run(businessPlanId, 'Enterprise Scale', 'BUSINESS', 249900, // ₹2499.00
    'MONTHLY', 50, 10, 100000, JSON.stringify(['All Pro Features', 'Multi-Branch Sync', 'Unlimited Invoices', 'Advanced Analytics', 'Priority 24/7 Support', 'Custom Branding']), 1);
    // 2. Insert Platform Super Admin
    const adminId = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, NULL, ?, ?, ?, 'SUPER_ADMIN', 'ACTIVE')
  `).run(adminId, 'Platform Super Admin', 'admin@apnabilling.com', passwordHash);
    // 3. Insert Business 1: Apna Supermart (GROCERY)
    const groceryBizId = 'biz_supermart';
    connection_js_1.db.prepare(`
    INSERT INTO businesses (id, name, category, gstin, address, city, state, pincode, phone, email, plan_id, status, invoice_prefix, next_invoice_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'ASM-', 1005)
  `).run(groceryBizId, 'Apna Supermart & Retail', 'GROCERY', '27AABCA1234A1Z5', 'Shop 12-14, Sunrise Plaza, MG Road', 'Pune', 'Maharashtra', '411001', '+91 9823012345', 'owner@apnasupermart.com', proPlanId);
    // Grocery Owner User
    const groceryOwnerId = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, 'BUSINESS_OWNER', 'ACTIVE')
  `).run(groceryOwnerId, groceryBizId, 'Rajesh Agrawal', 'owner@apnasupermart.com', userPasswordHash);
    // Grocery Categories
    const catGroceries = (0, uuid_1.v4)();
    const catDairy = (0, uuid_1.v4)();
    const catSnacks = (0, uuid_1.v4)();
    const catPersonal = (0, uuid_1.v4)();
    const insertCategory = connection_js_1.db.prepare(`INSERT INTO categories (id, business_id, name, description) VALUES (?, ?, ?, ?)`);
    insertCategory.run(catGroceries, groceryBizId, 'Foodgrains & Staples', 'Atta, rice, dal, oils, spices');
    insertCategory.run(catDairy, groceryBizId, 'Dairy & Breakfast', 'Milk, butter, cheese, bread, cereals');
    insertCategory.run(catSnacks, groceryBizId, 'Snacks & Packaged Food', 'Biscuits, noodles, chips, beverages');
    insertCategory.run(catPersonal, groceryBizId, 'Personal & Home Care', 'Soaps, detergents, toiletries');
    // Grocery Products (with real barcodes, HSN, taxes in paise)
    const insertProduct = connection_js_1.db.prepare(`
    INSERT INTO products (id, business_id, category_id, name, sku, barcode, unit, hsn_code, purchase_price_paise, sale_price_paise, mrp_paise, tax_rate, stock_quantity, low_stock_threshold, is_active, extra_attributes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
    const prod1 = (0, uuid_1.v4)();
    insertProduct.run(prod1, groceryBizId, catGroceries, 'Aashirvaad Shudh Chakki Atta 5kg', 'SKU-ATTA-5KG', '8901030382012', 'bag', '1101', 22000, 25000, 27500, 0, 48, 10, '{}');
    const prod2 = (0, uuid_1.v4)();
    insertProduct.run(prod2, groceryBizId, catDairy, 'Amul Butter Pasteurised 500g', 'SKU-AMUL-500G', '8901262010053', 'pack', '0405', 24000, 27000, 28500, 12, 32, 8, '{}');
    const prod3 = (0, uuid_1.v4)();
    insertProduct.run(prod3, groceryBizId, catGroceries, 'Tata Salt Vacuum Evaporated 1kg', 'SKU-SALT-1KG', '8904004400018', 'pkt', '2501', 2000, 2500, 2800, 0, 120, 25, '{}');
    const prod4 = (0, uuid_1.v4)();
    insertProduct.run(prod4, groceryBizId, catSnacks, 'Maggi 2-Minute Masala Noodles 280g', 'SKU-MAGGI-280', '8901058852375', 'pkt', '1902', 4600, 5400, 6000, 18, 85, 20, '{}');
    const prod5 = (0, uuid_1.v4)();
    insertProduct.run(prod5, groceryBizId, catPersonal, 'Dettol Original Bathing Soap 125g', 'SKU-DETT-125G', '8901396112015', 'bar', '3401', 4800, 5800, 6500, 18, 6, 10, '{}'); // Low stock demo!
    const prod6 = (0, uuid_1.v4)();
    insertProduct.run(prod6, groceryBizId, catGroceries, 'Fortune Sunlite Sunflower Oil 1L Pouch', 'SKU-FORT-1L', '8906007281023', 'pouch', '1512', 12800, 14900, 16500, 5, 42, 10, '{}');
    const prod7 = (0, uuid_1.v4)();
    insertProduct.run(prod7, groceryBizId, catSnacks, 'Parle-G Gold Biscuits 1kg Family Pack', 'SKU-PARLE-1KG', '8901719101019', 'pack', '1905', 9200, 10500, 12000, 18, 55, 15, '{}');
    const prod8 = (0, uuid_1.v4)();
    insertProduct.run(prod8, groceryBizId, catSnacks, 'Coca-Cola Soft Drink 750ml Bottle', 'SKU-COKE-750', '8901764012018', 'bottle', '2202', 3200, 4000, 4500, 28, 4, 12, '{}'); // Low stock demo!
    // Grocery Customers
    const cust1 = (0, uuid_1.v4)();
    const cust2 = (0, uuid_1.v4)();
    const insertCustomer = connection_js_1.db.prepare(`
    INSERT INTO customers (id, business_id, name, phone, email, gstin, address, credit_limit_paise, outstanding_balance_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    insertCustomer.run(cust1, groceryBizId, 'Ramesh Sharma', '+91 9876543210', 'ramesh@gmail.com', '', 'Flat 402, Green Acres, Pune', 1000000, 0);
    insertCustomer.run(cust2, groceryBizId, 'Priya Patel', '+91 9811223344', 'priya.patel@outloook.com', '27AABCP1234F1Z5', 'Bungalow 7, Koregaon Park, Pune', 2500000, 145000); // Has ₹1450 outstanding
    // Grocery Past Invoices (to give rich initial graphs and stats!)
    const insertInvoice = connection_js_1.db.prepare(`
    INSERT INTO invoices (
      id, business_id, invoice_number, customer_id, customer_name, customer_phone,
      invoice_date, subtotal_paise, discount_paise, tax_paise, cgst_paise, sgst_paise,
      total_paise, payment_mode, payment_status, amount_paid_paise, notes, created_by, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?)
  `);
    const insertItem = connection_js_1.db.prepare(`
    INSERT INTO invoice_items (id, business_id, invoice_id, product_id, product_name, sku, hsn_code, quantity, unit_price_paise, discount_paise, tax_rate, tax_paise, total_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertStockMovement = connection_js_1.db.prepare(`
    INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    // Invoice 1 (Today)
    const inv1 = (0, uuid_1.v4)();
    const today = new Date().toISOString().split('T')[0];
    insertInvoice.run(inv1, groceryBizId, 'ASM-1001', cust1, 'Ramesh Sharma', '+91 9876543210', today, 62400, 2400, 5400, 2700, 2700, 65400, 'UPI', 'PAID', 65400, 'Counter 1 UPI QR payment', groceryOwnerId, new Date().toISOString());
    insertItem.run((0, uuid_1.v4)(), groceryBizId, inv1, prod1, 'Aashirvaad Shudh Chakki Atta 5kg', 'SKU-ATTA-5KG', '1101', 2, 25000, 0, 0, 0, 50000);
    insertItem.run((0, uuid_1.v4)(), groceryBizId, inv1, prod4, 'Maggi 2-Minute Masala Noodles 280g', 'SKU-MAGGI-280', '1902', 2, 5400, 0, 18, 1944, 12744);
    insertStockMovement.run((0, uuid_1.v4)(), groceryBizId, prod1, -2, 48, 'INVOICE', inv1, 'Sale in ASM-1001', new Date().toISOString());
    insertStockMovement.run((0, uuid_1.v4)(), groceryBizId, prod4, -2, 85, 'INVOICE', inv1, 'Sale in ASM-1001', new Date().toISOString());
    // Invoice 2 (Today)
    const inv2 = (0, uuid_1.v4)();
    insertInvoice.run(inv2, groceryBizId, 'ASM-1002', null, 'Walk-in Customer', '', today, 41900, 0, 3240, 1620, 1620, 45140, 'CASH', 'PAID', 45140, 'Cash checkout', groceryOwnerId, new Date().toISOString());
    insertItem.run((0, uuid_1.v4)(), groceryBizId, inv2, prod2, 'Amul Butter Pasteurised 500g', 'SKU-AMUL-500G', '0405', 1, 27000, 0, 12, 3240, 30240);
    insertItem.run((0, uuid_1.v4)(), groceryBizId, inv2, prod6, 'Fortune Sunlite Sunflower Oil 1L Pouch', 'SKU-FORT-1L', '1512', 1, 14900, 0, 5, 745, 15645);
    // 4. Insert Business 2: Spice Garden Cafe (RESTAURANT)
    const restBizId = 'biz_spicegarden';
    connection_js_1.db.prepare(`
    INSERT INTO businesses (id, name, category, gstin, address, city, state, pincode, phone, email, plan_id, status, invoice_prefix, next_invoice_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'SGC-', 2001)
  `).run(restBizId, 'Spice Garden Cafe & Fine Dining', 'RESTAURANT', '27AABCS9876C1Z8', 'Plot 45, FC Road', 'Pune', 'Maharashtra', '411005', '+91 9890112233', 'manager@spicegarden.com', proPlanId);
    const restOwnerId = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, 'BUSINESS_OWNER', 'ACTIVE')
  `).run(restOwnerId, restBizId, 'Chef Vikram Malhotra', 'manager@spicegarden.com', userPasswordHash);
    const catMains = (0, uuid_1.v4)();
    const catBeverages = (0, uuid_1.v4)();
    insertCategory.run(catMains, restBizId, 'Main Course & Breads', 'Gravies, paneer dishes, rotis and rice');
    insertCategory.run(catBeverages, restBizId, 'Beverages & Mocktails', 'Fresh coolers, milkshakes, coffees');
    insertProduct.run((0, uuid_1.v4)(), restBizId, catMains, 'Paneer Butter Masala', 'DISH-PBM', '', 'portion', '9963', 12000, 32000, 35000, 5, 999, 10, '{}');
    insertProduct.run((0, uuid_1.v4)(), restBizId, catMains, 'Butter Garlic Naan', 'DISH-BGN', '', 'pcs', '9963', 2000, 7500, 8500, 5, 999, 10, '{}');
    insertProduct.run((0, uuid_1.v4)(), restBizId, catMains, 'Dum Biryani Pot (Serves 2)', 'DISH-DBIR', '', 'pot', '9963', 16000, 42000, 46000, 5, 999, 10, '{}');
    insertProduct.run((0, uuid_1.v4)(), restBizId, catBeverages, 'Iced Hazelnut Frappe', 'BEV-FRA', '', 'glass', '9963', 4500, 18000, 19900, 5, 999, 10, '{}');
    // 5. Insert Business 3: Apollo Care Pharmacy (PHARMACY)
    const pharmBizId = 'biz_apollocare';
    connection_js_1.db.prepare(`
    INSERT INTO businesses (id, name, category, gstin, address, city, state, pincode, phone, email, plan_id, status, invoice_prefix, next_invoice_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'ACP-', 3001)
  `).run(pharmBizId, 'Apollo Care Chemist & Druggist', 'PHARMACY', '27AABCA5555M1Z2', 'Civil Hospital Road', 'Pune', 'Maharashtra', '411002', '+91 9765443322', 'pharmacist@apollocare.com', proPlanId);
    const pharmOwnerId = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO users (id, business_id, name, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?, 'BUSINESS_OWNER', 'ACTIVE')
  `).run(pharmOwnerId, pharmBizId, 'Dr. Neha Kulkarni', 'pharmacist@apollocare.com', userPasswordHash);
    const catRx = (0, uuid_1.v4)();
    insertCategory.run(catRx, pharmBizId, 'Tablets & Capsules', 'Prescription medicines');
    insertProduct.run((0, uuid_1.v4)(), pharmBizId, catRx, 'Dolo 650mg Paracetamol Tablets (Strip of 15)', 'MED-DOLO650', '8901234567890', 'strip', '3004', 2200, 3150, 3500, 12, 140, 20, JSON.stringify({ batch_no: 'DL-2026-B8', expiry_date: '2028-06-30', composition: 'Paracetamol 650mg' }));
    insertProduct.run((0, uuid_1.v4)(), pharmBizId, catRx, 'Augmentin 625 Duo Tablets (Strip of 10)', 'MED-AUG625', '8909876543211', 'strip', '3004', 16500, 21500, 23000, 12, 12, 15, JSON.stringify({ batch_no: 'AUG-991A', expiry_date: '2027-01-15', composition: 'Amoxicillin + Potassium Clavulanate' }));
    // 6. Seed Suppliers (Grocery)
    const supp1 = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO suppliers (id, business_id, name, phone, email, gstin, address, outstanding_balance_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(supp1, groceryBizId, 'Hindustan Unilever Distribution Hub', '+91 9988776655', 'sales@hul-distributor.com', '27AABCH1234H1Z1', 'Plot 10, MIDC Bhosari, Pune', 4500000);
    const supp2 = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO suppliers (id, business_id, name, phone, email, gstin, address, outstanding_balance_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(supp2, groceryBizId, 'Amul Dairy Co-op Wholesale', '+91 9822110033', 'orders@amuldairy.com', '27AABCA9999D1Z9', 'Khadki Market, Pune', 1850000);
    // 7. Seed Expenses (Grocery)
    const todayStr = new Date().toISOString().split('T')[0];
    connection_js_1.db.prepare(`
    INSERT INTO expenses (id, business_id, category, amount_paise, expense_date, payment_mode, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run((0, uuid_1.v4)(), groceryBizId, 'Electricity & Utilities', 450000, todayStr, 'UPI', 'Store Main Meter Electricity Bill');
    connection_js_1.db.prepare(`
    INSERT INTO expenses (id, business_id, category, amount_paise, expense_date, payment_mode, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run((0, uuid_1.v4)(), groceryBizId, 'Packaging & Bags', 120000, todayStr, 'CASH', 'Eco-friendly biodegradable carry bags');
    // 8. Seed Staff Accounts (Grocery)
    connection_js_1.db.prepare(`
    INSERT INTO staff (id, business_id, name, email, phone, role, status)
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run((0, uuid_1.v4)(), groceryBizId, 'Sunil Verma', 'cashier.sunil@apnasupermart.com', '+91 9870011223', 'CASHIER');
    connection_js_1.db.prepare(`
    INSERT INTO staff (id, business_id, name, email, phone, role, status)
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run((0, uuid_1.v4)(), groceryBizId, 'Pooja Mehra', 'accountant.pooja@apnasupermart.com', '+91 9870044556', 'ACCOUNTANT');
    // 9. Seed Restaurant Tables (Restaurant)
    const insertTable = connection_js_1.db.prepare(`
    INSERT INTO restaurant_tables (id, business_id, table_number, capacity, status)
    VALUES (?, ?, ?, ?, ?)
  `);
    insertTable.run((0, uuid_1.v4)(), restBizId, 'T1 - Window View', 4, 'OCCUPIED');
    insertTable.run((0, uuid_1.v4)(), restBizId, 'T2 - Couple Booth', 2, 'VACANT');
    insertTable.run((0, uuid_1.v4)(), restBizId, 'T3 - Family Lounge', 6, 'BILLED');
    insertTable.run((0, uuid_1.v4)(), restBizId, 'T4 - Garden Patio', 4, 'VACANT');
    // 10. Seed Notifications
    connection_js_1.db.prepare(`
    INSERT INTO notifications (id, business_id, title, message, type)
    VALUES (?, ?, ?, ?, ?)
  `).run((0, uuid_1.v4)(), groceryBizId, 'Low Stock Alert', 'Dettol Original Soap (SKU-DETT-125G) has only 6 units remaining.', 'LOW_STOCK');
    connection_js_1.db.prepare(`
    INSERT INTO notifications (id, business_id, title, message, type)
    VALUES (?, ?, ?, ?, ?)
  `).run((0, uuid_1.v4)(), groceryBizId, 'Supplier Payment Reminder', 'Payment of ₹45,000 due to Hindustan Unilever Distribution Hub.', 'PAYMENT_DUE');
    console.log('[Seed] Database successfully seeded with 3 demo businesses, realistic products, GST invoices, suppliers, expenses, staff, and platform admin!');
}
// Run directly if called from CLI
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
    runSeed();
}
