"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSuppliers = getSuppliers;
exports.createSupplier = createSupplier;
exports.getPurchases = getPurchases;
exports.createPurchase = createPurchase;
const uuid_1 = require("uuid");
const connection_js_1 = require("../../db/connection.js");
function getSuppliers(req, res) {
    const businessId = req.businessId;
    const suppliers = connection_js_1.db.prepare('SELECT * FROM suppliers WHERE business_id = ? ORDER BY name ASC').all(businessId);
    res.json({ data: suppliers });
}
function createSupplier(req, res) {
    const businessId = req.businessId;
    const { name, phone = '', email = '', gstin = '', address = '', openingBalancePaise = 0 } = req.body;
    if (!name) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Supplier name is required' });
        return;
    }
    const id = (0, uuid_1.v4)();
    connection_js_1.db.prepare(`
    INSERT INTO suppliers (id, business_id, name, phone, email, gstin, address, outstanding_balance_paise, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, businessId, name, phone, email, gstin, address, Math.round(Number(openingBalancePaise) || 0));
    const supplier = connection_js_1.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    res.status(201).json({ message: 'Supplier added successfully', supplier });
}
function getPurchases(req, res) {
    const businessId = req.businessId;
    const purchases = connection_js_1.db.prepare(`
    SELECT * FROM purchase_invoices 
    WHERE business_id = ? 
    ORDER BY invoice_date DESC, created_at DESC
  `).all(businessId);
    res.json({ data: purchases });
}
function createPurchase(req, res) {
    const businessId = req.businessId;
    const { supplierId, supplierName, purchaseNumber, items = [], notes = '', amountPaidPaise = 0, } = req.body;
    if (!supplierName || !purchaseNumber || !items.length) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Supplier name, bill number, and items are required' });
        return;
    }
    const purchaseId = (0, uuid_1.v4)();
    const todayStr = new Date().toISOString().split('T')[0];
    let subtotalPaise = 0;
    let taxPaise = 0;
    const processedItems = items.map((it) => {
        const qty = Number(it.quantity) || 1;
        const rate = Math.round(Number(it.unitPricePaise) || 0);
        const taxRate = Number(it.taxRate) || 0;
        const lineSubtotal = qty * rate;
        const lineTax = Math.round((lineSubtotal * taxRate) / 100);
        const lineTotal = lineSubtotal + lineTax;
        subtotalPaise += lineSubtotal;
        taxPaise += lineTax;
        return {
            id: (0, uuid_1.v4)(),
            productId: it.productId || null,
            productName: it.productName,
            quantity: qty,
            unitPricePaise: rate,
            taxRate,
            taxPaise: lineTax,
            totalPaise: lineTotal,
        };
    });
    const totalPaise = subtotalPaise + taxPaise;
    const paid = Math.min(totalPaise, Math.round(Number(amountPaidPaise) || 0));
    const paymentStatus = paid >= totalPaise ? 'PAID' : (paid > 0 ? 'PARTIAL' : 'UNPAID');
    const transaction = connection_js_1.db.transaction(() => {
        // 1. Insert Purchase Invoice
        connection_js_1.db.prepare(`
      INSERT INTO purchase_invoices (
        id, business_id, supplier_id, supplier_name, purchase_number, invoice_date,
        subtotal_paise, tax_paise, total_paise, payment_status, amount_paid_paise, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(purchaseId, businessId, supplierId || null, supplierName, purchaseNumber, todayStr, subtotalPaise, taxPaise, totalPaise, paymentStatus, paid, notes);
        // 2. Insert line items & Atomically increase stock
        const insertItem = connection_js_1.db.prepare(`
      INSERT INTO purchase_items (
        id, business_id, purchase_id, product_id, product_name, quantity, unit_price_paise, tax_rate, tax_paise, total_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const updateStock = connection_js_1.db.prepare(`
      UPDATE products 
      SET stock_quantity = stock_quantity + ?, purchase_price_paise = ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `);
        const recordMovement = connection_js_1.db.prepare(`
      INSERT INTO stock_movements (
        id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at
      ) VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'PURCHASE', ?, ?, datetime('now'))
    `);
        for (const item of processedItems) {
            insertItem.run(item.id, businessId, purchaseId, item.productId, item.productName, item.quantity, item.unitPricePaise, item.taxRate, item.taxPaise, item.totalPaise);
            if (item.productId) {
                updateStock.run(item.quantity, item.unitPricePaise, item.productId, businessId);
                recordMovement.run((0, uuid_1.v4)(), businessId, item.productId, item.quantity, item.productId, purchaseId, `Purchase from ${supplierName} (${purchaseNumber})`);
            }
        }
        // 3. Update Supplier Payable
        if (supplierId && totalPaise > paid) {
            const balanceOwed = totalPaise - paid;
            connection_js_1.db.prepare(`
        UPDATE suppliers 
        SET outstanding_balance_paise = outstanding_balance_paise + ?, updated_at = datetime('now')
        WHERE id = ? AND business_id = ?
      `).run(balanceOwed, supplierId, businessId);
        }
    });
    try {
        transaction();
        res.status(201).json({ message: 'Purchase recorded and stock updated successfully' });
    }
    catch (err) {
        res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
    }
}
