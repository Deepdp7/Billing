/**
 * Feature catalog. Keys must match server/src/licensing/features.ts in the desktop app
 * (a desktop test asserts both lists are identical).
 */
export interface FeatureDef {
  key: string;
  name: string;
  category: 'Core' | 'Operations' | 'Reports' | 'Growth' | 'Industry';
  description: string;
}

export const FEATURES: FeatureDef[] = [
  { key: 'dashboard', name: 'Dashboard', category: 'Core', description: 'Sales, profit and stock overview' },
  { key: 'billing', name: 'POS Billing', category: 'Core', description: 'Create invoices, held bills, cash register' },
  { key: 'invoices', name: 'Invoice Management', category: 'Core', description: 'Invoice history, payments, cancellation, drafts' },
  { key: 'customers', name: 'Customer Management', category: 'Core', description: 'Customers, ledgers, receivables' },
  { key: 'products', name: 'Product Management', category: 'Core', description: 'Catalog, categories, pricing' },
  { key: 'inventory', name: 'Inventory', category: 'Core', description: 'Stock adjustments, movements, low-stock alerts' },
  { key: 'purchases', name: 'Purchase Management', category: 'Operations', description: 'Suppliers, purchase bills, purchase orders' },
  { key: 'expenses', name: 'Expense Management', category: 'Operations', description: 'Expenses and categories' },
  { key: 'quotations', name: 'Quotations', category: 'Operations', description: 'Estimates and conversion to invoices' },
  { key: 'returns', name: 'Returns & Credit Notes', category: 'Operations', description: 'Sales and purchase returns' },
  { key: 'staff', name: 'Staff Management', category: 'Operations', description: 'Staff records and roles' },
  { key: 'reports_basic', name: 'Basic Reports', category: 'Reports', description: 'Sales, P&L, expense and purchase registers' },
  { key: 'reports_advanced', name: 'Advanced Reports', category: 'Reports', description: 'GST/HSN, ageing, cash flow, payment and product reports' },
  { key: 'inventory_analytics', name: 'Inventory Analytics', category: 'Reports', description: 'Stock valuation and inventory reports' },
  { key: 'data_export', name: 'Excel / CSV Export', category: 'Reports', description: 'Export reports and lists to Excel/CSV' },
  { key: 'pdf_export', name: 'PDF Export', category: 'Reports', description: 'Save invoices and reports as PDF' },
  { key: 'loyalty', name: 'Loyalty & Rewards', category: 'Growth', description: 'Points earning and redemption' },
  { key: 'branches', name: 'Branches & Transfers', category: 'Growth', description: 'Multiple stores and stock transfers' },
  { key: 'barcodes', name: 'Barcode Labels', category: 'Growth', description: 'Barcode label generation' },
  { key: 'audit_logs', name: 'Audit Logs', category: 'Growth', description: 'Activity history' },
  { key: 'restaurant', name: 'Restaurant (Tables & KOT)', category: 'Industry', description: 'Tables and kitchen order tickets' },
  { key: 'pharmacy', name: 'Pharmacy (Batch & Expiry)', category: 'Industry', description: 'Batch and expiry tracking' },
  { key: 'clothing', name: 'Clothing (Size/Colour)', category: 'Industry', description: 'Variant matrix and exchanges' },
  { key: 'manufacturing', name: 'Manufacturing (BOM)', category: 'Industry', description: 'Bills of material and production' },
  { key: 'school', name: 'School Fees', category: 'Industry', description: 'Students, fee structures and receipts' },
  { key: 'wholesale', name: 'Wholesale & Distribution', category: 'Industry', description: 'Slab pricing, routes and party ledgers' },
  { key: 'services', name: 'Service Business', category: 'Industry', description: 'Appointments and job cards' },
  { key: 'online_store', name: 'Online Store', category: 'Industry', description: 'Storefront orders' },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

export const TRIAL_DEFAULT_FEATURES = ['dashboard', 'billing', 'invoices', 'customers', 'products', 'inventory', 'reports_basic', 'pdf_export'];
