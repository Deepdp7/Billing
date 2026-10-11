"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTenantAuditLogs = getTenantAuditLogs;
const connection_js_1 = require("../../db/connection.js");
function getTenantAuditLogs(req, res) {
    const businessId = req.businessId;
    const logs = connection_js_1.db.prepare(`
    SELECT al.*, u.name as user_name, u.email as user_email
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.business_id = ?
    ORDER BY al.created_at DESC
    LIMIT 100
  `).all(businessId);
    res.json({ logs });
}
