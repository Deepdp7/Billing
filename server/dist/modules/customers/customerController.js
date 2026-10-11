"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomers = getCustomers;
exports.createCustomer = createCustomer;
exports.getCustomerById = getCustomerById;
const uuid_1 = require("uuid");
const connection_js_1 = require("../../db/connection.js");
function getCustomers(req, res) {
    const businessId = req.businessId;
    const { search, limit = 50, page = 1 } = req.query;
    const conditions = ['business_id = ?'];
    const params = [businessId];
    if (search) {
        conditions.push('(name LIKE ? OR phone LIKE ? OR gstin LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const whereClause = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(limit);
    const total = connection_js_1.db.prepare(`SELECT COUNT(*) as count FROM customers WHERE ${whereClause}`).get(...params);
    const customers = connection_js_1.db.prepare(`
    SELECT * FROM customers 
    WHERE ${whereClause} 
    ORDER BY name ASC 
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);
    res.json({
        data: customers,
        pagination: {
            total: total.count,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total.count / Number(limit)),
        },
    });
}
function createCustomer(req, res) {
    const businessId = req.businessId;
    const { name, phone = '', email = '', gstin = '', address = '', creditLimitPaise = 0 } = req.body;
    if (!name) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Customer name is required' });
        return;
    }
    const id = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO customers (id, business_id, name, phone, email, gstin, address, credit_limit_paise, outstanding_balance_paise, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
  `).run(id, businessId, name, phone, email, gstin, address, Math.round(Number(creditLimitPaise) || 0));
    const customer = connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    res.status(201).json({ message: 'Customer added successfully', customer });
}
function getCustomerById(req, res) {
    const businessId = req.businessId;
    const { id } = req.params;
    const customer = connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(id, businessId);
    if (!customer) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Customer not found' });
        return;
    }
    const invoices = connection_js_1.db.prepare(`
    SELECT * FROM invoices 
    WHERE customer_id = ? AND business_id = ? 
    ORDER BY created_at DESC 
    LIMIT 20
  `).all(id, businessId);
    res.json({ customer, invoices });
}
