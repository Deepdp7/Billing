"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomers = getCustomers;
exports.createCustomer = createCustomer;
exports.updateCustomer = updateCustomer;
exports.deleteCustomer = deleteCustomer;
exports.getCustomerById = getCustomerById;
exports.getCustomerLedger = getCustomerLedger;
exports.receiveCustomerPayment = receiveCustomerPayment;
exports.refundCustomerAdvance = refundCustomerAdvance;
exports.voidCustomerPayment = voidCustomerPayment;
exports.exportCustomers = exportCustomers;
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const connection_js_1 = require("../../db/connection.js");
const http_js_1 = require("../../lib/http.js");
const dates_js_1 = require("../../lib/dates.js");
const invoiceService_js_1 = require("../../services/invoiceService.js");
const auditService_js_1 = require("../../services/auditService.js");
const exportService_js_1 = require("../../services/exportService.js");
const text = (max) => zod_1.z.string().trim().max(max).optional().nullable();
const customerSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'Customer name is required').max(150),
    phone: zod_1.z.string().trim().max(20).regex(/^[+\d\s-]*$/, 'Phone may contain digits, spaces, + and - only').optional().nullable(),
    email: zod_1.z.string().trim().max(150).email('Invalid email').optional().nullable().or(zod_1.z.literal('')),
    gstin: zod_1.z.string().trim().toUpperCase().max(15)
        .regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'Invalid GSTIN format').optional().nullable(),
    address: text(500),
    billingAddress: text(500),
    shippingAddress: text(500),
    city: text(80),
    state: text(80),
    pincode: text(10),
    notes: text(1000),
    creditLimitPaise: zod_1.z.coerce.number().int().nonnegative().optional(),
    creditDays: zod_1.z.coerce.number().int().min(0).max(365).optional(),
    customerType: zod_1.z.enum(['RETAIL', 'WHOLESALE', 'DISTRIBUTOR']).optional(),
});
function getCustomers(req, res) {
    const { search, includeInactive, withBalance } = req.query;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const conditions = ['business_id = ?'];
    const params = [req.businessId];
    // A customer who owes money, or whose money the shop holds, always shows (even when made inactive)
    if (includeInactive !== 'true')
        conditions.push('(is_active = 1 OR outstanding_balance_paise != 0)');
    if (withBalance === 'true')
        conditions.push('outstanding_balance_paise > 0');
    if (search) {
        conditions.push('(name LIKE ? OR phone LIKE ? OR gstin LIKE ? OR email LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = conditions.join(' AND ');
    const total = connection_js_1.db.prepare(`SELECT COUNT(*) AS c FROM customers WHERE ${where}`).get(...params).c;
    const data = connection_js_1.db.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY name COLLATE NOCASE ASC LIMIT ? OFFSET ?`)
        .all(...params, limit, (page - 1) * limit);
    res.json({ data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } });
}
function createCustomer(req, res) {
    const c = (0, http_js_1.parse)(customerSchema, req.body);
    if (c.phone) {
        const dup = connection_js_1.db.prepare('SELECT id FROM customers WHERE business_id = ? AND phone = ? AND is_active = 1').get(req.businessId, c.phone);
        if (dup)
            throw new http_js_1.HttpError(409, 'DUPLICATE_PHONE', 'A customer with this phone number already exists');
    }
    const id = crypto_1.default.randomUUID();
    const billing = c.billingAddress ?? c.address ?? null;
    connection_js_1.db.prepare(`
    INSERT INTO customers (id, business_id, name, phone, email, gstin, address, billing_address, shipping_address, city, state, pincode, notes,
                           credit_limit_paise, credit_days, customer_type, outstanding_balance_paise, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
  `).run(id, req.businessId, c.name, c.phone || '', c.email || '', c.gstin || '', billing, billing, c.shippingAddress ?? null, c.city ?? null, c.state ?? null, c.pincode ?? null, c.notes ?? null, c.creditLimitPaise ?? 0, c.creditDays ?? 30, c.customerType ?? 'RETAIL');
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'CUSTOMER_CREATED', entityType: 'CUSTOMER', entityId: id, details: { name: c.name } });
    res.status(201).json({ message: 'Customer added successfully', customer: connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ?').get(id) });
}
function updateCustomer(req, res) {
    const existing = connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!existing)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
    const c = (0, http_js_1.parse)(customerSchema.partial(), req.body);
    if (c.phone && c.phone !== existing.phone) {
        const dup = connection_js_1.db.prepare('SELECT id FROM customers WHERE business_id = ? AND phone = ? AND id != ? AND is_active = 1').get(req.businessId, c.phone, existing.id);
        if (dup)
            throw new http_js_1.HttpError(409, 'DUPLICATE_PHONE', 'Another customer already uses this phone number');
    }
    const pick = (v, cur) => (v === undefined ? cur : v);
    const billing = c.billingAddress !== undefined ? c.billingAddress : c.address !== undefined ? c.address : existing.billing_address;
    connection_js_1.db.prepare(`
    UPDATE customers SET name = ?, phone = ?, email = ?, gstin = ?, address = ?, billing_address = ?, shipping_address = ?, city = ?, state = ?,
      pincode = ?, notes = ?, credit_limit_paise = ?, credit_days = ?, customer_type = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(pick(c.name, existing.name), pick(c.phone, existing.phone) || '', pick(c.email, existing.email) || '', pick(c.gstin, existing.gstin) || '', billing, billing, pick(c.shippingAddress, existing.shipping_address), pick(c.city, existing.city), pick(c.state, existing.state), pick(c.pincode, existing.pincode), pick(c.notes, existing.notes), pick(c.creditLimitPaise, existing.credit_limit_paise), pick(c.creditDays, existing.credit_days), pick(c.customerType, existing.customer_type), existing.id);
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'CUSTOMER_UPDATED', entityType: 'CUSTOMER', entityId: existing.id, details: { fields: Object.keys(c) } });
    res.json({ message: 'Customer updated', customer: connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ?').get(existing.id) });
}
/**
 * Customers with no transactions are deleted. Customers with history cannot be deleted (their invoices are
 * legal records); pass `?mode=deactivate` to hide them instead. A non-zero balance blocks both.
 */
function deleteCustomer(req, res) {
    const cust = connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!cust)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
    if (cust.outstanding_balance_paise !== 0) {
        const amount = `₹${(Math.abs(cust.outstanding_balance_paise) / 100).toFixed(2)}`;
        throw new http_js_1.HttpError(409, 'HAS_BALANCE', cust.outstanding_balance_paise > 0
            ? `${cust.name} still owes you ${amount}. Receive the payment first (₹ button), then delete.`
            : `You hold ${amount} of ${cust.name}'s money as advance. Return it first (₹ button), then delete.`);
    }
    const history = connection_js_1.db.prepare(`SELECT
      (SELECT COUNT(*) FROM invoices WHERE business_id = ? AND customer_id = ?) +
      (SELECT COUNT(*) FROM payments WHERE business_id = ? AND customer_id = ?) +
      (SELECT COUNT(*) FROM credit_notes WHERE business_id = ? AND customer_id = ?) AS c`)
        .get(cust.business_id, cust.id, cust.business_id, cust.id, cust.business_id, cust.id).c;
    if (history > 0) {
        if (req.query.mode !== 'deactivate') {
            throw new http_js_1.HttpError(409, 'HAS_HISTORY', 'Customer has invoices or payments and cannot be deleted. Deactivate the customer instead.');
        }
        connection_js_1.db.prepare("UPDATE customers SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(cust.id);
        (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'CUSTOMER_DEACTIVATED', entityType: 'CUSTOMER', entityId: cust.id, details: { name: cust.name } });
        res.json({ message: 'Customer deactivated', deactivated: true });
        return;
    }
    connection_js_1.db.prepare('DELETE FROM customers WHERE id = ?').run(cust.id);
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId: req.user?.userId, action: 'CUSTOMER_DELETED', entityType: 'CUSTOMER', entityId: cust.id, details: { name: cust.name } });
    res.json({ message: 'Customer deleted', deleted: true });
}
function getCustomerById(req, res) {
    const customer = connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!customer)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
    const invoices = connection_js_1.db.prepare(`SELECT * FROM invoices WHERE customer_id = ? AND business_id = ? AND status != 'DRAFT'
                               ORDER BY invoice_date DESC, created_at DESC LIMIT 100`).all(customer.id, req.businessId);
    const payments = connection_js_1.db.prepare(`SELECT p.*, i.invoice_number FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
                               WHERE p.customer_id = ? AND p.business_id = ? AND p.status = 'ACTIVE'
                               ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 100`).all(customer.id, req.businessId);
    const summary = connection_js_1.db.prepare(`SELECT COUNT(*) AS invoice_count, COALESCE(SUM(total_paise), 0) AS total_billed_paise,
                                     COALESCE(SUM(amount_paid_paise), 0) AS total_paid_paise, MAX(invoice_date) AS last_purchase_date
                              FROM invoices WHERE customer_id = ? AND business_id = ? AND status = 'ISSUED'`).get(customer.id, req.businessId);
    res.json({ customer, invoices, payments, summary });
}
/** Chronological debit/credit ledger with running balance. */
function getCustomerLedger(req, res) {
    const customer = connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!customer)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
    const id = customer.id;
    const biz = req.businessId;
    const entries = connection_js_1.db.prepare(`
    SELECT invoice_date AS date, created_at, 'INVOICE' AS type, invoice_number AS reference, total_paise AS debit, 0 AS credit,
           'Sale invoice' AS description, NULL AS payment_id
      FROM invoices WHERE customer_id = ? AND business_id = ? AND status IN ('ISSUED', 'CANCELLED')
    UNION ALL
    SELECT date(cancelled_at) AS date, cancelled_at, 'CANCELLATION', invoice_number, 0, total_paise, 'Invoice cancelled: ' || COALESCE(cancel_reason, ''), NULL
      FROM invoices WHERE customer_id = ? AND business_id = ? AND status = 'CANCELLED'
    UNION ALL
    SELECT p.payment_date, p.created_at, CASE p.direction WHEN 'IN' THEN 'PAYMENT' ELSE 'REFUND' END,
           COALESCE(i.invoice_number, p.reference_number),
           CASE p.direction WHEN 'OUT' THEN p.amount_paise ELSE 0 END,
           CASE p.direction WHEN 'IN' THEN p.amount_paise ELSE 0 END,
           p.payment_mode || COALESCE(' — ' || p.notes, ''), CASE p.direction WHEN 'IN' THEN p.id END
      FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
      WHERE p.customer_id = ? AND p.business_id = ? AND p.status = 'ACTIVE'
    UNION ALL
    SELECT return_date, created_at, 'CREDIT_NOTE', credit_note_number, 0, total_refund_paise, 'Sales return (' || refund_mode || ')', NULL
      FROM credit_notes WHERE customer_id = ? AND business_id = ?
    UNION ALL
    SELECT date(created_at), created_at, 'ADJUSTMENT', reference_no, debit_paise, credit_paise, COALESCE(notes, entry_type), NULL
      FROM party_ledger_entries WHERE customer_id = ? AND business_id = ?
    ORDER BY 1 ASC, 2 ASC
  `).all(id, biz, id, biz, id, biz, id, biz, id, biz);
    let running = 0;
    const ledger = entries.map((e) => {
        running += e.debit - e.credit;
        return { ...e, balance: running };
    });
    res.json({
        customer: { id: customer.id, name: customer.name, phone: customer.phone, gstin: customer.gstin },
        entries: ledger,
        closingBalancePaise: running,
        recordedOutstandingPaise: customer.outstanding_balance_paise,
    });
}
const accountPaymentSchema = zod_1.z.object({
    amountPaise: zod_1.z.coerce.number().int().positive('Amount must be greater than zero'),
    mode: zod_1.z.enum(invoiceService_js_1.PAYMENT_MODES),
    reference: zod_1.z.string().trim().max(100).optional().nullable(),
    paymentDate: zod_1.z.string().regex(dates_js_1.DATE_RE).optional(),
    notes: zod_1.z.string().trim().max(300).optional().nullable(),
});
/** Receive a payment from a customer and settle their oldest unpaid invoices first (FIFO). Any excess becomes an advance. */
function receiveCustomerPayment(req, res) {
    const input = (0, http_js_1.parse)(accountPaymentSchema, req.body);
    const userId = req.user?.userId || null;
    const allocations = [];
    let advance = 0;
    connection_js_1.db.transaction(() => {
        const customer = connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
        if (!customer)
            throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
        const unpaid = connection_js_1.db.prepare(`SELECT * FROM invoices WHERE customer_id = ? AND business_id = ? AND status = 'ISSUED'
                               AND amount_paid_paise < total_paise ORDER BY invoice_date ASC, created_at ASC`).all(customer.id, req.businessId);
        let remaining = input.amountPaise;
        for (const inv of unpaid) {
            if (remaining <= 0)
                break;
            const portion = Math.min(remaining, inv.total_paise - inv.amount_paid_paise);
            (0, invoiceService_js_1.applyInvoicePayment)(req.businessId, userId, inv, portion, input.mode, input.reference, input.paymentDate, input.notes);
            allocations.push({ invoiceNumber: inv.invoice_number, amountPaise: portion });
            remaining -= portion;
        }
        if (remaining > 0) {
            advance = remaining;
            connection_js_1.db.prepare(`INSERT INTO payments (id, business_id, invoice_id, customer_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by, created_at)
                  VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'IN', ?, 'ACTIVE', ?, datetime('now'))`)
                .run(crypto_1.default.randomUUID(), req.businessId, customer.id, remaining, input.mode, input.reference || null, input.notes || 'Advance / on-account payment', input.paymentDate || (0, dates_js_1.localDate)(), userId);
            connection_js_1.db.prepare("UPDATE customers SET outstanding_balance_paise = outstanding_balance_paise - ?, updated_at = datetime('now') WHERE id = ?")
                .run(remaining, customer.id);
        }
    })();
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId, action: 'CUSTOMER_PAYMENT', entityType: 'CUSTOMER', entityId: req.params.id,
        details: { amountPaise: input.amountPaise, mode: input.mode, allocations, advancePaise: advance } });
    const customer = connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    res.status(201).json({ message: 'Payment recorded', allocations, advancePaise: advance, customer });
}
/** Give back a customer's advance (money they paid that no bill uses): a refund paid out, which settles the account. */
function refundCustomerAdvance(req, res) {
    const input = (0, http_js_1.parse)(accountPaymentSchema, req.body);
    const userId = req.user?.userId || null;
    connection_js_1.db.transaction(() => {
        const customer = connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
        if (!customer)
            throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
        const advance = -customer.outstanding_balance_paise;
        if (advance <= 0)
            throw new http_js_1.HttpError(400, 'NO_ADVANCE', `${customer.name} has no advance to return`);
        if (input.amountPaise > advance) {
            throw new http_js_1.HttpError(400, 'MORE_THAN_ADVANCE', `You can return at most ₹${(advance / 100).toFixed(2)}, the advance ${customer.name} has with you`);
        }
        connection_js_1.db.prepare(`INSERT INTO payments (id, business_id, invoice_id, customer_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_by, created_at)
                VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'OUT', ?, 'ACTIVE', ?, datetime('now'))`)
            .run(crypto_1.default.randomUUID(), req.businessId, customer.id, input.amountPaise, input.mode, input.reference || null, input.notes || 'Advance returned to customer', input.paymentDate || (0, dates_js_1.localDate)(), userId);
        connection_js_1.db.prepare("UPDATE customers SET outstanding_balance_paise = outstanding_balance_paise + ?, updated_at = datetime('now') WHERE id = ?")
            .run(input.amountPaise, customer.id);
    })();
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId, action: 'CUSTOMER_ADVANCE_REFUNDED', entityType: 'CUSTOMER', entityId: req.params.id,
        details: { amountPaise: input.amountPaise, mode: input.mode } });
    res.status(201).json({ message: 'Advance returned', customer: connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) });
}
/**
 * Undo a payment entered by mistake: it is cancelled (kept on record, out of every total) and the balance goes back.
 * A payment on a bill makes that bill owe it again; an advance can be undone only while the shop still holds it.
 */
