export const SCHEMA_SQL = `
-- Plans (Platform Super Admin managed)
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  price_paise INTEGER NOT NULL DEFAULT 0,
  billing_period TEXT NOT NULL DEFAULT 'MONTHLY',
  max_users INTEGER NOT NULL DEFAULT 2,
  max_branches INTEGER NOT NULL DEFAULT 1,
  max_invoices_per_month INTEGER NOT NULL DEFAULT 100,
  features_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Businesses (Tenants)
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  gstin TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'Maharashtra',
  pincode TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  invoice_prefix TEXT NOT NULL DEFAULT 'INV-',
  next_invoice_number INTEGER NOT NULL DEFAULT 1001,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'BUSINESS_OWNER',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Product Categories
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Products & Services
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  barcode TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  hsn_code TEXT,
  purchase_price_paise INTEGER NOT NULL DEFAULT 0,
  sale_price_paise INTEGER NOT NULL DEFAULT 0,
  mrp_paise INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 18.0,
  stock_quantity REAL NOT NULL DEFAULT 0,
  low_stock_threshold REAL NOT NULL DEFAULT 5,
  is_active INTEGER NOT NULL DEFAULT 1,
  extra_attributes_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  address TEXT,
  credit_limit_paise INTEGER NOT NULL DEFAULT 0,
  outstanding_balance_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Invoices (Sales)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT 'Walk-in Customer',
  customer_phone TEXT,
  customer_gstin TEXT,
  invoice_date TEXT NOT NULL DEFAULT (date('now')),
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  cgst_paise INTEGER NOT NULL DEFAULT 0,
  sgst_paise INTEGER NOT NULL DEFAULT 0,
  igst_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'CASH',
  payment_status TEXT NOT NULL DEFAULT 'PAID',
  amount_paid_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ISSUED',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Invoice Line Items
CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  sku TEXT,
  hsn_code TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0
);

-- Payments (Cash / UPI / Card / Bank / Credit)
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  amount_paise INTEGER NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'CASH',
  reference_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stock Movement Ledger
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change_quantity REAL NOT NULL,
  resulting_quantity REAL NOT NULL,
  movement_type TEXT NOT NULL, -- INVOICE, MANUAL_ADJUSTMENT, PURCHASE, RETURN
  reference_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  business_id TEXT REFERENCES businesses(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Support Tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  gstin TEXT,
  address TEXT,
  outstanding_balance_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Purchase Invoices
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  purchase_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL DEFAULT (date('now')),
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'PAID', -- PAID, PARTIAL, UNPAID
  amount_paid_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Purchase Items
CREATE TABLE IF NOT EXISTS purchase_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_id TEXT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- Rent, Electricity, Salaries, Maintenance, Packaging, Miscellaneous
  amount_paise INTEGER NOT NULL DEFAULT 0,
  expense_date TEXT NOT NULL DEFAULT (date('now')),
  payment_mode TEXT NOT NULL DEFAULT 'CASH',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Staff Users
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'CASHIER', -- MANAGER, ACCOUNTANT, CASHIER
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Quotations & Proforma Invoices
CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quotation_number TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT 'Prospective Client',
  customer_phone TEXT,
  valid_until TEXT,
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT, SENT, CONVERTED
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0
);

-- Coupons & Promotional Discounts
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL DEFAULT 'PERCENT', -- PERCENT, FLAT
  discount_value REAL NOT NULL DEFAULT 10,
  min_order_paise INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Restaurant Tables
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  table_number TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'VACANT', -- VACANT, OCCUPIED, BILLED
  current_order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kitchen Order Tickets (KOT)
CREATE TABLE IF NOT EXISTS kots (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kot_number TEXT NOT NULL,
  table_number TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, PREPARING, READY, SERVED
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'LOW_STOCK',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Multi-Store / Branches (Phase 5)
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  manager_name TEXT,
  is_main INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Database Backups History (Phase 5)
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  backup_name TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  file_size_kb REAL NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Credit Notes (Sales Returns & Refunds - Phase 6)
CREATE TABLE IF NOT EXISTS credit_notes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  credit_note_number TEXT NOT NULL,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  return_date TEXT NOT NULL DEFAULT (date('now')),
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_refund_paise INTEGER NOT NULL DEFAULT 0,
  refund_mode TEXT NOT NULL DEFAULT 'CASH', -- CASH, UPI, BANK_TRANSFER, STORE_CREDIT
  reason TEXT, -- DEFECTIVE, WRONG_ITEM, CUSTOMER_CHANGE_MIND, EXPIRED, OTHER
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Credit Note Items
CREATE TABLE IF NOT EXISTS credit_note_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  credit_note_id TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  sku TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0
);

-- Debit Notes (Purchase Returns - Phase 6)
CREATE TABLE IF NOT EXISTS debit_notes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  debit_note_number TEXT NOT NULL,
  purchase_id TEXT REFERENCES purchase_invoices(id) ON DELETE SET NULL,
  purchase_number TEXT NOT NULL,
  supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  supplier_phone TEXT,
  return_date TEXT NOT NULL DEFAULT (date('now')),
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  refund_mode TEXT NOT NULL DEFAULT 'CASH', -- CASH, BANK_TRANSFER, ADJUST_PAYABLE
  reason TEXT, -- DAMAGED_GOODS, WRONG_DELIVERY, SHORT_EXPIRY, QUALITY_ISSUE, OTHER
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Debit Note Items
CREATE TABLE IF NOT EXISTS debit_note_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  debit_note_id TEXT NOT NULL REFERENCES debit_notes(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0
);

-- Clothing & Fashion Variant Matrix (PRD §5)
CREATE TABLE IF NOT EXISTS clothing_variants (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  parent_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_sku TEXT NOT NULL,
  barcode TEXT,
  size TEXT NOT NULL, -- e.g. XS, S, M, L, XL, XXL, 30, 32, 34, 36, Free Size
  color TEXT NOT NULL, -- e.g. Navy Blue, Jet Black, Off-White, Maroon
  fabric TEXT, -- e.g. 100% Cotton, Denim, Linen, Silk
  stock_quantity REAL NOT NULL DEFAULT 0,
  sale_price_paise INTEGER NOT NULL DEFAULT 0,
  mrp_paise INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Garment Size/Color Exchanges (PRD §5)
CREATE TABLE IF NOT EXISTS garment_exchanges (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  exchange_number TEXT NOT NULL,
  original_invoice_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  returned_variant_id TEXT REFERENCES clothing_variants(id) ON DELETE SET NULL,
  returned_product_name TEXT NOT NULL,
  returned_size TEXT NOT NULL,
  returned_color TEXT NOT NULL,
  returned_quantity REAL NOT NULL DEFAULT 1,
  issued_variant_id TEXT REFERENCES clothing_variants(id) ON DELETE SET NULL,
  issued_product_name TEXT NOT NULL,
  issued_size TEXT NOT NULL,
  issued_color TEXT NOT NULL,
  issued_quantity REAL NOT NULL DEFAULT 1,
  price_difference_paise INTEGER NOT NULL DEFAULT 0,
  payment_mode TEXT DEFAULT 'CASH',
  reason TEXT NOT NULL DEFAULT 'WRONG_SIZE', -- WRONG_SIZE, COLOR_MISMATCH, DEFECT, FIT_ISSUE, OTHER
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Inter-Branch Stock Transfers & Challans (PRD §4.4 & §4.19)
CREATE TABLE IF NOT EXISTS stock_transfers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  transfer_number TEXT NOT NULL,
  source_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  source_branch_name TEXT NOT NULL,
  dest_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  dest_branch_name TEXT NOT NULL,
  transfer_date TEXT NOT NULL DEFAULT (date('now')),
  status TEXT NOT NULL DEFAULT 'IN_TRANSIT', -- 'IN_TRANSIT', 'COMPLETED', 'CANCELLED'
  total_items_count INTEGER NOT NULL DEFAULT 0,
  total_quantity REAL NOT NULL DEFAULT 0,
  tracking_number TEXT,
  notes TEXT,
  dispatched_by TEXT REFERENCES users(id),
  received_by TEXT REFERENCES users(id),
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stock Transfer Line Items
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  transfer_id TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  sku TEXT,
  dispatched_quantity REAL NOT NULL DEFAULT 1,
  received_quantity REAL DEFAULT 0,
  unit TEXT DEFAULT 'Pcs'
);

-- Indexes for lightning fast lookups and strict multi-tenancy performance
CREATE INDEX IF NOT EXISTS idx_products_tenant_lookup ON products(business_id, barcode, sku);
CREATE INDEX IF NOT EXISTS idx_products_tenant_category ON products(business_id, category_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_date ON invoices(business_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_num ON invoices(business_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tenant_inv ON invoice_items(business_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_prod ON stock_movements(business_id, product_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone ON customers(business_id, phone);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(business_id);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant ON purchase_invoices(business_id);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant ON expenses(business_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_staff_tenant ON staff(business_id);
CREATE INDEX IF NOT EXISTS idx_quotations_tenant ON quotations(business_id);
CREATE INDEX IF NOT EXISTS idx_tables_tenant ON restaurant_tables(business_id);
CREATE INDEX IF NOT EXISTS idx_kots_tenant ON kots(business_id, status);
CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(business_id);
CREATE INDEX IF NOT EXISTS idx_backups_tenant ON backups(business_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_credit_notes_tenant ON credit_notes(business_id, credit_note_number);
CREATE INDEX IF NOT EXISTS idx_credit_notes_inv ON credit_notes(business_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_credit_items_cn ON credit_note_items(business_id, credit_note_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_tenant ON debit_notes(business_id, debit_note_number);
CREATE INDEX IF NOT EXISTS idx_debit_notes_pur ON debit_notes(business_id, purchase_id);
CREATE INDEX IF NOT EXISTS idx_debit_items_dn ON debit_note_items(business_id, debit_note_id);
CREATE INDEX IF NOT EXISTS idx_clothing_variants_tenant ON clothing_variants(business_id, parent_product_id);
CREATE INDEX IF NOT EXISTS idx_clothing_variants_bar ON clothing_variants(business_id, barcode);
CREATE INDEX IF NOT EXISTS idx_garment_exchanges_num ON garment_exchanges(business_id, exchange_number);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_tenant ON stock_transfers(business_id, transfer_number);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfers(business_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items ON stock_transfer_items(business_id, transfer_id);

-- Online Storefront & E-Commerce Orders (PRD §4.20)
CREATE TABLE IF NOT EXISTS online_stores (
  id TEXT PRIMARY KEY,
  business_id TEXT UNIQUE NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL,
  store_name TEXT NOT NULL,
  tagline TEXT,
  banner_message TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  min_order_amount_paise INTEGER NOT NULL DEFAULT 0,
  delivery_fee_paise INTEGER NOT NULL DEFAULT 0,
  accept_cod INTEGER NOT NULL DEFAULT 1,
  accept_online INTEGER NOT NULL DEFAULT 1,
  contact_phone TEXT,
  contact_whatsapp TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS online_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  delivery_address TEXT NOT NULL,
  delivery_city TEXT,
  delivery_pincode TEXT,
  notes TEXT,
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  delivery_fee_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'
  payment_mode TEXT NOT NULL DEFAULT 'COD', -- 'COD', 'UPI', 'CARD'
  payment_status TEXT NOT NULL DEFAULT 'UNPAID', -- 'UNPAID', 'PAID'
  converted_invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS online_order_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  sku TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0
);

-- Manufacturing Bill of Materials (BOM) & Work Orders (PRD §5)
CREATE TABLE IF NOT EXISTS bom_recipes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bom_code TEXT NOT NULL,
  finished_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  finished_product_name TEXT NOT NULL,
  output_quantity REAL NOT NULL DEFAULT 1,
  output_unit TEXT DEFAULT 'Pcs',
  estimated_labor_cost_paise INTEGER NOT NULL DEFAULT 0,
  estimated_overhead_cost_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bom_items (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bom_id TEXT NOT NULL REFERENCES bom_recipes(id) ON DELETE CASCADE,
  raw_material_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  raw_material_name TEXT NOT NULL,
  quantity_required REAL NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'Kg',
  wastage_percent REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS production_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  bom_id TEXT NOT NULL REFERENCES bom_recipes(id),
  finished_product_id TEXT NOT NULL REFERENCES products(id),
  finished_product_name TEXT NOT NULL,
  target_quantity REAL NOT NULL DEFAULT 1,
  completed_quantity REAL DEFAULT 0,
  batch_number TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNED', -- 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  start_date TEXT NOT NULL DEFAULT (date('now')),
  completed_date TEXT,
  total_raw_material_cost_paise INTEGER NOT NULL DEFAULT 0,
  total_labor_cost_paise INTEGER NOT NULL DEFAULT 0,
  total_overhead_cost_paise INTEGER NOT NULL DEFAULT 0,
  total_cost_paise INTEGER NOT NULL DEFAULT 0,
  cost_per_unit_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS production_material_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  production_order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  raw_material_id TEXT NOT NULL REFERENCES products(id),
  raw_material_name TEXT NOT NULL,
  quantity_consumed REAL NOT NULL,
  unit_cost_paise INTEGER NOT NULL DEFAULT 0,
  total_cost_paise INTEGER NOT NULL DEFAULT 0
);

-- Additional Indexes for Online Stores & Manufacturing Performance
CREATE INDEX IF NOT EXISTS idx_online_stores_slug ON online_stores(slug);
CREATE INDEX IF NOT EXISTS idx_online_orders_biz ON online_orders(business_id, status);
CREATE INDEX IF NOT EXISTS idx_online_orders_num ON online_orders(business_id, order_number);
CREATE INDEX IF NOT EXISTS idx_online_order_items_ord ON online_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_bom_recipes_biz ON bom_recipes(business_id, is_active);
CREATE INDEX IF NOT EXISTS idx_bom_recipes_prod ON bom_recipes(business_id, finished_product_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON bom_items(bom_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_biz ON production_orders(business_id, status);
CREATE INDEX IF NOT EXISTS idx_production_orders_num ON production_orders(business_id, order_number);
CREATE INDEX IF NOT EXISTS idx_production_logs_ord ON production_material_logs(production_order_id);

-- Customer Loyalty Program & Rewards Ledger (PRD §4.13)
CREATE TABLE IF NOT EXISTS loyalty_rules (
  id TEXT PRIMARY KEY,
  business_id TEXT UNIQUE NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  earn_points_per_rupees REAL NOT NULL DEFAULT 100, -- e.g. Earn 1 point per ₹100 spent
  point_value_paise INTEGER NOT NULL DEFAULT 100, -- 1 point = 100 paise = ₹1.00 discount
  min_redeem_points INTEGER NOT NULL DEFAULT 10,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL, -- 'EARNED', 'REDEEMED', 'MANUAL_ADJUSTMENT'
  points INTEGER NOT NULL,
  balance_after INTEGER NOT NULL DEFAULT 0,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- School & Institute Fee Collection Vertical (PRD §5)
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  admission_number TEXT NOT NULL,
  student_name TEXT NOT NULL,
  grade_class TEXT NOT NULL,
  section TEXT DEFAULT 'A',
  roll_number TEXT,
  guardian_name TEXT NOT NULL,
  guardian_phone TEXT NOT NULL,
  guardian_email TEXT,
  annual_fees_paise INTEGER NOT NULL DEFAULT 0,
  paid_fees_paise INTEGER NOT NULL DEFAULT 0,
  outstanding_fees_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fee_structures (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  fee_name TEXT NOT NULL,
  grade_class TEXT NOT NULL,
  term_period TEXT NOT NULL DEFAULT 'MONTHLY',
  amount_paise INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fee_receipts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  receipt_number TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL,
  grade_class TEXT NOT NULL,
  amount_paise INTEGER NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL DEFAULT 'CASH',
  receipt_date TEXT NOT NULL DEFAULT (date('now')),
  term_period TEXT NOT NULL DEFAULT 'MONTHLY',
  fee_breakdown_json TEXT DEFAULT '[]',
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wholesale & Distribution Vertical (PRD §5)
CREATE TABLE IF NOT EXISTS bulk_price_slabs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_quantity REAL NOT NULL DEFAULT 1,
  max_quantity REAL,
  slab_price_paise INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS distributor_routes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  route_name TEXT NOT NULL,
  salesperson_name TEXT,
  area_zone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS party_ledger_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL, -- 'INVOICE_DEBIT', 'PAYMENT_CREDIT', 'RETURN_CREDIT', 'ADJUSTMENT'
  reference_no TEXT,
  debit_paise INTEGER NOT NULL DEFAULT 0,
  credit_paise INTEGER NOT NULL DEFAULT 0,
  running_balance_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Service Businesses Vertical (PRD §5)
CREATE TABLE IF NOT EXISTS service_appointments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  service_name TEXT NOT NULL,
  staff_name TEXT,
  appointment_date TEXT NOT NULL,
  appointment_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED', -- 'SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  estimated_cost_paise INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_records (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_card_number TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  asset_item_name TEXT NOT NULL, -- e.g. "Royal Enfield Classic 350", "HP Pavilion 15"
  serial_or_reg_number TEXT,
  issue_reported TEXT NOT NULL,
  diagnosis_notes TEXT,
  parts_cost_paise INTEGER NOT NULL DEFAULT 0,
  labor_cost_paise INTEGER NOT NULL DEFAULT 0,
  total_cost_paise INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'IN_PROGRESS', 'WAITING_FOR_PARTS', 'COMPLETED', 'DELIVERED'
  assigned_technician TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'MONTHLY', -- 'MONTHLY', 'QUARTERLY', 'ANNUAL'
  amount_paise INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  next_run_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'PAUSED'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hardware & Gateway Settings (PRD §8 & §9)
CREATE TABLE IF NOT EXISTS hardware_settings (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  printer_type TEXT NOT NULL DEFAULT 'THERMAL_80MM', -- 'THERMAL_80MM', 'THERMAL_58MM', 'LASER_A4'
  printer_interface TEXT NOT NULL DEFAULT 'BROWSER_POPUP', -- 'BROWSER_POPUP', 'RAW_BT', 'NETWORK_ESC_POS'
  auto_cut_paper INTEGER NOT NULL DEFAULT 1,
  open_cash_drawer INTEGER NOT NULL DEFAULT 1,
  weighing_scale_enabled INTEGER NOT NULL DEFAULT 0,
  weighing_scale_baud_rate INTEGER NOT NULL DEFAULT 9600,
  sms_gateway_provider TEXT NOT NULL DEFAULT 'WHATSAPP_DIRECT', -- 'WHATSAPP_DIRECT', 'TWILIO', 'FAST2SMS'
  sms_api_key TEXT,
  sms_sender_id TEXT,
  auto_send_bill_sms INTEGER NOT NULL DEFAULT 1,
  auto_send_appointment_sms INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for Loyalty & School Performance
CREATE INDEX IF NOT EXISTS idx_loyalty_trans_cust ON loyalty_transactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_trans_biz ON loyalty_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_students_biz_adm ON students(business_id, admission_number);
CREATE INDEX IF NOT EXISTS idx_students_biz_class ON students(business_id, grade_class);
CREATE INDEX IF NOT EXISTS idx_fee_struct_biz ON fee_structures(business_id, grade_class);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_biz ON fee_receipts(business_id, receipt_number);
CREATE INDEX IF NOT EXISTS idx_fee_receipts_stu ON fee_receipts(student_id);

-- Indexes for Wholesale & Services Performance
CREATE INDEX IF NOT EXISTS idx_bulk_slabs_prod ON bulk_price_slabs(business_id, product_id);
CREATE INDEX IF NOT EXISTS idx_party_ledger_cust ON party_ledger_entries(business_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_appointments_biz_date ON service_appointments(business_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_job_cards_biz ON service_records(business_id, job_card_number);
CREATE INDEX IF NOT EXISTS idx_recurring_inv_biz ON recurring_invoices(business_id, status);
`;



