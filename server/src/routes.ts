import { Router } from 'express';
import { authenticate, requireTenant, requireRole } from './middleware/auth.js';
import * as authCtrl from './modules/auth/authController.js';
import * as catalogCtrl from './modules/catalog/catalogController.js';
import * as billingCtrl from './modules/billing/billingController.js';
import * as customerCtrl from './modules/customers/customerController.js';
import * as inventoryCtrl from './modules/inventory/inventoryController.js';
import * as bizCtrl from './modules/businesses/businessController.js';
import * as adminCtrl from './modules/admin/adminController.js';
import * as purchaseCtrl from './modules/purchases/purchaseController.js';
import * as expenseCtrl from './modules/expenses/expenseController.js';
import * as acctCtrl from './modules/accounting/accountingController.js';
import * as staffCtrl from './modules/staff/staffController.js';
import * as quoteCtrl from './modules/quotations/quotationController.js';
import * as vertCtrl from './modules/verticals/verticalController.js';
import * as clothingCtrl from './modules/verticals/clothingController.js';
import * as backupCtrl from './modules/backup/backupController.js';
import * as branchCtrl from './modules/branches/branchController.js';
import * as transferCtrl from './modules/transfers/transferController.js';
import * as supportCtrl from './modules/support/supportController.js';
import * as auditCtrl from './modules/audit/auditController.js';
import * as returnsCtrl from './modules/returns/returnsController.js';
import * as storefrontCtrl from './modules/storefront/storefrontController.js';
import * as mfgCtrl from './modules/manufacturing/manufacturingController.js';
import * as loyaltyCtrl from './modules/loyalty/loyaltyController.js';
import * as schoolCtrl from './modules/verticals/schoolController.js';
import * as wholesaleCtrl from './modules/verticals/wholesaleController.js';
import * as serviceCtrl from './modules/verticals/serviceController.js';
import { SYSTEM_MODULES, CATEGORY_DEFAULT_MODULES, CATEGORY_METADATA } from './modules/registry/index.js';

const router = Router();

// ==========================================
// 1. PUBLIC & AUTH ROUTES (/api/v1/auth/* & /api/v1/public/*)
// ==========================================
router.post('/auth/login', authCtrl.login);
router.post('/auth/register', authCtrl.registerBusiness);
router.get('/auth/me', authenticate, authCtrl.getCurrentUser);

// Public Storefront & Customer Order Intake (PRD §4.20)
router.get('/public/store/:slug', storefrontCtrl.getPublicStore);
router.post('/public/store/:slug/orders', storefrontCtrl.createPublicOrder);
router.get('/public/orders/:order_number', storefrontCtrl.getPublicOrderStatus);

// Module Registry Metadata
router.get('/registry/modules', (req, res) => {
  res.json({
    modules: SYSTEM_MODULES,
    categoryDefaults: CATEGORY_DEFAULT_MODULES,
    categories: CATEGORY_METADATA,
  });
});

// ==========================================
// 2. TENANT APP ROUTES (/api/v1/app/*)
// ==========================================
const appRouter = Router();
appRouter.use(authenticate, requireTenant);

// Business Profile & Dashboard
appRouter.get('/business/profile', bizCtrl.getBusinessProfile);
appRouter.put('/business/profile', bizCtrl.updateBusinessProfile);
appRouter.get('/business/stats', bizCtrl.getDashboardStats);

// Catalog (Products & Categories)
appRouter.get('/products', catalogCtrl.getProducts);
appRouter.post('/products', catalogCtrl.createProduct);
appRouter.put('/products/:id', catalogCtrl.updateProduct);
appRouter.delete('/products/:id', catalogCtrl.deleteProduct);

appRouter.get('/categories', catalogCtrl.getCategories);
appRouter.post('/categories', catalogCtrl.createCategory);

// Billing & Invoicing (POS)
appRouter.post('/billing/checkout', billingCtrl.createInvoice);
appRouter.get('/billing/invoices', billingCtrl.getInvoices);
appRouter.get('/billing/invoices/:id', billingCtrl.getInvoiceById);
appRouter.post('/billing/invoices/:id/cancel', billingCtrl.cancelInvoice);

