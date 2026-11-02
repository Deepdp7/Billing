"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInvoice = createInvoice;
exports.getInvoices = getInvoices;
exports.getInvoiceById = getInvoiceById;
exports.cancelInvoice = cancelInvoice;
exports.recordPayment = recordPayment;
exports.updateDraft = updateDraft;
exports.issueDraft = issueDraft;
exports.deleteDraft = deleteDraft;
exports.duplicateInvoice = duplicateInvoice;
exports.getPayments = getPayments;
exports.getHeldBills = getHeldBills;
exports.holdBill = holdBill;
exports.deleteHeldBill = deleteHeldBill;
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const connection_js_1 = require("../../db/connection.js");
const http_js_1 = require("../../lib/http.js");
const invoiceService = __importStar(require("../../services/invoiceService.js"));
const uid = (req) => req.user?.userId || null;
/** POST /billing/checkout — create an issued invoice (or a draft with `status: "DRAFT"`). Idempotent on clientRequestId. */
function createInvoice(req, res) {
    const { invoice, duplicate } = invoiceService.createInvoice(req.businessId, uid(req), req.body);
    res.status(duplicate ? 200 : 201).json({
        message: duplicate ? 'Invoice already saved (duplicate submission ignored)' : invoice.status === 'DRAFT' ? 'Draft saved' : 'Invoice created successfully',
        duplicate,
        invoice,
    });
}
function getInvoices(req, res) {
    res.json(invoiceService.listInvoices(req.businessId, req.query));
}
function getInvoiceById(req, res) {
    res.json({ invoice: invoiceService.getInvoiceFull(req.businessId, req.params.id) });
}
function cancelInvoice(req, res) {
    const invoice = invoiceService.cancelInvoice(req.businessId, uid(req), req.params.id, req.body);
    res.json({ message: 'Invoice cancelled, stock restored and payments reversed', invoice });
}
function recordPayment(req, res) {
    const invoice = invoiceService.recordInvoicePayment(req.businessId, uid(req), req.params.id, req.body);
    res.status(201).json({ message: 'Payment recorded', invoice });
}
function updateDraft(req, res) {
    res.json({ message: 'Draft updated', invoice: invoiceService.updateDraft(req.businessId, uid(req), req.params.id, req.body) });
}
function issueDraft(req, res) {
    res.status(201).json({ message: 'Invoice issued', invoice: invoiceService.issueDraft(req.businessId, uid(req), req.params.id, req.body) });
}
function deleteDraft(req, res) {
    invoiceService.deleteDraft(req.businessId, uid(req), req.params.id);
    res.json({ message: 'Draft deleted' });
}
function duplicateInvoice(req, res) {
    res.status(201).json({ message: 'Draft copy created', invoice: invoiceService.duplicateInvoice(req.businessId, uid(req), req.params.id) });
}
function getPayments(req, res) {
    const { fromDate, toDate, mode, direction, customerId } = req.query;
    const limit = Math.min(500, Number(req.query.limit) || 100);
    const cond = ['p.business_id = ?', "p.status = 'ACTIVE'"];
    const params = [req.businessId];
    if (fromDate) {
        cond.push('p.payment_date >= ?');
        params.push(fromDate);
    }
    if (toDate) {
        cond.push('p.payment_date <= ?');
        params.push(toDate);
    }
    if (mode) {
        cond.push('p.payment_mode = ?');
        params.push(mode);
    }
    if (direction) {
        cond.push('p.direction = ?');
        params.push(direction);
    }
    if (customerId) {
        cond.push('p.customer_id = ?');
        params.push(customerId);
    }
    const rows = connection_js_1.db.prepare(`
    SELECT p.*, i.invoice_number, c.name AS customer_name, s.name AS supplier_name
    FROM payments p
    LEFT JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE ${cond.join(' AND ')}
    ORDER BY p.payment_date DESC, p.created_at DESC LIMIT ?`).all(...params, limit);
    res.json({ data: rows });
}
// ---------------- Held (parked) bills ----------------
const holdSchema = zod_1.z.object({
    label: zod_1.z.string().trim().max(80).optional().nullable(),
    customerName: zod_1.z.string().trim().max(150).optional().nullable(),
    payload: zod_1.z.record(zod_1.z.any()),
});
function getHeldBills(req, res) {
    const rows = connection_js_1.db.prepare('SELECT * FROM held_bills WHERE business_id = ? ORDER BY created_at ASC').all(req.businessId);
    res.json({ data: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json), payload_json: undefined })) });
}
function holdBill(req, res) {
    const input = (0, http_js_1.parse)(holdSchema, req.body);
    const count = connection_js_1.db.prepare('SELECT COUNT(*) AS c FROM held_bills WHERE business_id = ?').get(req.businessId).c;
    if (count >= 50)
        throw new http_js_1.HttpError(409, 'TOO_MANY_HELD', 'Too many held bills. Resume or discard some first.');
    const id = crypto_1.default.randomUUID();
    connection_js_1.db.prepare('INSERT INTO held_bills (id, business_id, label, customer_name, payload_json, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, req.businessId, input.label || null, input.customerName || null, JSON.stringify(input.payload), uid(req));
    res.status(201).json({ id });
}
function deleteHeldBill(req, res) {
    connection_js_1.db.prepare('DELETE FROM held_bills WHERE id = ? AND business_id = ?').run(req.params.id, req.businessId);
    res.json({ message: 'Held bill removed' });
}
