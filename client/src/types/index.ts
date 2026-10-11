export type UserRole = 
  | 'SUPER_ADMIN' 
  | 'PLATFORM_SUPPORT' 
  | 'BUSINESS_OWNER' 
  | 'BUSINESS_MANAGER' 
  | 'ACCOUNTANT' 
  | 'CASHIER' 
  | 'BRANCH_MANAGER';

export type BusinessCategory = 
  | 'RESTAURANT' 
  | 'GROCERY' 
  | 'CLOTHING' 
  | 'WHOLESALE' 
  | 'SERVICE' 
  | 'MANUFACTURING' 
  | 'PHARMACY' 
  | 'SCHOOL';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  businessId?: string | null;
  businessName?: string;
  businessCategory?: BusinessCategory;
  planId?: string;
  activeModules?: string[];
  gstin?: string;
  invoicePrefix?: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
}

export interface Category {
  id: string;
  business_id: string;
  name: string;
  description?: string;
}

export interface Product {
  id: string;
  business_id: string;
  category_id?: string;
  category_name?: string;
  name: string;
  sku: string;
  barcode?: string;
  unit: string;
  hsn_code?: string;
  purchase_price_paise: number;
  sale_price_paise: number;
  mrp_paise: number;
  tax_rate: number;
  stock_quantity: number;
  low_stock_threshold: number;
  is_active: number;
  extra_attributes?: Record<string, any>;
}

export interface Customer {
  id: string;
  business_id: string;
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  credit_limit_paise: number;
  outstanding_balance_paise: number;
  loyalty_points?: number;
  loyaltyPoints?: number;
  customer_type?: 'RETAIL' | 'WHOLESALE' | 'INSTITUTE';
  credit_days?: number;
}

export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT' | 'SPLIT';
export type PaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID';
export type InvoiceStatus = 'ISSUED' | 'CANCELLED';

export interface InvoiceItem {
  id?: string;
  product_id?: string;
  product_name: string;
  sku?: string;
  hsn_code?: string;
  quantity: number;
  unit_price_paise: number;
  discount_paise: number;
  tax_rate: number;
  tax_paise: number;
  total_paise: number;
}

export interface Invoice {
  id: string;
  business_id: string;
  invoice_number: string;
  customer_id?: string;
  customer_name: string;
  customer_phone?: string;
  customer_gstin?: string;
  invoice_date: string;
  subtotal_paise: number;
  discount_paise: number;
  tax_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  payment_mode: PaymentMode;
  payment_status: PaymentStatus;
  amount_paid_paise: number;
  notes?: string;
  status: InvoiceStatus;
  items?: InvoiceItem[];
  created_at: string;
  business?: {
    name: string;
    category: string;
    gstin?: string;
    address?: string;
    city?: string;
    state?: string;
    phone?: string;
    email?: string;
  };
}

export interface CartItem {
  productId?: string;
  productName: string;
  sku?: string;
  hsnCode?: string;
  unit: string;
  quantity: number;
  unitPricePaise: number;
  discountPaise: number;
  taxRate: number;
  stockAvailable?: number;
}

export interface DashboardStats {
  today: {
    salesPaise: number;
    invoices: number;
  };
  month: {
    salesPaise: number;
    invoices: number;
  };
  receivablesPaise: number;
  lowStockCount: number;
  catalogCount: number;
  recentInvoices: Invoice[];
  topProducts: Array<{
    product_name: string;
    total_sold: number;
    total_revenue_paise: number;
  }>;
}

export interface Plan {
  id: string;
  name: string;
  tier: string;
  price_paise: number;
  billing_period: string;
  max_users: number;
  max_branches: number;
  max_invoices_per_month: number;
  features: string[];
  is_active: number;
}

export type RefundMode = 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'STORE_CREDIT' | 'ADJUST_BALANCE' | 'ADJUST_PAYABLE';

export interface CreditNoteItem {
  id?: string;
  product_id?: string;
  product_name: string;
  sku?: string;
  quantity: number;
  unit_price_paise: number;
  tax_rate: number;
  tax_paise: number;
  total_paise: number;
}