// Customers
appRouter.get('/customers', customerCtrl.getCustomers);
appRouter.post('/customers', customerCtrl.createCustomer);
appRouter.get('/customers/:id', customerCtrl.getCustomerById);

// Inventory
appRouter.get('/inventory/alerts', inventoryCtrl.getLowStockAlerts);
appRouter.post('/inventory/adjust', inventoryCtrl.adjustStock);
appRouter.get('/inventory/movements', inventoryCtrl.getStockMovements);

// Operations: Purchases & Suppliers
appRouter.get('/suppliers', purchaseCtrl.getSuppliers);
appRouter.post('/suppliers', purchaseCtrl.createSupplier);
appRouter.get('/purchases', purchaseCtrl.getPurchases);
appRouter.post('/purchases', purchaseCtrl.createPurchase);

// Operations: Expenses
appRouter.get('/expenses', expenseCtrl.getExpenses);
appRouter.post('/expenses', expenseCtrl.createExpense);

// Operations: Accounting & Reports
appRouter.get('/accounting/profit-loss', acctCtrl.getProfitAndLoss);
appRouter.get('/accounting/gst-summary', acctCtrl.getGstSummary);

// Operations: Staff Management
appRouter.get('/staff', staffCtrl.getStaff);
appRouter.post('/staff', staffCtrl.createStaff);
appRouter.put('/staff/:id/status', staffCtrl.toggleStaffStatus);

// Growth: Quotations
appRouter.get('/quotations', quoteCtrl.getQuotations);
appRouter.post('/quotations', quoteCtrl.createQuotation);
appRouter.post('/quotations/:id/convert', quoteCtrl.convertToInvoice);

// Verticals: Restaurant & Pharmacy & Notifications
appRouter.get('/verticals/restaurant/tables', vertCtrl.getTables);
appRouter.post('/verticals/restaurant/tables', vertCtrl.createTable);
appRouter.put('/verticals/restaurant/tables/:id/status', vertCtrl.updateTableStatus);
appRouter.get('/verticals/restaurant/kots', vertCtrl.getKots);
appRouter.post('/verticals/restaurant/kots', vertCtrl.createKot);
appRouter.put('/verticals/restaurant/kots/:id/status', vertCtrl.updateKotStatus);

appRouter.get('/verticals/pharmacy/expiry', vertCtrl.getPharmacyExpiryMonitoring);

// Verticals: Clothing & Fashion Variant Matrix (PRD §5)
appRouter.get('/verticals/clothing/products', clothingCtrl.getClothingProducts);
appRouter.post('/verticals/clothing/products', clothingCtrl.createClothingProduct);
appRouter.put('/verticals/clothing/variants/:id/stock', clothingCtrl.updateVariantStock);
appRouter.get('/verticals/clothing/exchanges', clothingCtrl.getGarmentExchanges);
appRouter.post('/verticals/clothing/exchanges', clothingCtrl.createGarmentExchange);
appRouter.get('/verticals/clothing/summary', clothingCtrl.getClothingSummary);

appRouter.get('/notifications', vertCtrl.getNotifications);
appRouter.put('/notifications/:id/read', vertCtrl.markNotificationRead);

// Phase 5: Backups & Data Disaster Recovery
appRouter.get('/backups/export', backupCtrl.exportBackup);
appRouter.post('/backups/snapshot', backupCtrl.createBackupSnapshot);
appRouter.get('/backups', backupCtrl.getBackups);
appRouter.post('/backups/restore', backupCtrl.restoreBackup);

// Phase 5: Multi-Store & Branches
appRouter.get('/branches', branchCtrl.getBranches);
appRouter.post('/branches', branchCtrl.createBranch);
appRouter.put('/branches/:id', branchCtrl.updateBranch);
appRouter.delete('/branches/:id', branchCtrl.deleteBranch);

