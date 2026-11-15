"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSuppliers = getSuppliers;
exports.createSupplier = createSupplier;
exports.updateSupplier = updateSupplier;
exports.deleteSupplier = deleteSupplier;
exports.paySupplier = paySupplier;
exports.getSupplierLedger = getSupplierLedger;
exports.getPurchases = getPurchases;
exports.getPurchaseById = getPurchaseById;
exports.createPurchase = createPurchase;
exports.deletePurchase = deletePurchase;
exports.getPurchaseOrders = getPurchaseOrders;
exports.getPurchaseOrderById = getPurchaseOrderById;
exports.createPurchaseOrder = createPurchaseOrder;
exports.receivePurchaseOrder = receivePurchaseOrder;
exports.cancelPurchaseOrder = cancelPurchaseOrder;
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const connection_js_1 = require("../../db/connection.js");
const http_js_1 = require("../../lib/http.js");
const dates_js_1 = require("../../lib/dates.js");
const invoiceService_js_1 = require("../../services/invoiceService.js");
const auditService_js_1 = require("../../services/auditService.js");
const text = (max) => zod_1.z.string().trim().max(max).optional().nullable();
const supplierSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'Supplier name is required').max(150),
    phone: text(20),
    email: zod_1.z.string().trim().max(150).email('Invalid email').optional().nullable().or(zod_1.z.literal('')),
    gstin: zod_1.z.string().trim().toUpperCase().max(15).regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN format').optional().nullable(),
    address: text(500),
    state: text(80),
    openingBalancePaise: zod_1.z.coerce.number().int().optional(),
});
const lineSchema = zod_1.z.object({
    productId: zod_1.z.string().max(64).optional().nullable(),
    productName: zod_1.z.string().trim().min(1).max(200),
    quantity: zod_1.z.coerce.number().positive('Quantity must be greater than zero'),
    unitPricePaise: zod_1.z.coerce.number().int().nonnegative(),
    taxRate: zod_1.z.coerce.number().min(0).max(100).default(0),
});
function computeLines(lines) {
    let subtotal = 0;
    let tax = 0;
    const items = lines.map((it) => {
        const lineSubtotal = Math.round(it.quantity * it.unitPricePaise);
        const lineTax = Math.round((lineSubtotal * it.taxRate) / 100);
        subtotal += lineSubtotal;
        tax += lineTax;
        return { ...it, id: crypto_1.default.randomUUID(), taxPaise: lineTax, totalPaise: lineSubtotal + lineTax };
    });
    return { items, subtotal, tax, total: subtotal + tax };
}
// ---------------- Suppliers ----------------
function getSuppliers(req, res) {
    const includeInactive = req.query.includeInactive === 'true';
    const suppliers = connection_js_1.db.prepare(`SELECT * FROM suppliers WHERE business_id = ? ${includeInactive ? '' : 'AND is_active = 1'} ORDER BY name COLLATE NOCASE ASC`)
        .all(req.businessId);
    res.json({ data: suppliers });
}
function createSupplier(req, res) {
    const s = (0, http_js_1.parse)(supplierSchema, req.body);
    const id = crypto_1.default.randomUUID();
    connection_js_1.db.prepare(`INSERT INTO suppliers (id, business_id, name, phone, email, gstin, address, state, outstanding_balance_paise, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`)
        .run(id, req.businessId, s.name, s.phone || '', s.email || '', s.gstin || '', s.address || '', s.state || null, s.openingBalancePaise || 0);
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'SUPPLIER_CREATED', entityType: 'SUPPLIER', entityId: id, details: { name: s.name } });
    res.status(201).json({ message: 'Supplier added successfully', supplier: connection_js_1.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) });
}
function updateSupplier(req, res) {
    const existing = connection_js_1.db.prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!existing)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Supplier not found');
    const s = (0, http_js_1.parse)(supplierSchema.omit({ openingBalancePaise: true }).partial(), req.body);
    const pick = (v, cur) => (v === undefined ? cur : v);
    connection_js_1.db.prepare(`UPDATE suppliers SET name = ?, phone = ?, email = ?, gstin = ?, address = ?, state = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(pick(s.name, existing.name), pick(s.phone, existing.phone) || '', pick(s.email, existing.email) || '', pick(s.gstin, existing.gstin) || '', pick(s.address, existing.address) || '', pick(s.state, existing.state), existing.id);
    res.json({ message: 'Supplier updated', supplier: connection_js_1.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(existing.id) });
}
function deleteSupplier(req, res) {
    const sup = connection_js_1.db.prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!sup)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Supplier not found');
    if (sup.outstanding_balance_paise !== 0)
        throw new http_js_1.HttpError(409, 'HAS_BALANCE', 'Supplier has an outstanding balance. Settle it first.');
    const history = connection_js_1.db.prepare('SELECT (SELECT COUNT(*) FROM purchase_invoices WHERE supplier_id = ?) + (SELECT COUNT(*) FROM payments WHERE supplier_id = ?) AS c')
        .get(sup.id, sup.id).c;
    if (history > 0) {
        connection_js_1.db.prepare("UPDATE suppliers SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(sup.id);
        res.json({ message: 'Supplier has purchase history and was deactivated instead of deleted', deactivated: true });
        return;
    }
    connection_js_1.db.prepare('DELETE FROM suppliers WHERE id = ?').run(sup.id);
    res.json({ message: 'Supplier deleted', deleted: true });
}
const supplierPaymentSchema = zod_1.z.object({
    amountPaise: zod_1.z.coerce.number().int().positive(),
    mode: zod_1.z.enum(invoiceService_js_1.PAYMENT_MODES),
    purchaseId: zod_1.z.string().max(64).optional().nullable(),
    reference: text(100),
    paymentDate: zod_1.z.string().regex(dates_js_1.DATE_RE).optional(),
    notes: text(300),
});
/** Pay a supplier, optionally against a specific purchase bill; otherwise oldest unpaid bills are settled first. */
function paySupplier(req, res) {
    const input = (0, http_js_1.parse)(supplierPaymentSchema, req.body);
    const allocations = [];
    connection_js_1.db.transaction(() => {
        const sup = connection_js_1.db.prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
        if (!sup)
            throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Supplier not found');
        const bills = input.purchaseId
            ? connection_js_1.db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND supplier_id = ? AND business_id = ?').all(input.purchaseId, sup.id, req.businessId)
            : connection_js_1.db.prepare(`SELECT * FROM purchase_invoices WHERE supplier_id = ? AND business_id = ? AND amount_paid_paise < total_paise
                    ORDER BY invoice_date ASC, created_at ASC`).all(sup.id, req.businessId);
        if (input.purchaseId && bills.length === 0)
            throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Purchase bill not found for this supplier');
        if (input.purchaseId && input.amountPaise > bills[0].total_paise - bills[0].amount_paid_paise) {
            throw new http_js_1.HttpError(400, 'OVERPAYMENT', 'Amount exceeds the balance on this bill');
        }
        let remaining = input.amountPaise;
        const insert = connection_js_1.db.prepare(`INSERT INTO payments (id, business_id, supplier_id, purchase_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OUT', ?, 'ACTIVE', ?)`);
        for (const b of bills) {
            if (remaining <= 0)
                break;
            const portion = Math.min(remaining, b.total_paise - b.amount_paid_paise);
            if (portion <= 0)
                continue;
            const paid = b.amount_paid_paise + portion;
            connection_js_1.db.prepare('UPDATE purchase_invoices SET amount_paid_paise = ?, payment_status = ? WHERE id = ?')
                .run(paid, paid >= b.total_paise ? 'PAID' : 'PARTIAL', b.id);
            insert.run(crypto_1.default.randomUUID(), req.businessId, sup.id, b.id, portion, input.mode, input.reference || b.purchase_number, input.notes || `Payment for ${b.purchase_number}`, input.paymentDate || (0, dates_js_1.localDate)(), req.user?.userId || null);
            allocations.push({ purchaseNumber: b.purchase_number, amountPaise: portion });
            remaining -= portion;
        }
        if (remaining > 0) {
            insert.run(crypto_1.default.randomUUID(), req.businessId, sup.id, null, remaining, input.mode, input.reference || null, input.notes || 'Advance / on-account payment to supplier', input.paymentDate || (0, dates_js_1.localDate)(), req.user?.userId || null);
        }
        connection_js_1.db.prepare("UPDATE suppliers SET outstanding_balance_paise = outstanding_balance_paise - ?, updated_at = datetime('now') WHERE id = ?")
            .run(input.amountPaise, sup.id);
    })();
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'SUPPLIER_PAYMENT', entityType: 'SUPPLIER', entityId: req.params.id,
        details: { amountPaise: input.amountPaise, mode: input.mode, allocations } });
    res.status(201).json({ message: 'Supplier payment recorded', allocations, supplier: connection_js_1.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id) });
}
function getSupplierLedger(req, res) {
    const sup = connection_js_1.db.prepare('SELECT * FROM suppliers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!sup)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Supplier not found');
    const entries = connection_js_1.db.prepare(`
    SELECT invoice_date AS date, created_at, 'PURCHASE' AS type, purchase_number AS reference, 0 AS debit, total_paise AS credit, 'Purchase bill' AS description
      FROM purchase_invoices WHERE supplier_id = ? AND business_id = ?
    UNION ALL
    SELECT payment_date, created_at, 'PAYMENT', reference_number, amount_paise, 0, payment_mode || COALESCE(' — ' || notes, '')
      FROM payments WHERE supplier_id = ? AND business_id = ? AND direction = 'OUT' AND status = 'ACTIVE'
    UNION ALL
    SELECT return_date, created_at, 'DEBIT_NOTE', debit_note_number, total_paise, 0, 'Purchase return (' || refund_mode || ')'
      FROM debit_notes WHERE supplier_id = ? AND business_id = ? AND refund_mode = 'ADJUST_PAYABLE'
    ORDER BY 1 ASC, 2 ASC`).all(sup.id, req.businessId, sup.id, req.businessId, sup.id, req.businessId);
    let running = 0;
    // Positive balance = amount we owe the supplier.
    const ledger = entries.map((e) => { running += e.credit - e.debit; return { ...e, balance: running }; });
    res.json({ supplier: sup, entries: ledger, closingBalancePaise: running, recordedOutstandingPaise: sup.outstanding_balance_paise });
}
// ---------------- Purchase bills ----------------
const purchaseSchema = zod_1.z.object({
    supplierId: zod_1.z.string().max(64).optional().nullable(),
    supplierName: zod_1.z.string().trim().min(1, 'Supplier name is required').max(150),
    purchaseNumber: zod_1.z.string().trim().min(1, 'Supplier bill number is required').max(64),
    invoiceDate: zod_1.z.string().regex(dates_js_1.DATE_RE).optional(),
    items: zod_1.z.array(lineSchema).min(1, 'Add at least one item').max(500),
    amountPaidPaise: zod_1.z.coerce.number().int().nonnegative().default(0),
    paymentMode: zod_1.z.enum(invoiceService_js_1.PAYMENT_MODES).default('CASH'),
    notes: text(1000),
    purchaseOrderId: zod_1.z.string().max(64).optional().nullable(),
});
function getPurchases(req, res) {
    const { supplierId, fromDate, toDate, paymentStatus } = req.query;
    const cond = ['business_id = ?'];
    const params = [req.businessId];
    if (supplierId) {
        cond.push('supplier_id = ?');
        params.push(supplierId);
    }
    if (fromDate) {
        cond.push('invoice_date >= ?');
        params.push(fromDate);
    }
    if (toDate) {
        cond.push('invoice_date <= ?');
        params.push(toDate);
    }
    if (paymentStatus) {
        cond.push('payment_status = ?');
        params.push(paymentStatus);
    }
    const purchases = connection_js_1.db.prepare(`SELECT * FROM purchase_invoices WHERE ${cond.join(' AND ')} ORDER BY invoice_date DESC, created_at DESC`).all(...params);
    res.json({ data: purchases });
}
function getPurchaseById(req, res) {
    const purchase = connection_js_1.db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!purchase)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Purchase not found');
    const items = connection_js_1.db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(req.params.id);
    const payments = connection_js_1.db.prepare("SELECT * FROM payments WHERE purchase_id = ? AND status = 'ACTIVE' ORDER BY payment_date").all(req.params.id);
    res.json({ purchase, items, payments });
}
function recordPurchase(businessId, userId, input) {
    if (input.supplierId) {
        const sup = connection_js_1.db.prepare('SELECT id FROM suppliers WHERE id = ? AND business_id = ?').get(input.supplierId, businessId);
        if (!sup)
            throw new http_js_1.HttpError(400, 'SUPPLIER_NOT_FOUND', 'Selected supplier does not exist');
        const dup = connection_js_1.db.prepare('SELECT id FROM purchase_invoices WHERE business_id = ? AND supplier_id = ? AND purchase_number = ?')
            .get(businessId, input.supplierId, input.purchaseNumber);
        if (dup)
            throw new http_js_1.HttpError(409, 'DUPLICATE_PURCHASE', 'This supplier bill number has already been recorded');
    }
    const { items, subtotal, tax, total } = computeLines(input.items);
    const paid = input.amountPaidPaise;
    if (paid > total)
        throw new http_js_1.HttpError(400, 'OVERPAYMENT', 'Amount paid exceeds the bill total');
    if (paid < total && !input.supplierId)
        throw new http_js_1.HttpError(400, 'SUPPLIER_REQUIRED', 'Select a saved supplier for unpaid or partly paid bills');
    const status = paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
    const id = crypto_1.default.randomUUID();
    const date = input.invoiceDate || (0, dates_js_1.localDate)();
    connection_js_1.db.prepare(`INSERT INTO purchase_invoices (id, business_id, supplier_id, supplier_name, purchase_number, invoice_date, subtotal_paise, tax_paise,
                total_paise, payment_status, amount_paid_paise, notes, purchase_order_id, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
        .run(id, businessId, input.supplierId || null, input.supplierName, input.purchaseNumber, date, subtotal, tax, total, status, paid, input.notes || '', input.purchaseOrderId || null);
    const insertItem = connection_js_1.db.prepare(`INSERT INTO purchase_items (id, business_id, purchase_id, product_id, product_name, quantity, unit_price_paise, tax_rate, tax_paise, total_paise)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const it of items) {
        let productId = it.productId || null;
        if (productId && !connection_js_1.db.prepare('SELECT 1 FROM products WHERE id = ? AND business_id = ?').get(productId, businessId))
            productId = null;
        insertItem.run(it.id, businessId, id, productId, it.productName, it.quantity, it.unitPricePaise, it.taxRate, it.taxPaise, it.totalPaise);
        if (productId) {
            connection_js_1.db.prepare("UPDATE products SET stock_quantity = stock_quantity + ?, purchase_price_paise = ?, updated_at = datetime('now') WHERE id = ?")
                .run(it.quantity, it.unitPricePaise, productId);
            connection_js_1.db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                  VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'PURCHASE', ?, ?)`)
                .run(crypto_1.default.randomUUID(), businessId, productId, it.quantity, productId, id, `Purchase from ${input.supplierName} (${input.purchaseNumber})`);
        }
    }
    if (paid > 0) {
        connection_js_1.db.prepare(`INSERT INTO payments (id, business_id, supplier_id, purchase_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OUT', ?, 'ACTIVE', ?)`)
            .run(crypto_1.default.randomUUID(), businessId, input.supplierId || null, id, paid, input.paymentMode, input.purchaseNumber, `Payment for purchase ${input.purchaseNumber}`, date, userId);
    }
    if (input.supplierId && total > paid) {
        connection_js_1.db.prepare("UPDATE suppliers SET outstanding_balance_paise = outstanding_balance_paise + ?, updated_at = datetime('now') WHERE id = ?")
            .run(total - paid, input.supplierId);
    }
    return { id, total };
}
function createPurchase(req, res) {
    const input = (0, http_js_1.parse)(purchaseSchema, req.body);
    const result = connection_js_1.db.transaction(() => recordPurchase(req.businessId, req.user?.userId || null, input))();
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'PURCHASE_RECORDED', entityType: 'PURCHASE', entityId: result.id,
        details: { supplier: input.supplierName, number: input.purchaseNumber, totalPaise: result.total } });
    res.status(201).json({ message: 'Purchase recorded and stock updated successfully', purchaseId: result.id });
}
/** Delete a purchase bill: reverse stock, undo supplier dues, remove payment rows. */
function deletePurchase(req, res) {
    const businessId = req.businessId;
    const purchase = connection_js_1.db.prepare('SELECT * FROM purchase_invoices WHERE id = ? AND business_id = ?').get(req.params.id, businessId);
    if (!purchase)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Purchase not found');
    const returns = connection_js_1.db.prepare('SELECT COUNT(*) AS c FROM debit_notes WHERE purchase_id = ? AND business_id = ?').get(purchase.id, businessId);
    if (returns.c > 0)
        throw new http_js_1.HttpError(409, 'HAS_RETURNS', 'This purchase has returns recorded. Remove those first.');
    connection_js_1.db.transaction(() => {
        const items = connection_js_1.db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? AND business_id = ?').all(purchase.id, businessId);
        for (const it of items) {
            if (!it.product_id)
                continue;
            connection_js_1.db.prepare("UPDATE products SET stock_quantity = stock_quantity - ?, updated_at = datetime('now') WHERE id = ?")
                .run(it.quantity, it.product_id);
            connection_js_1.db.prepare(`INSERT INTO stock_movements (id, business_id, product_id, change_quantity, resulting_quantity, movement_type, reference_id, notes)
                  VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM products WHERE id = ?), 'PURCHASE_DELETE', ?, ?)`)
                .run(crypto_1.default.randomUUID(), businessId, it.product_id, -it.quantity, it.product_id, purchase.id, `Deleted purchase ${purchase.purchase_number}`);
        }
        if (purchase.supplier_id) {
            const unpaid = purchase.total_paise - purchase.amount_paid_paise;
            if (unpaid > 0) {
                connection_js_1.db.prepare("UPDATE suppliers SET outstanding_balance_paise = outstanding_balance_paise - ?, updated_at = datetime('now') WHERE id = ?")
                    .run(unpaid, purchase.supplier_id);
            }
        }
        connection_js_1.db.prepare("DELETE FROM payments WHERE purchase_id = ? AND business_id = ?").run(purchase.id, businessId);
        connection_js_1.db.prepare('DELETE FROM purchase_invoices WHERE id = ? AND business_id = ?').run(purchase.id, businessId);
    })();
    (0, auditService_js_1.logAudit)({ businessId, userId: req.user?.userId, action: 'PURCHASE_DELETED', entityType: 'PURCHASE', entityId: purchase.id,
        details: { number: purchase.purchase_number, supplier: purchase.supplier_name, totalPaise: purchase.total_paise } });
    res.json({ message: `Purchase ${purchase.purchase_number} deleted`, id: purchase.id });
}
// ---------------- Purchase orders ----------------
const poSchema = zod_1.z.object({
    supplierId: zod_1.z.string().max(64).optional().nullable(),
    supplierName: zod_1.z.string().trim().min(1).max(150),
    expectedDate: zod_1.z.string().regex(dates_js_1.DATE_RE).optional().nullable(),
    items: zod_1.z.array(lineSchema).min(1).max(500),
    notes: text(1000),
});
function getPurchaseOrders(req, res) {
    const status = req.query.status;
    const rows = connection_js_1.db.prepare(`SELECT po.*, (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) AS item_count
                           FROM purchase_orders po WHERE po.business_id = ? ${status ? 'AND po.status = ?' : ''}
                           ORDER BY po.created_at DESC`).all(...(status ? [req.businessId, status] : [req.businessId]));
    res.json({ data: rows });
}
function getPurchaseOrderById(req, res) {
    const po = connection_js_1.db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!po)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Purchase order not found');
    res.json({ order: po, items: connection_js_1.db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(req.params.id) });
}
function createPurchaseOrder(req, res) {
    const input = (0, http_js_1.parse)(poSchema, req.body);
    const { items, subtotal, tax, total } = computeLines(input.items);
    const id = crypto_1.default.randomUUID();
    connection_js_1.db.transaction(() => {
        const count = connection_js_1.db.prepare('SELECT COUNT(*) AS c FROM purchase_orders WHERE business_id = ?').get(req.businessId).c;
        let n = count + 1;
        while (connection_js_1.db.prepare('SELECT 1 FROM purchase_orders WHERE business_id = ? AND po_number = ?').get(req.businessId, `PO-${1000 + n}`))
            n++;
        connection_js_1.db.prepare(`INSERT INTO purchase_orders (id, business_id, po_number, supplier_id, supplier_name, expected_date, subtotal_paise, tax_paise, total_paise, notes, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, req.businessId, `PO-${1000 + n}`, input.supplierId || null, input.supplierName, input.expectedDate || null, subtotal, tax, total, input.notes || '', req.user?.userId || null);
        const ins = connection_js_1.db.prepare(`INSERT INTO purchase_order_items (id, business_id, purchase_order_id, product_id, product_name, quantity, unit_price_paise, tax_rate, tax_paise, total_paise)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const it of items)
            ins.run(it.id, req.businessId, id, it.productId || null, it.productName, it.quantity, it.unitPricePaise, it.taxRate, it.taxPaise, it.totalPaise);
    })();
    res.status(201).json({ message: 'Purchase order created', order: connection_js_1.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) });
}
/** Convert an open purchase order into a received purchase bill (stock in, payable updated). */
function receivePurchaseOrder(req, res) {
    const body = (0, http_js_1.parse)(zod_1.z.object({
        purchaseNumber: zod_1.z.string().trim().min(1).max(64),
        invoiceDate: zod_1.z.string().regex(dates_js_1.DATE_RE).optional(),
        amountPaidPaise: zod_1.z.coerce.number().int().nonnegative().default(0),
        paymentMode: zod_1.z.enum(invoiceService_js_1.PAYMENT_MODES).default('CASH'),
    }), req.body);
    const result = connection_js_1.db.transaction(() => {
        const po = connection_js_1.db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
        if (!po)
            throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Purchase order not found');
        if (po.status !== 'OPEN')
            throw new http_js_1.HttpError(409, 'PO_NOT_OPEN', `Purchase order is ${po.status.toLowerCase()}`);
        const items = connection_js_1.db.prepare('SELECT * FROM purchase_order_items WHERE purchase_order_id = ?').all(po.id);
        const r = recordPurchase(req.businessId, req.user?.userId || null, {
            supplierId: po.supplier_id, supplierName: po.supplier_name, purchaseNumber: body.purchaseNumber, invoiceDate: body.invoiceDate,
            amountPaidPaise: body.amountPaidPaise, paymentMode: body.paymentMode, notes: `Received against ${po.po_number}`, purchaseOrderId: po.id,
            items: items.map((i) => ({ productId: i.product_id, productName: i.product_name, quantity: i.quantity, unitPricePaise: i.unit_price_paise, taxRate: i.tax_rate })),
        });
        connection_js_1.db.prepare("UPDATE purchase_orders SET status = 'RECEIVED', received_purchase_id = ?, updated_at = datetime('now') WHERE id = ?").run(r.id, po.id);
        return r;
    })();
    res.status(201).json({ message: 'Goods received and purchase recorded', purchaseId: result.id });
}
function cancelPurchaseOrder(req, res) {
    const po = connection_js_1.db.prepare('SELECT * FROM purchase_orders WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!po)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Purchase order not found');
    if (po.status !== 'OPEN')
        throw new http_js_1.HttpError(409, 'PO_NOT_OPEN', 'Only open purchase orders can be cancelled');
    connection_js_1.db.prepare("UPDATE purchase_orders SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?").run(po.id);
    res.json({ message: 'Purchase order cancelled' });
}
