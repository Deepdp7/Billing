"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuotations = getQuotations;
exports.createQuotation = createQuotation;
exports.convertToInvoice = convertToInvoice;
const uuid_1 = require("uuid");
const connection_js_1 = require("../../db/connection.js");
function getQuotations(req, res) {
    const businessId = req.businessId;
    const quotes = connection_js_1.db.prepare('SELECT * FROM quotations WHERE business_id = ? ORDER BY created_at DESC').all(businessId);
    res.json({ data: quotes });
}
function createQuotation(req, res) {
    const businessId = req.businessId;
    const { customerName, customerPhone = '', validUntil, items = [], notes = '' } = req.body;
    if (!customerName || !items.length) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Customer name and items are required' });
        return;
    }
    const quoteId = (0, uuid_1.v4)();
    const quoteNumber = `EST-${Date.now().toString().slice(-5)}`;
    let subtotal = 0;
    let tax = 0;
    const processed = items.map((it) => {
        const qty = Number(it.quantity) || 1;
        const rate = Math.round(Number(it.unitPricePaise) || 0);
        const taxRate = Number(it.taxRate) || 0;
        const lineSubtotal = qty * rate;
        const lineTax = Math.round((lineSubtotal * taxRate) / 100);
        const lineTotal = lineSubtotal + lineTax;
        subtotal += lineSubtotal;
        tax += lineTax;
        return {
            id: (0, uuid_1.v4)(),
            productName: it.productName,
            quantity: qty,
            unitPricePaise: rate,
            taxRate,
            taxPaise: lineTax,
            totalPaise: lineTotal,
        };
    });
    const total = subtotal + tax;
    const transaction = connection_js_1.db.transaction(() => {
        connection_js_1.db.prepare(`
      INSERT INTO quotations (id, business_id, quotation_number, customer_name, customer_phone, valid_until, subtotal_paise, tax_paise, total_paise, status, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SENT', ?, datetime('now'))
    `).run(quoteId, businessId, quoteNumber, customerName, customerPhone, validUntil || null, subtotal, tax, total, notes);
        const insertItem = connection_js_1.db.prepare(`
      INSERT INTO quotation_items (id, business_id, quotation_id, product_name, quantity, unit_price_paise, tax_rate, tax_paise, total_paise)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        for (const it of processed) {
            insertItem.run(it.id, businessId, quoteId, it.productName, it.quantity, it.unitPricePaise, it.taxRate, it.taxPaise, it.totalPaise);
        }
    });
    try {
        transaction();
        res.status(201).json({ message: 'Quotation created successfully', quotationNumber: quoteNumber });
    }
    catch (err) {
        res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message });
    }
}
function convertToInvoice(req, res) {
    const businessId = req.businessId;
    const { id } = req.params;
    const quote = connection_js_1.db.prepare('SELECT * FROM quotations WHERE id = ? AND business_id = ?').get(id, businessId);
    if (!quote) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Quotation not found' });
        return;
    }
    const items = connection_js_1.db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(id);
    const business = connection_js_1.db.prepare('SELECT invoice_prefix, next_invoice_number FROM businesses WHERE id = ?').get(businessId);
    const invoiceId = (0, uuid_1.v4)();
    const invoiceNumber = `${business.invoice_prefix}${business.next_invoice_number}`;
    const todayStr = new Date().toISOString().split('T')[0];
    const transaction = connection_js_1.db.transaction(() => {
        // 1. Mark quote as CONVERTED
        connection_js_1.db.prepare("UPDATE quotations SET status = 'CONVERTED' WHERE id = ?").run(id);
        // 2. Insert Invoice
        connection_js_1.db.prepare(`
      INSERT INTO invoices (
        id, business_id, invoice_number, customer_name, customer_phone, invoice_date,
        subtotal_paise, discount_paise, tax_paise, cgst_paise, sgst_paise, igst_paise, total_paise,
        payment_mode, payment_status, amount_paid_paise, notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, 'CASH', 'PAID', ?, ?, 'ISSUED', datetime('now'))
    `).run(invoiceId, businessId, invoiceNumber, quote.customer_name, quote.customer_phone, todayStr, quote.subtotal_paise, quote.tax_paise, Math.round(quote.tax_paise / 2), quote.tax_paise - Math.round(quote.tax_paise / 2), quote.total_paise, quote.total_paise, `Converted from Quotation ${quote.quotation_number}`);
        // 3. Insert Invoice Items
        const insertLine = connection_js_1.db.prepare(`
      INSERT INTO invoice_items (id, business_id, invoice_id, product_name, quantity, unit_price_paise, discount_paise, tax_rate, tax_paise, total_paise)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);
        for (const it of items) {
            insertLine.run((0, uuid_1.v4)(), businessId, invoiceId, it.product_name, it.quantity, it.unit_price_paise, it.tax_rate, it.tax_paise, it.total_paise);
        }
        // 4. Increment invoice number
        connection_js_1.db.prepare('UPDATE businesses SET next_invoice_number = next_invoice_number + 1 WHERE id = ?').run(businessId);
    });
    try {
        transaction();
        res.json({ message: `Quotation converted to Invoice ${invoiceNumber}`, invoiceId });
    }
    catch (err) {
        res.status(500).json({ code: 'CONVERT_FAILED', message: err.message });
    }
}