// Inter-Branch Stock Transfers (PRD §4.4 & §4.19)
appRouter.get('/transfers', transferCtrl.getTransfers);
appRouter.get('/transfers/:id', transferCtrl.getTransferById);
appRouter.post('/transfers', transferCtrl.createTransfer);
appRouter.put('/transfers/:id/receive', transferCtrl.receiveTransfer);
appRouter.put('/transfers/:id/cancel', transferCtrl.cancelTransfer);

// Phase 5: Help & Support Desk
appRouter.get('/support/tickets', supportCtrl.getTickets);
appRouter.post('/support/tickets', supportCtrl.createTicket);
appRouter.get('/support/faqs', supportCtrl.getFaqs);

// Phase 5: Audit Activity Logs
appRouter.get('/audit/logs', auditCtrl.getTenantAuditLogs);

// Phase 6: Returns & Refunds (Sales Credit Notes & Purchase Debit Notes)
appRouter.get('/returns/sales', returnsCtrl.getSalesReturns);
appRouter.get('/returns/sales/lookup/:invoiceNumber', returnsCtrl.lookupInvoiceForReturn);
appRouter.post('/returns/sales', returnsCtrl.createSalesReturn);
appRouter.get('/returns/sales/:id', returnsCtrl.getSalesReturnById);

appRouter.get('/returns/purchases', returnsCtrl.getPurchaseReturns);
appRouter.get('/returns/purchases/lookup/:purchaseNumber', returnsCtrl.lookupPurchaseForReturn);
appRouter.post('/returns/purchases', returnsCtrl.createPurchaseReturn);
appRouter.get('/returns/purchases/:id', returnsCtrl.getPurchaseReturnById);

// Phase 9: Online Storefront & E-Commerce Orders (PRD §4.20)
appRouter.get('/store/config', storefrontCtrl.getStoreConfig);
appRouter.put('/store/config', storefrontCtrl.updateStoreConfig);
appRouter.get('/store/orders', storefrontCtrl.getStoreOrders);
appRouter.get('/store/orders/:id', storefrontCtrl.getStoreOrderById);
appRouter.put('/store/orders/:id/status', storefrontCtrl.updateOrderStatus);
appRouter.post('/store/orders/:id/convert-to-invoice', storefrontCtrl.convertOrderToInvoice);

// Phase 9: Manufacturing & Bill of Materials (PRD §5)
appRouter.get('/manufacturing/boms', mfgCtrl.getBoms);
appRouter.get('/manufacturing/boms/:id', mfgCtrl.getBomById);
appRouter.post('/manufacturing/boms', mfgCtrl.createBom);
appRouter.delete('/manufacturing/boms/:id', mfgCtrl.deleteBom);
appRouter.get('/manufacturing/orders', mfgCtrl.getProductionOrders);
appRouter.get('/manufacturing/orders/:id', mfgCtrl.getProductionOrderById);
appRouter.post('/manufacturing/orders', mfgCtrl.createProductionOrder);
appRouter.put('/manufacturing/orders/:id/start', mfgCtrl.startProductionOrder);
appRouter.post('/manufacturing/orders/:id/execute', mfgCtrl.executeProductionRun);
appRouter.put('/manufacturing/orders/:id/cancel', mfgCtrl.cancelProductionOrder);
appRouter.get('/manufacturing/stats', mfgCtrl.getManufacturingStats);

// Phase 10: Customer Loyalty & Rewards Points (PRD §4.13)
appRouter.get('/loyalty/rule', loyaltyCtrl.getLoyaltyRule);
appRouter.put('/loyalty/rule', loyaltyCtrl.updateLoyaltyRule);
appRouter.get('/loyalty/transactions', loyaltyCtrl.getLoyaltyTransactions);
appRouter.get('/loyalty/customers/:customerId', loyaltyCtrl.getCustomerLoyalty);
appRouter.post('/loyalty/adjust', loyaltyCtrl.adjustLoyaltyPoints);

