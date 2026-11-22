import type { Branding } from './branding.js';
const API_BASE = '/api/v1';

export class ApiError extends Error {
  code: string;
  details?: any;

  constructor(message: string, code: string = 'API_ERROR', details?: any) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

let backgroundDepth = 0;
/** Requests started while `fn` runs (synchronously) are background reloads */
export function inBackground(fn: () => void) {
  backgroundDepth += 1;
  try { fn(); } finally { setTimeout(() => { backgroundDepth -= 1; }, 0); }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('apna_billing_token');
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Started by a list reloading on its own (useLiveRefresh), not by the user: not counted as using the feature
  if (backgroundDepth > 0) headers.set('X-Apna-Background', '1');

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data.message || data.error || `Request failed with status ${res.status}`, data.code, data.details);
  }

  return data as T;
}

// ---- Loyalty: the engine stores "₹ spent per point" and "paise per point"; the screen shows points per ₹ and ₹ per point ----

function loyaltyRuleFromServer(r: any) {
  if (!r) return r;
  return {
    ...r,
    pointsPerSpendUnit: 1,
    spendUnitAmount: Number(r.earn_points_per_rupees) || 100,
    redemptionValuePerPoint: (Number(r.point_value_paise) || 0) / 100,
    minPointsToRedeem: Number(r.min_redeem_points) || 0,
    isActive: !!r.is_active,
  };
}

function loyaltyRuleToServer(f: any) {
  const points = Number(f.pointsPerSpendUnit) || 1;
  return {
    earn_points_per_rupees: (Number(f.spendUnitAmount) || 100) / points,
    point_value_paise: Math.round((Number(f.redemptionValuePerPoint) || 0) * 100),
    min_redeem_points: Number(f.minPointsToRedeem) || 0,
    is_active: f.isActive ? 1 : 0,
  };
}

function loyaltyTransactionFromServer(t: any) {
  return {
    ...t,
    type: t.transaction_type,
    customerName: t.customer_name,
    balanceAfter: t.balance_after,
    createdAt: t.created_at ? `${String(t.created_at).replace(' ', 'T')}Z` : undefined,
  };
}

export interface LicenseDevices {
  maxDevices: number | null;
  devices: Array<{ id: string; deviceName: string; os: string; appVersion: string; status: string; lastSeenAt: string | null;
    installedAt: string; uninstalledAt: string | null; thisComputer: boolean }>;
}

export interface ProductOptions {
  units: { value: string; label: string; products: number }[];
  gstRates: { rate: string; products: number }[];
}

