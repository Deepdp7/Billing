"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStaff = getStaff;
exports.createStaff = createStaff;
exports.toggleStaffStatus = toggleStaffStatus;
const uuid_1 = require("uuid");
const connection_js_1 = require("../../db/connection.js");
function getStaff(req, res) {
    const businessId = req.businessId;
    const staff = connection_js_1.db.prepare('SELECT * FROM staff WHERE business_id = ? ORDER BY name ASC').all(businessId);
    res.json({ data: staff });
}
function createStaff(req, res) {
    const businessId = req.businessId;
    const { name, email, phone = '', role = 'CASHIER' } = req.body;
    if (!name || !email) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Name and email are required' });
        return;
    }
    const id = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO staff (id, business_id, name, email, phone, role, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', datetime('now'))
  `).run(id, businessId, name, email, phone, role);
    const member = connection_js_1.db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
    res.status(201).json({ message: 'Staff member added', staff: member });
}
function toggleStaffStatus(req, res) {
    const businessId = req.businessId;
    const { id } = req.params;
    const { status } = req.body;
    connection_js_1.db.prepare('UPDATE staff SET status = ? WHERE id = ? AND business_id = ?').run(status, id, businessId);
    res.json({ message: `Staff status updated to ${status}` });
}