// Phase 12: School & Institute Fee Collection Vertical (PRD §5)
appRouter.get('/verticals/school/students', schoolCtrl.getStudents);
appRouter.get('/verticals/school/students/:id', schoolCtrl.getStudentById);
appRouter.post('/verticals/school/students', schoolCtrl.createStudent);
appRouter.put('/verticals/school/students/:id', schoolCtrl.updateStudent);
appRouter.get('/verticals/school/fee-structures', schoolCtrl.getFeeStructures);
appRouter.post('/verticals/school/fee-structures', schoolCtrl.createFeeStructure);
appRouter.get('/verticals/school/receipts', schoolCtrl.getFeeReceipts);
appRouter.get('/verticals/school/receipts/:id', schoolCtrl.getFeeReceiptById);
appRouter.post('/verticals/school/receipts', schoolCtrl.createFeeReceipt);
appRouter.get('/verticals/school/summary', schoolCtrl.getSchoolSummary);

// Wholesale & Distribution Vertical (PRD §5)
appRouter.get('/verticals/wholesale/slabs', wholesaleCtrl.getBulkSlabs);
appRouter.post('/verticals/wholesale/slabs', wholesaleCtrl.createBulkSlab);
appRouter.delete('/verticals/wholesale/slabs/:id', wholesaleCtrl.deleteBulkSlab);
appRouter.get('/verticals/wholesale/routes', wholesaleCtrl.getDistributorRoutes);
appRouter.post('/verticals/wholesale/routes', wholesaleCtrl.createDistributorRoute);
appRouter.get('/verticals/wholesale/ledger/:customerId', wholesaleCtrl.getPartyLedger);
appRouter.post('/verticals/wholesale/ledger', wholesaleCtrl.addPartyLedgerEntry);
appRouter.put('/verticals/wholesale/credit/:customerId', wholesaleCtrl.updateCustomerCredit);
appRouter.get('/verticals/wholesale/summary', wholesaleCtrl.getWholesaleSummary);

// Service Businesses Vertical (PRD §5) & Hardware/Gateway Settings (PRD §8 & §9)
appRouter.get('/verticals/service/appointments', serviceCtrl.getAppointments);
appRouter.post('/verticals/service/appointments', serviceCtrl.createAppointment);
appRouter.put('/verticals/service/appointments/:id/status', serviceCtrl.updateAppointmentStatus);
appRouter.get('/verticals/service/job-cards', serviceCtrl.getJobCards);
appRouter.post('/verticals/service/job-cards', serviceCtrl.createJobCard);
appRouter.put('/verticals/service/job-cards/:id', serviceCtrl.updateJobCard);
appRouter.get('/verticals/service/recurring', serviceCtrl.getRecurringInvoices);
appRouter.post('/verticals/service/recurring', serviceCtrl.createRecurringInvoice);
appRouter.get('/verticals/service/hardware-settings', serviceCtrl.getHardwareSettings);
appRouter.put('/verticals/service/hardware-settings', serviceCtrl.updateHardwareSettings);
appRouter.get('/verticals/service/summary', serviceCtrl.getServiceSummary);

router.use('/app', appRouter);

// ==========================================
// 3. PLATFORM ADMIN ROUTES (/api/v1/admin/*)
// ==========================================
const adminRouter = Router();
adminRouter.use(authenticate, requireRole('SUPER_ADMIN'));

adminRouter.get('/dashboard', adminCtrl.getAdminDashboard);
adminRouter.get('/businesses', adminCtrl.listBusinesses);
adminRouter.put('/businesses/:id/status', adminCtrl.updateBusinessStatus);
adminRouter.get('/plans', adminCtrl.listPlans);
adminRouter.put('/plans/:id', adminCtrl.updatePlan);
adminRouter.get('/audit-logs', adminCtrl.getAuditLogs);
adminRouter.get('/support/tickets', supportCtrl.getTickets);
adminRouter.put('/support/tickets/:id/status', supportCtrl.updateTicketStatus);

router.use('/admin', adminRouter);

export default router;
