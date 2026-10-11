"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBusinessProfile = getBusinessProfile;
exports.updateBusinessProfile = updateBusinessProfile;
exports.getDashboardStats = getDashboardStats;
const connection_js_1 = require("../../db/connection.js");
function getBusinessProfile(req, res) {
    const businessId = req.businessId;
    const business = connection_js_1.db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
    if (!business) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Business not found' });
        return;
    }
    res.json({ business });
}
function updateBusinessProfile(req, res) {
    const businessId = req.businessId;
    const { name, gstin, address, city, state, pincode, phone, email, invoicePrefix } = req.body;
    connection_js_1.db.prepare(`
    UPDATE businesses SET
      name = COALESCE(?, name),
      gstin = COALESCE(?, gstin),
      address = COALESCE(?, address),
      city = COALESCE(?, city),
      state = COALESCE(?, state),
      pincode = COALESCE(?, pincode),
      phone = COALESCE(?, phone),
      email = COALESCE(?, email),
      invoice_prefix = COALESCE(?, invoice_prefix),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, gstin, address, city, state, pincode, phone, email, invoicePrefix, businessId);
    const updated = connection_js_1.db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
    res.json({ message: 'Profile updated successfully', business: updated });
}
function getDashboardStats(req, res) {
    const businessId = req.businessId;
    const todayStr = new Date().toISOString().split('T')[0];
    // 1. Today sales
    const todaySales = connection_js_1.db.prepare(`
    SELECT 
      COALESCE(SUM(total_paise), 0) as total_sales_paise,
      COUNT(id) as invoice_count
    FROM invoices 
    WHERE business_id = ? AND invoice_date = ? AND status = 'ISSUED'
  `).get(businessId, todayStr);
    // 2. Month sales
    const monthStart = todayStr.substring(0, 7) + '-01';
    const monthSales = connection_js_1.db.prepare(`
    SELECT 
      COALESCE(SUM(total_paise), 0) as month_sales_paise,
      COUNT(id) as month_invoice_count
    FROM invoices 
    WHERE business_id = ? AND invoice_date >= ? AND status = 'ISSUED'
  `).get(businessId, monthStart);
    // 3. Outstanding receivables
    const receivables = connection_js_1.db.prepare(`
    SELECT COALESCE(SUM(outstanding_balance_paise), 0) as total_receivables_paise
    FROM customers
    WHERE business_id = ?
  `).get(businessId);
    // 4. Low stock alerts count
    const lowStock = connection_js_1.db.prepare(`
    SELECT COUNT(id) as count 
    FROM products 
    WHERE business_id = ? AND is_active = 1 AND stock_quantity <= low_stock_threshold
  `).get(businessId);
    // 5. Total catalog items
    const catalogCount = connection_js_1.db.prepare(`
    SELECT COUNT(id) as count FROM products WHERE business_id = ? AND is_active = 1
  `).get(businessId);
    // 6. Recent 5 invoices
    const recentInvoices = connection_js_1.db.prepare(`
    SELECT id, invoice_number, customer_name, total_paise, payment_mode, payment_status, created_at
    FROM invoices
    WHERE business_id = ? AND status = 'ISSUED'
    ORDER BY created_at DESC
    LIMIT 5
  `).all(businessId);
    // 7. Top 5 selling products
    const topProducts = connection_js_1.db.prepare(`
    SELECT ii.product_name, SUM(ii.quantity) as total_sold, SUM(ii.total_paise) as total_revenue_paise
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE ii.business_id = ? AND i.status = 'ISSUED'
    GROUP BY ii.product_name
    ORDER BY total_sold DESC
    LIMIT 5
  `).all(businessId);
    res.json({
        today: {
            salesPaise: todaySales.total_sales_paise,
            invoices: todaySales.invoice_count,
        },
        month: {
            salesPaise: monthSales.month_sales_paise,
            invoices: monthSales.month_invoice_count,
        },
        receivablesPaise: receivables.total_receivables_paise,
        lowStockCount: lowStock.count,
        catalogCount: catalogCount.count,
        recentInvoices,
        topProducts,
    });
}
