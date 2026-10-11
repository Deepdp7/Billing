"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTables = getTables;
exports.createTable = createTable;
exports.updateTableStatus = updateTableStatus;
exports.getKots = getKots;
exports.createKot = createKot;
exports.updateKotStatus = updateKotStatus;
exports.getPharmacyExpiryMonitoring = getPharmacyExpiryMonitoring;
exports.getNotifications = getNotifications;
exports.markNotificationRead = markNotificationRead;
const uuid_1 = require("uuid");
const connection_js_1 = require("../../db/connection.js");
// ================= RESTAURANT TABLES & KOT =================
function getTables(req, res) {
    const businessId = req.businessId;
    const tables = connection_js_1.db.prepare('SELECT * FROM restaurant_tables WHERE business_id = ? ORDER BY table_number ASC').all(businessId);
    res.json({ data: tables });
}
function createTable(req, res) {
    const businessId = req.businessId;
    const { tableNumber, capacity = 4 } = req.body;
    const id = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO restaurant_tables (id, business_id, table_number, capacity, status, created_at)
    VALUES (?, ?, ?, ?, 'VACANT', datetime('now'))
  `).run(id, businessId, tableNumber, Number(capacity));
    res.status(201).json({ message: 'Table created' });
}
function updateTableStatus(req, res) {
    const businessId = req.businessId;
    const { id } = req.params;
    const { status } = req.body;
    connection_js_1.db.prepare('UPDATE restaurant_tables SET status = ? WHERE id = ? AND business_id = ?').run(status, id, businessId);
    res.json({ message: `Table status updated to ${status}` });
}
function getKots(req, res) {
    const businessId = req.businessId;
    const kots = connection_js_1.db.prepare('SELECT * FROM kots WHERE business_id = ? ORDER BY created_at DESC LIMIT 50').all(businessId);
    res.json({
        data: kots.map((k) => ({
            ...k,
            items: JSON.parse(k.items_json || '[]'),
        })),
    });
}
function createKot(req, res) {
    const businessId = req.businessId;
    const { tableNumber, items = [] } = req.body;
    const id = (0, uuid_1.v4)();
    const kotNumber = `KOT-${Date.now().toString().slice(-4)}`;
    connection_js_1.db.prepare(`
    INSERT INTO kots (id, business_id, kot_number, table_number, items_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING', datetime('now'))
  `).run(id, businessId, kotNumber, tableNumber, JSON.stringify(items));
    // Also set table to OCCUPIED
    connection_js_1.db.prepare("UPDATE restaurant_tables SET status = 'OCCUPIED' WHERE table_number = ? AND business_id = ?").run(tableNumber, businessId);
    res.status(201).json({ message: 'KOT generated successfully', kotNumber });
}
function updateKotStatus(req, res) {
    const businessId = req.businessId;
    const { id } = req.params;
    const { status } = req.body;
    connection_js_1.db.prepare('UPDATE kots SET status = ? WHERE id = ? AND business_id = ?').run(status, id, businessId);
    res.json({ message: `KOT status updated to ${status}` });
}
// ================= PHARMACY NEAR-EXPIRY MONITORING =================
function getPharmacyExpiryMonitoring(req, res) {
    const businessId = req.businessId;
    const products = connection_js_1.db.prepare(`
    SELECT id, name, sku, stock_quantity, extra_attributes_json
    FROM products 
    WHERE business_id = ? AND is_active = 1
  `).all(businessId);
    const batches = products
        .filter(p => p.extra_attributes_json)
        .map(p => {
        const extra = JSON.parse(p.extra_attributes_json || '{}');
        return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            stockQuantity: p.stock_quantity,
            batchNo: extra.batch_no || 'N/A',
            expiryDate: extra.expiry_date || null,
            composition: extra.composition || 'N/A',
        };
    })
        .filter(b => b.expiryDate);
    res.json({ data: batches });
}
// ================= IN-APP NOTIFICATIONS =================
function getNotifications(req, res) {
    const businessId = req.businessId;
    const notifications = connection_js_1.db.prepare('SELECT * FROM notifications WHERE business_id = ? ORDER BY created_at DESC LIMIT 30').all(businessId);
    res.json({ data: notifications });
}
function markNotificationRead(req, res) {
    const businessId = req.businessId;
    const { id } = req.params;
    connection_js_1.db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND business_id = ?').run(id, businessId);
    res.json({ message: 'Notification marked as read' });
}