export interface CreditNote {
  id: string;
  business_id: string;
  credit_note_number: string;
  invoice_id?: string;
  invoice_number: string;
  customer_id?: string;
  customer_name: string;
  customer_phone?: string;
  return_date: string;
  subtotal_paise: number;
  tax_paise: number;
  total_refund_paise: number;
  refund_mode: RefundMode;
  reason?: string;
  notes?: string;
  item_count?: number;
  created_at: string;
  items?: CreditNoteItem[];
  business?: any;
}

export interface DebitNoteItem {
  id?: string;
  product_id?: string;
  product_name: string;
  quantity: number;
  unit_price_paise: number;
  tax_rate: number;
  tax_paise: number;
  total_paise: number;
}

export interface DebitNote {
  id: string;
  business_id: string;
  debit_note_number: string;
  purchase_id?: string;
  purchase_number: string;
  supplier_id?: string;
  supplier_name: string;
  supplier_phone?: string;
  return_date: string;
  subtotal_paise: number;
  tax_paise: number;
  total_paise: number;
  refund_mode: RefundMode;
  reason?: string;
  notes?: string;
  item_count?: number;
  created_at: string;
  items?: DebitNoteItem[];
  business?: any;
}

export interface ClothingVariant {
  id: string;
  business_id: string;
  parent_product_id: string;
  variant_sku: string;
  barcode?: string;
  size: string;
  color: string;
  fabric?: string;
  stock_quantity: number;
  sale_price_paise: number;
  mrp_paise: number;
  created_at: string;
}

export interface ClothingProduct extends Product {
  variant_count?: number;
  total_variant_stock?: number;
  variants?: ClothingVariant[];
}

export interface GarmentExchange {
  id: string;
  business_id: string;
  exchange_number: string;
  original_invoice_number: string;
  customer_name: string;
  customer_phone?: string;
  returned_variant_id?: string;
  returned_product_name: string;
  returned_size: string;
  returned_color: string;
  returned_quantity: number;
  issued_variant_id?: string;
  issued_product_name: string;
  issued_size: string;
  issued_color: string;
  issued_quantity: number;
  price_difference_paise: number;
  payment_mode?: string;
  reason: string;
  notes?: string;
  created_at: string;
}

export type TransferStatus = 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';

export interface StockTransferItem {
  id?: string;
  transfer_id?: string;
  product_id: string;
  product_name: string;
  sku?: string;
  dispatched_quantity: number;
  received_quantity?: number;
  unit?: string;
}

export interface StockTransfer {
  id: string;
  business_id: string;
  transfer_number: string;
  source_branch_id: string;
  source_branch_name: string;
  dest_branch_id: string;
  dest_branch_name: string;
  transfer_date: string;
  status: TransferStatus;
  total_items_count: number;
  total_quantity: number;
  tracking_number?: string;
  notes?: string;
  dispatched_by?: string;
  received_by?: string;
  received_at?: string;
  created_at: string;
  updated_at: string;
  items?: StockTransferItem[];
  business?: any;
}

// ==========================================
// ONLINE STOREFRONT & ORDERS (PRD §4.20)
// ==========================================
export type OnlineOrderStatus = 'PENDING' | 'ACCEPTED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'CANCELLED';

export interface OnlineStoreConfig {
  id: string;
  business_id: string;
  slug: string;
  store_name: string;
  tagline?: string;
  banner_message?: string;
  is_active: number | boolean;
  min_order_amount_paise: number;
  delivery_fee_paise: number;
  accept_cod: number | boolean;
  accept_online: number | boolean;
  contact_phone?: string;
  contact_whatsapp?: string;
  business_name?: string;
  business_city?: string;
  business_address?: string;
}

export interface OnlineOrderItem {
  id?: string;
  order_id?: string;
  product_id: string;
  product_name: string;
  sku?: string;
  quantity: number;
  unit_price_paise: number;
  total_paise: number;
}

