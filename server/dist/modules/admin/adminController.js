"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdminDashboard = getAdminDashboard;
exports.listBusinesses = listBusinesses;
exports.updateBusinessStatus = updateBusinessStatus;
exports.listPlans = listPlans;
exports.updatePlan = updatePlan;
exports.getAuditLogs = getAuditLogs;
const connection_js_1 = require("../../db/connection.js");
function getAdminDashboard(req, res) {
    const totalBusinesses = connection_js_1.db.prepare('SELECT COUNT(*) as count FROM businesses').get();
    const activeBusinesses = connection_js_1.db.prepare("SELECT COUNT(*) as count FROM businesses WHERE status = 'ACTIVE'").get();
    const totalUsers = connection_js_1.db.prepare('SELECT COUNT(*) as count FROM users').get();
    const totalInvoices = connection_js_1.db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(total_paise), 0) as total_paise FROM invoices WHERE status = 'ISSUED'").get();
    // Breakdown by business category
    const categories = connection_js_1.db.prepare(`
    SELECT category, COUNT(*) as count 
    FROM businesses 
    GROUP BY category 
    ORDER BY count DESC
  `).all();
    // Breakdown by plan
    const plans = connection_js_1.db.prepare(`
    SELECT p.name, p.tier, COUNT(b.id) as business_count
    FROM plans p
    LEFT JOIN businesses b ON p.id = b.plan_id
    GROUP BY p.id
  `).all();
    // Recent 10 registered businesses
    const recentBusinesses = connection_js_1.db.prepare(`
    SELECT b.*, p.name as plan_name, u.email as owner_email, u.name as owner_name
    FROM businesses b
    LEFT JOIN plans p ON b.plan_id = p.id
    LEFT JOIN users u ON u.business_id = b.id AND u.role = 'BUSINESS_OWNER'
    ORDER BY b.created_at DESC
    LIMIT 10
  `).all();
    res.json({
        stats: {
            totalBusinesses: totalBusinesses.count,
            activeBusinesses: activeBusinesses.count,
            totalUsers: totalUsers.count,
            platformTotalSalesPaise: totalInvoices.total_paise,
            platformTotalInvoices: totalInvoices.count,
        },
        categoryBreakdown: categories,
        planBreakdown: plans,
        recentBusinesses,
    });
}
function listBusinesses(req, res) {
    const { search, category, status } = req.query;
    const conditions = ['1=1'];
    const params = [];
    if (search) {
        conditions.push('(b.name LIKE ? OR b.email LIKE ? OR b.phone LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (category) {
        conditions.push('b.category = ?');
        params.push(category);
    }
    if (status) {
        conditions.push('b.status = ?');
        params.push(status);
    }
    const businesses = connection_js_1.db.prepare(`
    SELECT b.*, p.name as plan_name, u.name as owner_name, u.email as owner_email
    FROM businesses b
    LEFT JOIN plans p ON b.plan_id = p.id
    LEFT JOIN users u ON u.business_id = b.id AND u.role = 'BUSINESS_OWNER'
    WHERE ${conditions.join(' AND ')}
    ORDER BY b.created_at DESC
  `).all(...params);
    res.json({ data: businesses });
}
function updateBusinessStatus(req, res) {
    const { id } = req.params;
    const { status } = req.body;
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Status must be ACTIVE or SUSPENDED' });
        return;
    }
    connection_js_1.db.prepare("UPDATE businesses SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    res.json({ message: `Business status updated to ${status}` });
}
function listPlans(req, res) {
    const plans = connection_js_1.db.prepare('SELECT * FROM plans ORDER BY price_paise ASC').all();
    res.json({
        data: plans.map((p) => ({
            ...p,
            features: p.features_json ? JSON.parse(p.features_json) : [],
        })),
    });
}
function updatePlan(req, res) {
    const { id } = req.params;
    const { name, pricePaise, maxUsers, maxInvoicesPerMonth, features } = req.body;
    connection_js_1.db.prepare(`
    UPDATE plans SET
      name = COALESCE(?, name),
      price_paise = COALESCE(?, price_paise),
      max_users = COALESCE(?, max_users),
      max_invoices_per_month = COALESCE(?, max_invoices_per_month),
      features_json = COALESCE(?, features_json)
    WHERE id = ?
  `).run(name, pricePaise !== undefined ? Math.round(pricePaise) : null, maxUsers, maxInvoicesPerMonth, features ? JSON.stringify(features) : null, id);
    res.json({ message: 'Plan updated successfully' });
}
function getAuditLogs(req, res) {
    const logs = connection_js_1.db.prepare(`
    SELECT a.*, u.name as user_name, u.email as user_email, b.name as business_name
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN businesses b ON a.business_id = b.id
    ORDER BY a.created_at DESC
    LIMIT 100
  `).all();
    res.json({ data: logs });
}
