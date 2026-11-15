"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importStar(require("express"));
const auth_js_1 = require("./middleware/auth.js");
const middleware_js_1 = require("./licensing/middleware.js");
const licenseCtrl = __importStar(require("./licensing/licenseController.js"));
const authCtrl = __importStar(require("./modules/auth/authController.js"));
const catalogCtrl = __importStar(require("./modules/catalog/catalogController.js"));
const billingCtrl = __importStar(require("./modules/billing/billingController.js"));
const customerCtrl = __importStar(require("./modules/customers/customerController.js"));
const inventoryCtrl = __importStar(require("./modules/inventory/inventoryController.js"));
const bizCtrl = __importStar(require("./modules/businesses/businessController.js"));
const adminCtrl = __importStar(require("./modules/admin/adminController.js"));
const purchaseCtrl = __importStar(require("./modules/purchases/purchaseController.js"));
const expenseCtrl = __importStar(require("./modules/expenses/expenseController.js"));
const acctCtrl = __importStar(require("./modules/accounting/accountingController.js"));
const staffCtrl = __importStar(require("./modules/staff/staffController.js"));
const quoteCtrl = __importStar(require("./modules/quotations/quotationController.js"));
const vertCtrl = __importStar(require("./modules/verticals/verticalController.js"));
const clothingCtrl = __importStar(require("./modules/verticals/clothingController.js"));
const backupCtrl = __importStar(require("./modules/backup/backupController.js"));
const branchCtrl = __importStar(require("./modules/branches/branchController.js"));
const transferCtrl = __importStar(require("./modules/transfers/transferController.js"));
const supportCtrl = __importStar(require("./modules/support/supportController.js"));
const auditCtrl = __importStar(require("./modules/audit/auditController.js"));
const returnsCtrl = __importStar(require("./modules/returns/returnsController.js"));
const storefrontCtrl = __importStar(require("./modules/storefront/storefrontController.js"));
const mfgCtrl = __importStar(require("./modules/manufacturing/manufacturingController.js"));
const loyaltyCtrl = __importStar(require("./modules/loyalty/loyaltyController.js"));
const schoolCtrl = __importStar(require("./modules/verticals/schoolController.js"));
const wholesaleCtrl = __importStar(require("./modules/verticals/wholesaleController.js"));
const serviceCtrl = __importStar(require("./modules/verticals/serviceController.js"));
const index_js_1 = require("./modules/registry/index.js");
const router = (0, express_1.Router)();
// ==========================================
// 1. PUBLIC & AUTH ROUTES (/api/v1/auth/* & /api/v1/public/*)
// ==========================================
router.post('/auth/login', authCtrl.login);
router.post('/auth/register', authCtrl.registerBusiness);
router.post('/auth/erase-shop', auth_js_1.authenticate, authCtrl.eraseShop);
router.get('/auth/me', auth_js_1.authenticate, authCtrl.getCurrentUser);
// Local license management (talks to the central license server)
router.get('/license/status', licenseCtrl.getStatus);
router.post('/license/connectivity', licenseCtrl.checkConnectivity);
router.get('/license/events', licenseCtrl.streamEvents);
router.post('/license/trial', ...licenseCtrl.startTrial);
router.post('/license/activate', ...licenseCtrl.activate);
router.post('/license/deactivate', ...licenseCtrl.deactivate);
router.post('/license/sync', auth_js_1.authenticate, licenseCtrl.sync);
router.post('/license/usage', auth_js_1.authenticate, licenseCtrl.trackUsage);
router.get('/license/usage', auth_js_1.authenticate, licenseCtrl.getUsage);
// Public Storefront & Customer Order Intake (PRD §4.20)
router.get('/public/store/:slug', storefrontCtrl.getPublicStore);
router.post('/public/store/:slug/orders', storefrontCtrl.createPublicOrder);
router.get('/public/orders/:order_number', storefrontCtrl.getPublicOrderStatus);
// Module Registry Metadata
router.get('/registry/modules', (req, res) => {
    res.json({
        modules: index_js_1.SYSTEM_MODULES,
        categoryDefaults: index_js_1.CATEGORY_DEFAULT_MODULES,
        categories: index_js_1.CATEGORY_METADATA,
    });
});
// ==========================================
// 2. TENANT APP ROUTES (/api/v1/app/*)
// ==========================================
const appRouter = (0, express_1.Router)();
appRouter.use(auth_js_1.authenticate, auth_js_1.requireTenant, middleware_js_1.licenseGuard);
const ownerOnly = (0, auth_js_1.requireRole)('BUSINESS_OWNER', 'SUPER_ADMIN');
// Business Profile & Dashboard
appRouter.get('/business/profile', bizCtrl.getBusinessProfile);
appRouter.put('/business/profile', bizCtrl.updateBusinessProfile);
appRouter.get('/business/stats', bizCtrl.getDashboardStats);
appRouter.get('/business/settings', bizCtrl.getSettings);
appRouter.put('/business/settings', ownerOnly, bizCtrl.updateSettings);
// Catalog (Products & Categories)
appRouter.get('/products', catalogCtrl.getProducts);
appRouter.get('/products/export', catalogCtrl.exportProducts);
appRouter.post('/products', catalogCtrl.createProduct);
appRouter.put('/products/:id', catalogCtrl.updateProduct);
appRouter.delete('/products/:id', catalogCtrl.deleteProduct);
appRouter.get('/categories', catalogCtrl.getCategories);
appRouter.post('/categories', catalogCtrl.createCategory);
appRouter.put('/categories/:id', catalogCtrl.updateCategory);
appRouter.delete('/categories/:id', catalogCtrl.deleteCategory);
// Billing & Invoicing (POS)
appRouter.post('/billing/checkout', billingCtrl.createInvoice);
appRouter.get('/billing/invoices', billingCtrl.getInvoices);
appRouter.get('/billing/invoices/:id', billingCtrl.getInvoiceById);
appRouter.post('/billing/invoices/:id/cancel', billingCtrl.cancelInvoice);
appRouter.post('/billing/invoices/:id/payments', billingCtrl.recordPayment);
appRouter.post('/billing/invoices/:id/duplicate', billingCtrl.duplicateInvoice);
appRouter.put('/billing/invoices/:id/draft', billingCtrl.updateDraft);
appRouter.post('/billing/invoices/:id/issue', billingCtrl.issueDraft);
appRouter.delete('/billing/invoices/:id/draft', billingCtrl.deleteDraft);
appRouter.delete('/billing/invoices/:id', billingCtrl.deleteInvoice);
appRouter.get('/billing/payments', billingCtrl.getPayments);
appRouter.get('/billing/held', billingCtrl.getHeldBills);
appRouter.post('/billing/held', billingCtrl.holdBill);
appRouter.delete('/billing/held/:id', billingCtrl.deleteHeldBill);
// Customers
appRouter.get('/customers', customerCtrl.getCustomers);
appRouter.get('/customers/export', customerCtrl.exportCustomers);
appRouter.post('/customers', customerCtrl.createCustomer);
appRouter.get('/customers/:id', customerCtrl.getCustomerById);
appRouter.put('/customers/:id', customerCtrl.updateCustomer);
appRouter.delete('/customers/:id', customerCtrl.deleteCustomer);
appRouter.get('/customers/:id/ledger', customerCtrl.getCustomerLedger);
appRouter.post('/customers/:id/payments', customerCtrl.receiveCustomerPayment);
// Inventory
appRouter.get('/inventory/alerts', inventoryCtrl.getLowStockAlerts);
appRouter.post('/inventory/adjust', inventoryCtrl.adjustStock);
appRouter.get('/inventory/movements', inventoryCtrl.getStockMovements);
appRouter.get('/inventory/valuation', catalogCtrl.getInventoryValuation);
// Operations: Purchases & Suppliers
appRouter.get('/suppliers', purchaseCtrl.getSuppliers);
appRouter.post('/suppliers', purchaseCtrl.createSupplier);
appRouter.put('/suppliers/:id', purchaseCtrl.updateSupplier);
appRouter.delete('/suppliers/:id', purchaseCtrl.deleteSupplier);
appRouter.post('/suppliers/:id/payments', purchaseCtrl.paySupplier);
appRouter.get('/suppliers/:id/ledger', purchaseCtrl.getSupplierLedger);
appRouter.get('/purchases', purchaseCtrl.getPurchases);
appRouter.post('/purchases', purchaseCtrl.createPurchase);
appRouter.get('/purchases/:id', purchaseCtrl.getPurchaseById);
appRouter.delete('/purchases/:id', purchaseCtrl.deletePurchase);
appRouter.get('/purchase-orders', purchaseCtrl.getPurchaseOrders);
appRouter.post('/purchase-orders', purchaseCtrl.createPurchaseOrder);
appRouter.get('/purchase-orders/:id', purchaseCtrl.getPurchaseOrderById);
appRouter.post('/purchase-orders/:id/receive', purchaseCtrl.receivePurchaseOrder);
appRouter.post('/purchase-orders/:id/cancel', purchaseCtrl.cancelPurchaseOrder);
// Operations: Expenses
appRouter.get('/expenses', expenseCtrl.getExpenses);
appRouter.get('/expenses/categories', expenseCtrl.getExpenseCategories);
appRouter.get('/expenses/analytics', expenseCtrl.getExpenseAnalytics);
appRouter.get('/expenses/export', expenseCtrl.exportExpenses);
appRouter.post('/expenses', expenseCtrl.createExpense);
appRouter.put('/expenses/:id', expenseCtrl.updateExpense);
appRouter.delete('/expenses/:id', expenseCtrl.deleteExpense);
// Operations: Accounting & Reports
appRouter.get('/accounting/profit-loss', acctCtrl.getProfitAndLoss);
appRouter.get('/accounting/gst-summary', acctCtrl.getGstSummary);
appRouter.get('/reports', acctCtrl.listReports);
appRouter.get('/reports/:type', acctCtrl.getReport);
appRouter.get('/reports/:type/export', acctCtrl.exportReport);
// Operations: Staff Management
appRouter.get('/staff', staffCtrl.getStaff);
appRouter.post('/staff', staffCtrl.createStaff);
appRouter.put('/staff/:id/status', staffCtrl.toggleStaffStatus);
// Growth: Quotations
appRouter.get('/quotations', quoteCtrl.getQuotations);
appRouter.post('/quotations', quoteCtrl.createQuotation);
appRouter.delete('/quotations/:id', quoteCtrl.deleteQuotation);
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
appRouter.get('/backups/settings', backupCtrl.getBackupSettings);
appRouter.put('/backups/settings', ownerOnly, backupCtrl.updateBackupSettings);
appRouter.post('/backups/restore', ownerOnly, backupCtrl.restoreBackup);
appRouter.post('/backups/restore-upload', ownerOnly, express_1.default.raw({ type: 'application/octet-stream', limit: '1gb' }), backupCtrl.uploadAndRestore);
appRouter.post('/backups/:id/verify', backupCtrl.verifyBackup);
appRouter.delete('/backups/:id', ownerOnly, backupCtrl.deleteBackup);
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
const adminRouter = (0, express_1.Router)();
adminRouter.use(auth_js_1.authenticate, (0, auth_js_1.requireRole)('SUPER_ADMIN'));
adminRouter.get('/dashboard', adminCtrl.getAdminDashboard);
adminRouter.get('/businesses', adminCtrl.listBusinesses);
adminRouter.put('/businesses/:id/status', adminCtrl.updateBusinessStatus);
adminRouter.get('/plans', adminCtrl.listPlans);
adminRouter.put('/plans/:id', adminCtrl.updatePlan);
adminRouter.get('/audit-logs', adminCtrl.getAuditLogs);
adminRouter.get('/support/tickets', supportCtrl.getTickets);
adminRouter.put('/support/tickets/:id/status', supportCtrl.updateTicketStatus);
router.use('/admin', adminRouter);
exports.default = router;