export interface OnlineOrder {
  id: string;
  business_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string;
  delivery_address: string;
  delivery_city?: string;
  delivery_pincode?: string;
  notes?: string;
  subtotal_paise: number;
  delivery_fee_paise: number;
  total_paise: number;
  status: OnlineOrderStatus;
  payment_mode: string;
  payment_status: string;
  converted_invoice_id?: string;
  item_count?: number;
  items?: OnlineOrderItem[];
  created_at: string;
  updated_at: string;
}

// ==========================================
// MANUFACTURING & BILL OF MATERIALS (PRD §5)
// ==========================================
export type ProductionOrderStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface BomItem {
  id?: string;
  bom_id?: string;
  raw_material_id: string;
  raw_material_name: string;
  raw_material_sku?: string;
  quantity_required: number;
  unit: string;
  wastage_percent: number;
  current_stock?: number;
  purchase_price_paise?: number;
  required_quantity?: number;
  has_enough_stock?: boolean;
  shortage_quantity?: number;
}

export interface BomRecipe {
  id: string;
  business_id: string;
  bom_code: string;
  finished_product_id: string;
  finished_product_name: string;
  finished_product_sku?: string;
  finished_product_stock?: number;
  output_quantity: number;
  output_unit: string;
  estimated_labor_cost_paise: number;
  estimated_overhead_cost_paise: number;
  estimated_material_cost_paise?: number;
  total_estimated_cost_paise?: number;
  estimated_cost_per_unit_paise?: number;
  notes?: string;
  is_active: number;
  component_count?: number;
  items?: BomItem[];
  created_at: string;
}

export interface ProductionMaterialLog {
  id: string;
  production_order_id: string;
  raw_material_id: string;
  raw_material_name: string;
  quantity_consumed: number;
  unit_cost_paise: number;
  total_cost_paise: number;
}

export interface ProductionOrder {
  id: string;
  business_id: string;
  order_number: string;
  bom_id: string;
  bom_code?: string;
  finished_product_id: string;
  finished_product_name: string;
  finished_product_sku?: string;
  finished_current_stock?: number;
  target_quantity: number;
  completed_quantity: number;
  batch_number?: string;
  status: ProductionOrderStatus;
  start_date: string;
  completed_date?: string;
  total_raw_material_cost_paise: number;
  total_labor_cost_paise: number;
  total_overhead_cost_paise: number;
  total_cost_paise: number;
  cost_per_unit_paise: number;
  notes?: string;
  created_at: string;
  components?: BomItem[];
  materialLogs?: ProductionMaterialLog[];
}

// ==========================================
// CUSTOMER LOYALTY PROGRAM & REWARDS (PRD §4.13)
// ==========================================
export interface LoyaltyRule {
  id: string;
  business_id: string;
  earn_points_per_rupees: number;
  point_value_paise: number;
  min_redeem_points: number;
  is_active: number | boolean;
  created_at: string;
  updated_at: string;

  // UI aliases
  redemptionValuePerPoint?: number;
  pointsPerSpendUnit?: number;
  spendUnitAmount?: number;
  minPointsToRedeem?: number;
  isActive?: boolean | number;
}

export type LoyaltyTransactionType = 'EARNED' | 'REDEEMED' | 'MANUAL_ADJUSTMENT';

export interface LoyaltyTransaction {
  id: string;
  business_id: string;
  customer_id: string;
  customer_name?: string;
  customer_phone?: string;
  transaction_type: LoyaltyTransactionType;
  type?: string;
  points: number;
  balance_after: number;
  balanceAfter?: number;
  invoice_id?: string;
  invoice_number?: string;
  customerName?: string;
  notes?: string;
  created_at: string;
  createdAt?: string;
}

// ==========================================
// SCHOOL & INSTITUTE VERTICAL (PRD §5)
// ==========================================
export interface Student {
  id: string;
  business_id?: string;
  admission_number?: string;
  student_name?: string;
  grade_class?: string;
  section?: string;
  roll_number?: string;
  guardian_name?: string;
  guardian_phone?: string;
  guardian_email?: string;
  annual_fees_paise?: number;
  paid_fees_paise?: number;
  outstanding_fees_paise?: number;
  status: 'ACTIVE' | 'INACTIVE' | 'GRADUATED';
  created_at?: string;
  updated_at?: string;

