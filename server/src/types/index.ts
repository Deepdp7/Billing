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

export type PlanTier = 'FREE' | 'PRO' | 'BUSINESS';

export interface Plan {
  id: string;
  name: string;
  tier: PlanTier;
  price_paise: number;
  billing_period: 'MONTHLY' | 'ANNUAL';
  max_users: number;
  max_branches: number;
  max_invoices_per_month: number;
  features: string[];
  is_active: number;
}

export interface Business {
  id: string;
  name: string;
  category: BusinessCategory;
  gstin?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  logo_url?: string;
  plan_id: string;
  status: 'ACTIVE' | 'SUSPENDED';
  invoice_prefix: string;
  next_invoice_number: number;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  business_id?: string | null;
  name: string;
  email: string;
  role: UserRole;
  status: 'ACTIVE' | 'SUSPENDED';
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  business_id: string;
  name: string;
  description?: string;
  created_at: string;
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
  tax_rate: number; // e.g. 0, 5, 12, 18, 28
  stock_quantity: number;
  low_stock_threshold: number;
  is_active: number;
  extra_attributes?: Record<string, any>;
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
}

export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT' | 'SPLIT';
export type PaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID';
export type InvoiceStatus = 'ISSUED' | 'CANCELLED';

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  business_id: string;
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
  created_by?: string;
  status: InvoiceStatus;
  items?: InvoiceItem[];
  created_at: string;
}

export interface StockMovement {
  id: string;
  business_id: string;
  product_id: string;
  change_quantity: number;
  resulting_quantity: number;
  movement_type: 'INVOICE' | 'MANUAL_ADJUSTMENT' | 'PURCHASE' | 'RETURN';
  reference_id?: string;
  notes?: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id?: string;
  business_id?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  details?: Record<string, any>;
  ip_address?: string;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  business_id: string;
  business_name?: string;
  user_id: string;
  user_name?: string;
  subject: string;
  description: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  created_at: string;
  updated_at: string;
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  businessId?: string | null;
}