function voidCustomerPayment(req, res) {
    const userId = req.user?.userId || null;
    const payment = connection_js_1.db.transaction(() => {
        const customer = connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
        if (!customer)
            throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Customer not found');
        const p = connection_js_1.db.prepare("SELECT * FROM payments WHERE id = ? AND customer_id = ? AND business_id = ? AND direction = 'IN'")
            .get(req.params.paymentId, customer.id, req.businessId);
        if (!p)
            throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Payment not found');
        if (p.status !== 'ACTIVE')
            throw new http_js_1.HttpError(409, 'ALREADY_UNDONE', 'This payment was already undone');
        if (p.invoice_id) {
            const inv = connection_js_1.db.prepare('SELECT * FROM invoices WHERE id = ? AND business_id = ?').get(p.invoice_id, req.businessId);
            if (inv?.status === 'CANCELLED')
                throw new http_js_1.HttpError(409, 'BILL_CANCELLED', 'The bill was cancelled; its payment was settled then');
            if (inv) {
                const paid = Math.max(0, inv.amount_paid_paise - p.amount_paise);
                connection_js_1.db.prepare("UPDATE invoices SET amount_paid_paise = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?")
                    .run(paid, paid >= inv.total_paise ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID', inv.id);
            }
        }
        else if (p.amount_paise > -customer.outstanding_balance_paise) {
            throw new http_js_1.HttpError(409, 'ADVANCE_USED', `Only ₹${(Math.max(0, -customer.outstanding_balance_paise) / 100).toFixed(2)} of this advance is still unused; the rest already paid bills`);
        }
        connection_js_1.db.prepare("UPDATE payments SET status = 'VOID', notes = COALESCE(notes, '') || ' (undone)' WHERE id = ?").run(p.id);
        connection_js_1.db.prepare("UPDATE customers SET outstanding_balance_paise = outstanding_balance_paise + ?, updated_at = datetime('now') WHERE id = ?")
            .run(p.amount_paise, customer.id);
        return p;
    })();
    (0, auditService_js_1.logAudit)({ businessId: req.businessId, userId, action: 'CUSTOMER_PAYMENT_UNDONE', entityType: 'CUSTOMER', entityId: req.params.id,
        details: { paymentId: payment.id, amountPaise: payment.amount_paise, mode: payment.payment_mode } });
    res.json({ message: 'Payment undone', customer: connection_js_1.db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id) });
}
function exportCustomers(req, res) {
    const rows = connection_js_1.db.prepare(`SELECT name, phone, email, gstin, billing_address, shipping_address, city, state, pincode, customer_type,
                                  credit_limit_paise, credit_days, outstanding_balance_paise, loyalty_points, is_active, created_at
                           FROM customers WHERE business_id = ? ORDER BY name COLLATE NOCASE`).all(req.businessId);
    (0, exportService_js_1.sendTable)(res, req.query.format || 'csv', 'customers', [
        { key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'gstin', label: 'GSTIN' },
        { key: 'billing_address', label: 'Billing Address' }, { key: 'shipping_address', label: 'Shipping Address' },
        { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'pincode', label: 'Pincode' }, { key: 'customer_type', label: 'Type' },
        { key: 'credit_limit_paise', label: 'Credit Limit (₹)', money: true }, { key: 'credit_days', label: 'Credit Days' },
        { key: 'outstanding_balance_paise', label: 'Outstanding (₹)', money: true }, { key: 'loyalty_points', label: 'Loyalty Points' },
        { key: 'is_active', label: 'Active' }, { key: 'created_at', label: 'Created' },
    ], rows);
}