  // UI aliases
  name: string;
  admissionNumber: string;
  classGrade: string;
  rollNumber?: string;
  guardianName: string;
  guardianPhone: string;
  outstandingBalance: number;
  totalFeeDue: number;
}

export interface FeeStructure {
  id: string;
  business_id?: string;
  fee_name?: string;
  grade_class?: string;
  term_period?: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  amount_paise?: number;
  description?: string;
  created_at?: string;

  // UI aliases
  name: string;
  classGrade: string;
  amount: number;
  feeType?: string;
  frequency?: string;
}

export interface FeeReceipt {
  id: string;
  business_id?: string;
  receipt_number?: string;
  student_id?: string;
  student_name?: string;
  grade_class?: string;
  amount_paise?: number;
  payment_mode?: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE';
  receipt_date?: string;
  term_period?: string;
  fee_breakdown_json?: string;
  notes?: string;
  created_by?: string;
  created_at?: string;
  admission_number?: string;
  guardian_name?: string;
  guardian_phone?: string;
  school_name?: string;
  school_address?: string;
  school_phone?: string;

  // UI aliases
  receiptNumber: string;
  studentName: string;
  classGrade: string;
  amountPaid: number;
  paymentMode: string;
  paymentDate: string;
  periodMonthYear: string;
  balanceAfterPayment: number;
  transactionRef?: string;
}

// Wholesale & Distribution Types (PRD §5)
export interface BulkPriceSlab {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  standardPrice: number;
  minQuantity: number;
  maxQuantity?: number | null;
  slabPrice: number;
  createdAt: string;
}

export interface DistributorRoute {
  id: string;
  routeName: string;
  salespersonName?: string;
  areaZone?: string;
  createdAt: string;
}

export interface PartyLedgerEntry {
  id: string;
  entryType: string;
  referenceNo?: string;
  debit: number;
  credit: number;
  runningBalance: number;
  notes?: string;
  createdAt: string;
}

export interface WholesaleParty {
  id: string;
  name: string;
  phone: string;
  gstin?: string;
  customerType: string;
  creditLimit: number;
  creditDays: number;
  outstandingBalance: number;
  availableCredit: number;
}

// Service Businesses Types (PRD §5)
export interface ServiceAppointment {
  id: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  staffName?: string;
  appointmentDate: string;
  appointmentTime: string;
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  estimatedCost: number;
  notes?: string;
  createdAt: string;
}

export interface ServiceRecord {
  id: string;
  jobCardNumber: string;
  customerName: string;
  customerPhone: string;
  assetItemName: string;
  serialOrRegNumber?: string;
  issueReported: string;
  diagnosisNotes?: string;
  partsCost: number;
  laborCost: number;
  totalCost: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'WAITING_FOR_PARTS' | 'COMPLETED' | 'DELIVERED';
  assignedTechnician?: string;
  createdAt: string;
}

export interface RecurringInvoice {
  id: string;
  customerId: string;
  customerName: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  amount: number;
  description: string;
  nextRunDate: string;
  status: 'ACTIVE' | 'PAUSED';
  createdAt: string;
}

// Hardware & Gateway Settings Types (PRD §8 & §9)
export interface HardwareSettings {
  id: string;
  printerType: 'THERMAL_80MM' | 'THERMAL_58MM' | 'LASER_A4';
  printerInterface: 'BROWSER_POPUP' | 'RAW_BT' | 'NETWORK_ESC_POS';
  autoCutPaper: boolean;
  openCashDrawer: boolean;
  weighingScaleEnabled: boolean;
  weighingScaleBaudRate: number;
  smsGatewayProvider: 'WHATSAPP_DIRECT' | 'TWILIO' | 'FAST2SMS';
  smsApiKey?: string;
  smsSenderId?: string;
  autoSendBillSms: boolean;
  autoSendAppointmentSms: boolean;
}






