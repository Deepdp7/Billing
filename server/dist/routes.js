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
const express_1 = require("express");
const auth_js_1 = require("./middleware/auth.js");
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
const backupCtrl = __importStar(require("./modules/backup/backupController.js"));
const branchCtrl = __importStar(require("./modules/branches/branchController.js"));
const supportCtrl = __importStar(require("./modules/support/supportController.js"));
const auditCtrl = __importStar(require("./modules/audit/auditController.js"));
const index_js_1 = require("./modules/registry/index.js");
const router = (0, express_1.Router)();
// ==========================================
// 1. PUBLIC & AUTH ROUTES (/api/v1/auth/*)
// ==========================================
router.post('/auth/login', authCtrl.login);
router.post('/auth/register', authCtrl.registerBusiness);
router.get('/auth/me', auth_js_1.authenticate, authCtrl.getCurrentUser);
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
appRouter.use(auth_js_1.authenticate, auth_js_1.requireTenant);
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
// Phase 5: Help & Support Desk
appRouter.get('/support/tickets', supportCtrl.getTickets);
appRouter.post('/support/tickets', supportCtrl.createTicket);
appRouter.get('/support/faqs', supportCtrl.getFaqs);
// Phase 5: Audit Activity Logs
appRouter.get('/audit/logs', auditCtrl.getTenantAuditLogs);
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
