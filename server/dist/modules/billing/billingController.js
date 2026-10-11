"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInvoice = createInvoice;
exports.getInvoices = getInvoices;
exports.getInvoiceById = getInvoiceById;
exports.cancelInvoice = cancelInvoice;
const uuid_1 = require("uuid");
const connection_js_1 = require("../../db/connection.js");
function createInvoice(req, res) {
    const businessId = req.businessId;
    if (!businessId) {
        res.status(400).json({ code: 'TENANT_REQUIRED', message: 'Tenant context is missing' });
        return;
    }
    const { customerId, customerName = 'Walk-in Customer', customerPhone = '', customerGstin = '', items, billDiscountPaise = 0, paymentMode = 'CASH', amountPaidPaise, notes = '', isInterState = false, } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ code: 'EMPTY_CART', message: 'Invoice must contain at least one item' });
        return;
    }
    // 1. Fetch business invoice prefix & next number
    const business = connection_js_1.db.prepare('SELECT invoice_prefix, next_invoice_number, state FROM businesses WHERE id = ?').get(businessId);
    if (!business) {
        res.status(404).json({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found' });
        return;
    }
    const invoiceNumber = `${business.invoice_prefix}${business.next_invoice_number}`;
    const invoiceId = (0, uuid_1.v4)();
    const todayStr = new Date().toISOString().split('T')[0];
    // 2. Perform calculations
    let subtotalPaise = 0;
    let totalItemDiscountPaise = 0;
    let totalTaxPaise = 0;
    const processedItems = items.map((item) => {
        const qty = Math.max(1, Number(item.quantity) || 1);
        const unitPrice = Math.max(0, Math.round(Number(item.unitPricePaise) || 0));
        const itemDiscount = Math.max(0, Math.round(Number(item.discountPaise) || 0));
        const taxableAmount = Math.max(0, (unitPrice * qty) - itemDiscount);
        const taxRate = Number(item.taxRate) || 0;
        const itemTax = Math.round((taxableAmount * taxRate) / 100);
        const totalItemPaise = taxableAmount + itemTax;
        subtotalPaise += (unitPrice * qty);
        totalItemDiscountPaise += itemDiscount;
        totalTaxPaise += itemTax;
        return {
            id: (0, uuid_1.v4)(),
            productId: item.productId || null,
            productName: item.productName,
            sku: item.sku || '',
            hsnCode: item.hsnCode || '',
            quantity: qty,
            unitPricePaise: unitPrice,
            discountPaise: itemDiscount,
            taxRate,
            taxPaise: itemTax,
            totalPaise: totalItemPaise,
        };
    });
    const totalDiscountPaise = totalItemDiscountPaise + Math.max(0, Math.round(Number(billDiscountPaise) || 0));
    const finalTotalPaise = Math.max(0, (subtotalPaise - totalDiscountPaise) + totalTaxPaise);
    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;
    if (isInterState) {
        igstPaise = totalTaxPaise;
    }
    else {
        cgstPaise = Math.round(totalTaxPaise / 2);
        sgstPaise = totalTaxPaise - cgstPaise;
    }
    const paidAmount = amountPaidPaise !== undefined
        ? Math.min(finalTotalPaise, Math.max(0, Math.round(amountPaidPaise)))
        : (paymentMode === 'CREDIT' ? 0 : finalTotalPaise);
    const paymentStatus = paidAmount >= finalTotalPaise
        ? 'PAID'
        : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID');
    // ATOMIC DATABASE TRANSACTION (PRD §4.2 & §9.4)
    const transaction = connection_js_1.db.transaction(() => {
        // A. Insert Invoice
        connection_js_1.db.prepare(`
      INSERT INTO invoices (
        id, business_id, invoice_number, customer_id, customer_name, customer_phone, customer_gstin,
        invoice_date, subtotal_paise, discount_paise, tax_paise, cgst_paise, sgst_paise, igst_paise,
        total_paise, payment_mode, payment_status, amount_paid_paise, notes, created_by, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', datetime('now'))
    `).run(invoiceId, businessId, invoiceNumber, customerId || null, customerName, customerPhone, customerGstin, todayStr, subtotalPaise, totalDiscountPaise, totalTaxPaise, cgstPaise, sgstPaise, igstPaise, finalTotalPaise, paymentMode, paymentStatus, paidAmount, notes, req.user?.userId || null);
        // B. Insert Line Items & Deduct Stock
        const insertLineItem = connection_js_1.db.prepare(`
      INSERT INTO invoice_items (
        id, business_id, invoice_id, product_id, product_name, sku, hsn_code,
        quantity, unit_price_paise, discount_paise, tax_rate, tax_paise, total_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const updateProductStock = connection_js_1.db.prepare(`
      UPDATE products 
      SET stock_quantity = stock_quantity - ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `);
        const recordStockMovement = connection_js_1.db.prepare(`
      INSERT INTO stock_movements (
        id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at
      ) VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'INVOICE', ?, ?, datetime('now'))
    `);
        for (const item of processedItems) {
            insertLineItem.run(item.id, businessId, invoiceId, item.productId, item.productName, item.sku, item.hsnCode, item.quantity, item.unitPricePaise, item.discountPaise, item.taxRate, item.taxPaise, item.totalPaise);
            if (item.productId) {
                updateProductStock.run(item.quantity, item.productId, businessId);
                recordStockMovement.run((0, uuid_1.v4)(), businessId, item.productId, -item.quantity, item.productId, invoiceId, `Sale Invoice ${invoiceNumber}`);
            }
        }
        // C. Record Payment
        if (paidAmount > 0) {
            connection_js_1.db.prepare(`
        INSERT INTO payments (id, business_id, invoice_id, customer_id, amount_paise, payment_mode, reference_number, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run((0, uuid_1.v4)(), businessId, invoiceId, customerId || null, paidAmount, paymentMode, invoiceNumber, `Payment for ${invoiceNumber}`);
        }
        // D. Update Customer balance if partial or credit sale
        if (customerId && finalTotalPaise > paidAmount) {
            const balanceDue = finalTotalPaise - paidAmount;
            connection_js_1.db.prepare(`
        UPDATE customers 
        SET outstanding_balance_paise = outstanding_balance_paise + ?, updated_at = datetime('now')
        WHERE id = ? AND business_id = ?
      `).run(balanceDue, customerId, businessId);
        }
        // E. Increment next invoice number
        connection_js_1.db.prepare(`
      UPDATE businesses 
      SET next_invoice_number = next_invoice_number + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(businessId);
    });
    try {
        transaction();
        // Fetch the created invoice for client consumption
        const createdInvoice = connection_js_1.db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
        const createdItems = connection_js_1.db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invoiceId);
        res.status(201).json({
            message: 'Invoice created successfully',
            invoice: {
                ...createdInvoice,
                items: createdItems,
            },
        });
    }
    catch (err) {
        console.error('Invoice creation transaction failed:', err);
        res.status(500).json({ code: 'TRANSACTION_FAILED', message: err.message || 'Failed to complete transaction' });
    }
}
function getInvoices(req, res) {
    const businessId = req.businessId;
    const { search, status, fromDate, toDate, limit = 50, page = 1 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const conditions = ['business_id = ?'];
    const params = [businessId];
    if (search) {
        conditions.push('(invoice_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
        conditions.push('status = ?');
        params.push(status);
    }
    if (fromDate) {
        conditions.push('invoice_date >= ?');
        params.push(fromDate);
    }
    if (toDate) {
        conditions.push('invoice_date <= ?');
        params.push(toDate);
    }
    const whereClause = conditions.join(' AND ');
    const totalCount = connection_js_1.db.prepare(`SELECT COUNT(*) as count FROM invoices WHERE ${whereClause}`).get(...params);
    const invoices = connection_js_1.db.prepare(`
    SELECT * FROM invoices 
    WHERE ${whereClause} 
    ORDER BY created_at DESC 
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), offset);
    res.json({
        data: invoices,
        pagination: {
            total: totalCount.count,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(totalCount.count / Number(limit)),
        },
    });
}
function getInvoiceById(req, res) {
    const businessId = req.businessId;
    const { id } = req.params;
    const invoice = connection_js_1.db.prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?').get(id, businessId);
    if (!invoice) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Invoice not found' });
        return;
    }
    const items = connection_js_1.db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? AND business_id = ?').all(id, businessId);
    const business = connection_js_1.db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
    res.json({
        invoice: {
            ...invoice,
            items,
            business,
        },
    });
}
function cancelInvoice(req, res) {
    const businessId = req.businessId;
    const { id } = req.params;
    const invoice = connection_js_1.db.prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?').get(id, businessId);
    if (!invoice) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Invoice not found' });
        return;
    }
    if (invoice.status === 'CANCELLED') {
        res.status(400).json({ code: 'ALREADY_CANCELLED', message: 'Invoice is already cancelled' });
        return;
    }
    const items = connection_js_1.db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? AND business_id = ?').all(id, businessId);
    const transaction = connection_js_1.db.transaction(() => {
        // 1. Mark cancelled
        connection_js_1.db.prepare("UPDATE invoices SET status = 'CANCELLED' WHERE id = ? AND business_id = ?").run(id, businessId);
        // 2. Restore stock for each product
        const restoreStock = connection_js_1.db.prepare(`
      UPDATE products 
      SET stock_quantity = stock_quantity + ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `);
        const logMovement = connection_js_1.db.prepare(`
      INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes, created_at)
      VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'RETURN', ?, ?, datetime('now'))
    `);
        for (const item of items) {
            if (item.product_id) {
                restoreStock.run(item.quantity, item.product_id, businessId);
                logMovement.run((0, uuid_1.v4)(), businessId, item.product_id, item.quantity, item.product_id, id, `Cancelled invoice ${invoice.invoice_number}`);
            }
        }
        // 3. Reverse customer balance if credit
        if (invoice.customer_id && invoice.total_paise > invoice.amount_paid_paise) {
            const balanceToRevert = invoice.total_paise - invoice.amount_paid_paise;
            connection_js_1.db.prepare(`
        UPDATE customers 
        SET outstanding_balance_paise = MAX(0, outstanding_balance_paise - ?), updated_at = datetime('now')
        WHERE id = ? AND business_id = ?
      `).run(balanceToRevert, invoice.customer_id, businessId);
        }
    });
    try {
        transaction();
        res.json({ message: 'Invoice cancelled and stock restored successfully' });
    }
    catch (err) {
        res.status(500).json({ code: 'CANCELLATION_FAILED', message: err.message });
    }
}