export const api = {
  // Auth
  login: (credentials: { email: string; password: string; shopId?: string; details?: { state?: string; category?: string } }) => 
    request<{ token: string; user: any; newOnThisComputer?: boolean; licenseJoin?: { code: string; message?: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),

  forgotPassword: (email: string) =>
    request<{ ok: boolean; minutes: number }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (data: { email: string; code: string; password: string }) =>
    request<{ ok: boolean }>('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) }),

  registerBusiness: (data: any) =>
    request<{ token: string; user: any; message: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getMe: () => request<{ user: any }>('/auth/me'),

  getRegistryMetadata: () => request<any>('/registry/modules'),

  // Tenant App Endpoints
  getDashboardStats: () => request<any>('/app/business/stats'),

  getBusinessProfile: () => request<any>('/app/business/profile'),
  updateBusinessProfile: (data: any) =>
    request<any>('/app/business/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  eraseShop: (confirmName: string) =>
    request<{ ok: boolean }>('/auth/erase-shop', { method: 'POST', body: JSON.stringify({ confirmName }) }),

  // Products & Categories
  getProducts: (params: { search?: string; categoryId?: string; barcode?: string; code?: string; lowStockOnly?: boolean; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.append('search', params.search);
    if (params.categoryId) q.append('categoryId', params.categoryId);
    if (params.barcode) q.append('barcode', params.barcode);
    if (params.code) q.append('code', params.code);
    if (params.lowStockOnly) q.append('lowStockOnly', 'true');
    if (params.page) q.append('page', String(params.page));
    if (params.limit) q.append('limit', String(params.limit));
    return request<{ data: any[]; pagination: any }>(`/app/products?${q.toString()}`);
  },

  createProduct: (data: any) =>
    request<any>('/app/products', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProduct: (id: string, data: any) =>
    request<any>(`/app/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteProduct: (id: string) =>
    request<any>(`/app/products/${id}`, {
      method: 'DELETE',
    }),

  /** suggestions: categories that fit this kind of business and the shop does not have yet */
  getCategories: () => request<{ data: any[]; suggestions?: string[] }>('/app/categories'),
  updateCategory: (id: string, data: { name?: string; description?: string }) =>
    request<any>(`/app/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCategory: (id: string) => request<{ message: string }>(`/app/categories/${id}`, { method: 'DELETE' }),
  /** The shop's own units and GST rates for the product form, each with how many products use it */
  getProductOptions: () => request<ProductOptions>('/app/products/options'),
  saveProductOptions: (data: { units?: { value: string; label: string }[]; gstRates?: number[]; renameUnit?: { from: string; to: string } }) =>
    request<ProductOptions>('/app/products/options', { method: 'PUT', body: JSON.stringify(data) }),
  /** Products → Import Excel: an .xlsx or .csv file as base64 */
  importProducts: (fileName: string, data: string) =>
    request<{ created: number; updated: number; skipped: number; errors: { row: number; message: string }[] }>('/app/products/import', {
      method: 'POST',
      body: JSON.stringify({ fileName, data }),
    }),
  createCategory: (data: { name: string; description?: string }) =>
    request<any>('/app/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Billing & Invoices
  checkout: (payload: any) =>
    request<{ message: string; invoice: any }>('/app/billing/checkout', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getInvoices: (params: { search?: string; status?: string; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.append('search', params.search);
    if (params.status) q.append('status', params.status);
    if (params.page) q.append('page', String(params.page));
    if (params.limit) q.append('limit', String(params.limit));
    return request<{ data: any[]; pagination: any }>(`/app/billing/invoices?${q.toString()}`);
  },

  getInvoiceById: (id: string) => request<{ invoice: any }>(`/app/billing/invoices/${id}`),

  cancelInvoice: (id: string) =>
    request<any>(`/app/billing/invoices/${id}/cancel`, {
      method: 'POST',
    }),

  // Customers
  getCustomers: (params: { search?: string; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.append('search', params.search);
    if (params.page) q.append('page', String(params.page));
    if (params.limit) q.append('limit', String(params.limit));
    return request<{ data: any[]; pagination: any }>(`/app/customers?${q.toString()}`);
  },

  createCustomer: (data: any) =>
    request<any>('/app/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getCustomerById: (id: string) => request<{ customer: any; invoices: any[] }>(`/app/customers/${id}`),

  // Inventory
  getLowStockAlerts: () => request<{ data: any[]; count: number }>('/app/inventory/alerts'),
  adjustStock: (data: { productId: string; changeQuantity: number; reason?: string; notes?: string }) =>
    request<any>('/app/inventory/adjust', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getStockMovements: (productId?: string) => {
    const q = productId ? `?productId=${productId}` : '';
    return request<{ data: any[] }>(`/app/inventory/movements${q}`);
  },

  // Operations: Purchases & Suppliers
  getSuppliers: () => request<{ data: any[] }>('/app/suppliers'),
  createSupplier: (data: any) =>
    request<any>('/app/suppliers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getPurchases: () => request<{ data: any[] }>('/app/purchases'),
  deletePurchase: (id: string) =>
    request<{ message: string }>(`/app/purchases/${id}`, { method: 'DELETE' }),
  createPurchase: (data: any) =>
    request<any>('/app/purchases', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Operations: Expenses
  getExpenses: (params: { category?: string; fromDate?: string; toDate?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.category) q.append('category', params.category);
    if (params.fromDate) q.append('fromDate', params.fromDate);
    if (params.toDate) q.append('toDate', params.toDate);
    return request<{ data: any[]; totalPaise: number }>(`/app/expenses?${q.toString()}`);
  },
  createExpense: (data: any) =>
    request<any>('/app/expenses', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Operations: Accounting & Reports
  getProfitAndLoss: (params: { fromDate?: string; toDate?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.fromDate) q.append('fromDate', params.fromDate);
    if (params.toDate) q.append('toDate', params.toDate);
    return request<any>(`/app/accounting/profit-loss?${q.toString()}`);
  },
  getGstSummary: (params: { fromDate?: string; toDate?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.fromDate) q.append('fromDate', params.fromDate);
    if (params.toDate) q.append('toDate', params.toDate);
    return request<any>(`/app/accounting/gst-summary?${q.toString()}`);
  },

  // Operations: Staff
  getStaff: () => request<{ data: any[] }>('/app/staff'),
  createStaff: (data: any) =>
    request<any>('/app/staff', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  toggleStaffStatus: (id: string, status: string) =>
    request<any>(`/app/staff/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  // Growth: Quotations
  getQuotations: () => request<{ data: any[] }>('/app/quotations'),
  createQuotation: (data: any) =>
    request<any>('/app/quotations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  convertQuotationToInvoice: (id: string) =>
    request<any>(`/app/quotations/${id}/convert`, {
      method: 'POST',
    }),
  deleteQuotation: (id: string) =>
    request<{ message: string }>(`/app/quotations/${id}`, { method: 'DELETE' }),

  // Verticals: Restaurant
  getRestaurantTables: () => request<{ data: any[] }>('/app/verticals/restaurant/tables'),
  createRestaurantTable: (data: any) =>
    request<any>('/app/verticals/restaurant/tables', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTableStatus: (id: string, status: string) =>
    request<any>(`/app/verticals/restaurant/tables/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),
  getKots: () => request<{ data: any[] }>('/app/verticals/restaurant/kots'),
  createKot: (data: any) =>
    request<any>('/app/verticals/restaurant/kots', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateKotStatus: (id: string, status: string) =>
    request<any>(`/app/verticals/restaurant/kots/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  // Verticals: Pharmacy
  getPharmacyExpiry: () => request<{ data: any[] }>('/app/verticals/pharmacy/expiry'),

  // Notifications
  getNotifications: () => request<{ data: any[] }>('/app/notifications'),
  markNotificationRead: (id: string) =>
    request<any>(`/app/notifications/${id}/read`, {
      method: 'PUT',
    }),

  // Platform Admin
  getAdminDashboard: () => request<any>('/admin/dashboard'),
  listAdminBusinesses: (params: { search?: string; category?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.append('search', params.search);
    if (params.category) q.append('category', params.category);
    if (params.status) q.append('status', params.status);
    return request<{ data: any[] }>(`/admin/businesses?${q.toString()}`);
  },
  updateBusinessStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED') =>
    request<any>(`/admin/businesses/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),
  listAdminPlans: () => request<{ data: any[] }>('/admin/plans'),
  updateAdminPlan: (id: string, data: any) =>
    request<any>(`/admin/plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getAdminAuditLogs: () => request<{ data: any[] }>('/admin/audit-logs'),

  // Phase 5: Backups & Disaster Recovery
  getBackups: () => request<{ backups: any[] }>('/app/backups'),
  createBackupSnapshot: (name?: string) =>
    request<any>('/app/backups/snapshot', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  restoreBackup: (payload: { backupId?: string; rawJson?: any }) =>
    request<any>('/app/backups/restore', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Phase 5: Multi-Store & Branches
  getBranches: () => request<{ branches: any[] }>('/app/branches'),
  createBranch: (data: any) =>
    request<any>('/app/branches', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateBranch: (id: string, data: any) =>
    request<any>(`/app/branches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteBranch: (id: string) =>
    request<any>(`/app/branches/${id}`, {
      method: 'DELETE',
    }),

  // Phase 5: Support Desk & FAQs
  getSupportTickets: () => request<{ tickets: any[] }>('/app/support/tickets'),
  createSupportTicket: (data: { subject: string; description: string; priority: string }) =>
    request<any>('/app/support/tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getSupportFaqs: () => request<{ faqs: any[] }>('/app/support/faqs'),
  updateTicketStatus: (id: string, status: string) =>
    request<any>(`/admin/support/tickets/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  // Phase 5: Audit Logs
  getAuditLogs: () => request<{ logs: any[] }>('/app/audit/logs'),

  // Phase 6: Returns & Refunds (Sales Credit Notes & Purchase Debit Notes)
  getSalesReturns: (params: { search?: string; customerId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.append('search', params.search);
    if (params.customerId) q.append('customerId', params.customerId);
    return request<{ data: any[] }>(`/app/returns/sales?${q.toString()}`);
  },
  lookupInvoiceForReturn: (invoiceNumber: string) =>
    request<{ data: { invoice: any; items: any[] } }>(`/app/returns/sales/lookup/${encodeURIComponent(invoiceNumber)}`),
  createSalesReturn: (payload: any) =>
    request<{ message: string; data: any }>('/app/returns/sales', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getSalesReturnById: (id: string) =>
    request<{ data: any }>(`/app/returns/sales/${id}`),

  getPurchaseReturns: (params: { search?: string; supplierId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.append('search', params.search);
    if (params.supplierId) q.append('supplierId', params.supplierId);
    return request<{ data: any[] }>(`/app/returns/purchases?${q.toString()}`);
  },
  lookupPurchaseForReturn: (purchaseNumber: string) =>
    request<{ data: { purchase: any; items: any[] } }>(`/app/returns/purchases/lookup/${encodeURIComponent(purchaseNumber)}`),
  createPurchaseReturn: (payload: any) =>
    request<{ message: string; data: any }>('/app/returns/purchases', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getPurchaseReturnById: (id: string) =>
    request<{ data: any }>(`/app/returns/purchases/${id}`),

  // Verticals: Clothing & Fashion Variant Matrix (PRD §5)
  getClothingProducts: () => request<{ data: any[] }>('/app/verticals/clothing/products'),
  createClothingProduct: (data: any) =>
    request<{ message: string; productId: string }>('/app/verticals/clothing/products', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateVariantStock: (variantId: string, newQuantity: number) =>
    request<{ message: string }>(`/app/verticals/clothing/variants/${variantId}/stock`, {
      method: 'PUT',
      body: JSON.stringify({ newQuantity }),
    }),
  getGarmentExchanges: () => request<{ data: any[] }>('/app/verticals/clothing/exchanges'),
  createGarmentExchange: (data: any) =>
    request<{ message: string; exchangeNumber: string }>('/app/verticals/clothing/exchanges', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getClothingSummary: () => request<{ data: any }>('/app/verticals/clothing/summary'),

  // Inter-Branch Stock Transfers (PRD §4.4 & §4.19)
  getTransfers: (params: { status?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.append('status', params.status);
    if (params.search) q.append('search', params.search);
    return request<{ data: any[] }>(`/app/transfers?${q.toString()}`);
  },
  getTransferById: (id: string) =>
    request<{ data: any }>(`/app/transfers/${id}`),
  createTransfer: (data: any) =>
    request<{ message: string; data: any }>('/app/transfers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  receiveTransfer: (id: string) =>
    request<{ message: string }>(`/app/transfers/${id}/receive`, {
      method: 'PUT',
    }),
  cancelTransfer: (id: string) =>
    request<{ message: string }>(`/app/transfers/${id}/cancel`, {
      method: 'PUT',
    }),

  // Phase 9: Public Storefront Endpoints (No Auth)
  getPublicStore: (slug: string) =>
    request<{ store: any; categories: any[]; products: any[] }>(`/public/store/${encodeURIComponent(slug)}`),
  createPublicOrder: (slug: string, data: any) =>
    request<{ message: string; orderId: string; orderNumber: string; totalAmountPaise: number; itemCount?: number }>(`/public/store/${encodeURIComponent(slug)}/orders`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getPublicOrderStatus: (orderNumber: string) =>
    request<{ order: any; items: any[] }>(`/public/orders/${encodeURIComponent(orderNumber)}`),

  // Phase 9: Merchant Online Store & Orders Management
  getStoreConfig: () =>
    request<{ store: any; stats: any }>('/app/store/config'),
  updateStoreConfig: (data: any) =>
    request<{ message: string; store: any }>('/app/store/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getStoreOrders: (params: { status?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.append('status', params.status);
    if (params.search) q.append('search', params.search);
    return request<{ orders: any[] }>(`/app/store/orders?${q.toString()}`);
  },
  getStoreOrderById: (id: string) =>
    request<{ order: any; items: any[] }>(`/app/store/orders/${id}`),
  updateOrderStatus: (id: string, status: string) =>
    request<{ message: string }>(`/app/store/orders/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),
  convertOrderToInvoice: (id: string) =>
    request<{ message: string; invoiceId: string; invoiceNumber: string }>(`/app/store/orders/${id}/convert-to-invoice`, {
      method: 'POST',
    }),

  // Phase 9: Manufacturing & Bill of Materials (BOM)
  getBoms: (params: { search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.append('search', params.search);
    return request<{ boms: any[] }>(`/app/manufacturing/boms?${q.toString()}`);
  },
  getBomById: (id: string) =>
    request<{ bom: any; items: any[] }>(`/app/manufacturing/boms/${id}`),
  createBom: (data: any) =>
    request<{ message: string; bomId: string; bomCode: string }>('/app/manufacturing/boms', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteBom: (id: string) =>
    request<{ message: string }>(`/app/manufacturing/boms/${id}`, {
      method: 'DELETE',
    }),
  getProductionOrders: (params: { status?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.append('status', params.status);
    if (params.search) q.append('search', params.search);
    return request<{ orders: any[] }>(`/app/manufacturing/orders?${q.toString()}`);
  },
  getProductionOrderById: (id: string) =>
    request<{ order: any; components: any[]; materialLogs: any[] }>(`/app/manufacturing/orders/${id}`),
  createProductionOrder: (data: any) =>
    request<{ message: string; orderId: string; orderNumber: string; batchNumber: string }>('/app/manufacturing/orders', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  startProductionOrder: (id: string) =>
    request<{ message: string }>(`/app/manufacturing/orders/${id}/start`, {
      method: 'PUT',
    }),
  executeProductionRun: (id: string, data: any) =>
    request<{ message: string; productionSummary: any }>(`/app/manufacturing/orders/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  cancelProductionOrder: (id: string) =>
    request<{ message: string }>(`/app/manufacturing/orders/${id}/cancel`, {
      method: 'PUT',
    }),
  getManufacturingStats: () =>
    request<any>('/app/manufacturing/stats'),

  // Phase 10: Customer Loyalty & Rewards Points (PRD §4.13)
  getLoyaltyRule: () =>
    request<{ rule: any; stats: any }>('/app/loyalty/rule').then((r) => ({ ...r, rule: loyaltyRuleFromServer(r.rule) })),
  updateLoyaltyRule: (data: any) =>
    request<{ message: string; rule: any }>('/app/loyalty/rule', {
      method: 'PUT',
      body: JSON.stringify(loyaltyRuleToServer(data)),
    }).then((r) => ({ ...r, rule: loyaltyRuleFromServer(r.rule) })),
  getLoyaltyTransactions: (params: { customerId?: string; search?: string } | number = {}) => {
    const q = new URLSearchParams();
    if (typeof params === 'object') {
      if (params.customerId) q.append('customerId', params.customerId);
      if (params.search) q.append('search', params.search);
    }
    return request<{ transactions: any[] }>(`/app/loyalty/transactions?${q.toString()}`)
      .then((r) => ({ transactions: (r.transactions || []).map(loyaltyTransactionFromServer) }));
  },
  getCustomerLoyalty: (customerId: string) =>
    request<{ customer: any; history: any[] }>(`/app/loyalty/customers/${customerId}`),
  adjustLoyaltyPoints: (data: { customerId: string; points: number; type?: string; notes?: string }) =>
    request<{ message: string; newBalance: number }>('/app/loyalty/adjust', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Phase 12: School & Institute Vertical (PRD §5)
  getStudents: (params: { gradeClass?: string; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.gradeClass) q.append('gradeClass', params.gradeClass);
    if (params.search) q.append('search', params.search);
    return request<{ students: any[] }>(`/app/verticals/school/students?${q.toString()}`);
  },
  getStudentById: (id: string) =>
    request<{ student: any; receipts: any[] }>(`/app/verticals/school/students/${id}`),
  createStudent: (data: any) =>
    request<{ message: string; student: any }>('/app/verticals/school/students', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateStudent: (id: string, data: any) =>
    request<{ message: string; student: any }>(`/app/verticals/school/students/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getFeeStructures: (params: { gradeClass?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.gradeClass) q.append('gradeClass', params.gradeClass);
    return request<{ feeStructures: any[] }>(`/app/verticals/school/fee-structures?${q.toString()}`);
  },
  createFeeStructure: (data: any) =>
    request<{ message: string; feeStructure: any }>('/app/verticals/school/fee-structures', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getFeeReceipts: (params: { studentId?: string; search?: string } | number = {}) => {
    const q = new URLSearchParams();
    if (typeof params === 'object') {
      if (params.studentId) q.append('studentId', params.studentId);
      if (params.search) q.append('search', params.search);
    }
    return request<{ receipts: any[] }>(`/app/verticals/school/receipts?${q.toString()}`);
  },
  getFeeReceiptById: (id: string) =>
    request<{ receipt: any }>(`/app/verticals/school/receipts/${id}`),
  createFeeReceipt: (data: any) =>
    request<{ message: string; receiptId: string; receiptNumber: string; updatedPaidFeesPaise: number; updatedOutstandingFeesPaise: number }>('/app/verticals/school/receipts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getSchoolSummary: () =>
    request<any>('/app/verticals/school/summary'),

  // Wholesale & Distribution Vertical (PRD §5)
  getBulkSlabs: (productId?: string) => {
    const q = productId ? `?productId=${encodeURIComponent(productId)}` : '';
    return request<{ slabs: any[] }>(`/app/verticals/wholesale/slabs${q}`);
  },
  createBulkSlab: (data: { productId: string; minQuantity: number; maxQuantity?: number | null; slabPrice: number }) =>
    request<{ success: boolean; slab: any }>('/app/verticals/wholesale/slabs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteBulkSlab: (id: string) =>
    request<{ success: boolean; message: string }>(`/app/verticals/wholesale/slabs/${id}`, {
      method: 'DELETE',
    }),
  getDistributorRoutes: () =>
    request<{ routes: any[] }>('/app/verticals/wholesale/routes'),
  createDistributorRoute: (data: { routeName: string; salespersonName?: string; areaZone?: string }) =>
    request<{ success: boolean; route: any }>('/app/verticals/wholesale/routes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getPartyLedger: (customerId: string) =>
    request<{ customer: any; entries: any[] }>(`/app/verticals/wholesale/ledger/${customerId}`),
  addPartyLedgerEntry: (data: { customerId: string; entryType: string; referenceNo?: string; amount: number; notes?: string }) =>
    request<{ success: boolean; entry: any }>('/app/verticals/wholesale/ledger', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCustomerCredit: (customerId: string, data: { creditLimit: number; creditDays: number; customerType?: string }) =>
    request<{ success: boolean; message: string }>(`/app/verticals/wholesale/credit/${customerId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getWholesaleSummary: () =>
    request<{ summary: any }>('/app/verticals/wholesale/summary'),

  // Service Businesses Vertical (PRD §5) & Hardware/Gateway Settings (PRD §8 & §9)
  getAppointments: (params: { status?: string; date?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.append('status', params.status);
    if (params.date) q.append('date', params.date);
    return request<{ appointments: any[] }>(`/app/verticals/service/appointments?${q.toString()}`);
  },
  createAppointment: (data: any) =>
    request<{ success: boolean; appointment: any }>('/app/verticals/service/appointments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAppointmentStatus: (id: string, status: string) =>
    request<{ success: boolean; message: string }>(`/app/verticals/service/appointments/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),
  getJobCards: (params: { status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.append('status', params.status);
    return request<{ jobCards: any[] }>(`/app/verticals/service/job-cards?${q.toString()}`);
  },
  createJobCard: (data: any) =>
    request<{ success: boolean; jobCard: any }>('/app/verticals/service/job-cards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateJobCard: (id: string, data: any) =>
    request<{ success: boolean; message: string }>(`/app/verticals/service/job-cards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getRecurringInvoices: () =>
    request<{ recurringInvoices: any[] }>('/app/verticals/service/recurring'),
  createRecurringInvoice: (data: any) =>
    request<{ success: boolean; recurringInvoice: any }>('/app/verticals/service/recurring', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getHardwareSettings: () =>
    request<{ settings: any }>('/app/verticals/service/hardware-settings'),
  updateHardwareSettings: (data: any) =>
    request<{ success: boolean; message: string }>('/app/verticals/service/hardware-settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getServiceSummary: () =>
    request<{ summary: any }>('/app/verticals/service/summary'),

  // ---------------- System, license, settings ----------------
  getSystemInfo: () => request<any>('/system/info'),
  getLicenseStatus: () => request<any>('/license/status'),
  checkConnectivity: () => request<{ online: boolean }>('/license/connectivity', { method: 'POST' }),
  startTrial: (data: { name: string; businessName: string; email: string; phone?: string }) =>
    request<any>('/license/trial', { method: 'POST', body: JSON.stringify(data) }),
  activateLicense: (licenseKey: string) => request<any>('/license/activate', { method: 'POST', body: JSON.stringify({ licenseKey }) }),
  /** The account's password: this computer joins the licence the account already has */
  joinAccountLicense: (password: string) => request<any>('/license/join', { method: 'POST', body: JSON.stringify({ password }) }),
  deactivateLicense: () => request<any>('/license/deactivate', { method: 'POST', body: '{}' }),
  licenseDevices: () => request<LicenseDevices>('/license/devices'),
  /** Whether this business's data is in step with the account's other computers */
  getSyncStatus: () => request<any>('/sync/status'),
  signOutDevice: (id: string) => request<LicenseDevices>(`/license/devices/${encodeURIComponent(id)}/deactivate`, { method: 'POST', body: '{}' }),
  syncLicense: () => request<any>('/license/sync', { method: 'POST', body: '{}' }),
  trackUsage: (feature: string) => request<any>('/license/usage', { method: 'POST', body: JSON.stringify({ feature }) }),
  getBusinessSettings: () => request<{ settings: any }>('/app/business/settings'),
  updateBusinessSettings: (data: any) => request<{ settings: any }>('/app/business/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getBranding: () => request<{ branding: Branding }>('/app/business/branding'),
  updateBranding: (data: Partial<Branding>) => request<{ branding: Branding }>('/app/business/branding', { method: 'PUT', body: JSON.stringify(data) }),

  // ---------------- Billing extras ----------------
  recordInvoicePayment: (id: string, data: { amountPaise: number; mode: string; reference?: string; paymentDate?: string }) =>
    request<{ invoice: any }>(`/app/billing/invoices/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  cancelInvoiceWithReason: (id: string, reason: string, refundMode?: string) =>
    request<any>(`/app/billing/invoices/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason, refundMode }) }),
  duplicateInvoice: (id: string) => request<{ invoice: any }>(`/app/billing/invoices/${id}/duplicate`, { method: 'POST', body: '{}' }),
  issueDraft: (id: string, data: any) => request<{ invoice: any }>(`/app/billing/invoices/${id}/issue`, { method: 'POST', body: JSON.stringify(data) }),
  deleteDraft: (id: string) => request<any>(`/app/billing/invoices/${id}/draft`, { method: 'DELETE' }),
  deleteInvoice: (id: string) => request<{ message: string }>(`/app/billing/invoices/${id}`, { method: 'DELETE' }),
  searchInvoices: (params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.append(k, String(v));
    return request<{ data: any[]; pagination: any }>(`/app/billing/invoices?${q.toString()}`);
  },
  getHeldBills: () => request<{ data: any[] }>('/app/billing/held'),
  holdBill: (data: { label?: string; customerName?: string; payload: any }) =>
    request<{ id: string }>('/app/billing/held', { method: 'POST', body: JSON.stringify(data) }),
  deleteHeldBill: (id: string) => request<any>(`/app/billing/held/${id}`, { method: 'DELETE' }),

  // ---------------- Customers extras ----------------
  updateCustomer: (id: string, data: any) => request<{ customer: any }>(`/app/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCustomer: (id: string, deactivate = false) =>
    request<any>(`/app/customers/${id}${deactivate ? '?mode=deactivate' : ''}`, { method: 'DELETE' }),
  getCustomerLedger: (id: string) => request<any>(`/app/customers/${id}/ledger`),
  receiveCustomerPayment: (id: string, data: { amountPaise: number; mode: string; reference?: string; notes?: string }) =>
    request<any>(`/app/customers/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  voidCustomerPayment: (id: string, paymentId: string) =>
    request<any>(`/app/customers/${id}/payments/${paymentId}/void`, { method: 'POST', body: '{}' }),
  refundCustomerAdvance: (id: string, data: { amountPaise: number; mode: string; reference?: string; notes?: string }) =>
    request<any>(`/app/customers/${id}/refund`, { method: 'POST', body: JSON.stringify(data) }),

  // ---------------- Expenses / suppliers / reports ----------------
  updateExpense: (id: string, data: any) => request<any>(`/app/expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteExpense: (id: string) => request<any>(`/app/expenses/${id}`, { method: 'DELETE' }),
  paySupplier: (id: string, data: { amountPaise: number; mode: string; reference?: string }) =>
    request<any>(`/app/suppliers/${id}/payments`, { method: 'POST', body: JSON.stringify(data) }),
  getReport: (type: string, params: Record<string, string | undefined> = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.append(k, v);
    return request<any>(`/app/reports/${type}?${q.toString()}`);
  },

  // ---------------- Backups ----------------
  verifyBackup: (id: string) => request<any>(`/app/backups/${id}/verify`, { method: 'POST', body: '{}' }),
  deleteBackup: (id: string) => request<any>(`/app/backups/${id}`, { method: 'DELETE' }),
  updateBackupSettings: (data: any) => request<any>('/app/backups/settings', { method: 'PUT', body: JSON.stringify(data) }),
  restoreBackupFromFile: async (file: File) => {
    const token = localStorage.getItem('apna_billing_token');
    const res = await fetch(`${API_BASE}/app/backups/restore-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.message || 'Restore failed', data.code);
    return data;
  },
};

/** Download an authenticated file (CSV/XLSX/JSON export) via the API, preserving the server's filename. */
export async function downloadFile(endpoint: string, fallbackName = 'export'): Promise<void> {
  const token = localStorage.getItem('apna_billing_token');
  const res = await fetch(`${API_BASE}${endpoint}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.message || `Download failed (${res.status})`, data.code);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save the current window as PDF (desktop app) or open the print dialog (browser). Tracks pdf_export usage. */
export async function saveAsPdf(fileName: string): Promise<'saved' | 'printed' | 'cancelled'> {
  const desktop = (window as any).apnaDesktop;
  try { await api.trackUsage('pdf_export'); } catch (err: any) {
    if (err?.code === 'FEATURE_DISABLED') throw err;
  }
  if (desktop?.saveAsPdf) {
    const r = await desktop.saveAsPdf(fileName);
    return r?.saved ? 'saved' : 'cancelled';
  }
  window.print();
  return 'printed';
}



