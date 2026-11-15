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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuotations = getQuotations;
exports.createQuotation = createQuotation;
exports.deleteQuotation = deleteQuotation;
exports.convertToInvoice = convertToInvoice;
const uuid_1 = require("uuid");
const zod_1 = require("zod");
const connection_js_1 = require("../../db/connection.js");
const http_js_1 = require("../../lib/http.js");
const dates_js_1 = require("../../lib/dates.js");
const invoiceService = __importStar(require("../../services/invoiceService.js"));
function getQuotations(req, res) {
    const quotes = connection_js_1.db.prepare('SELECT * FROM quotations WHERE business_id = ? ORDER BY created_at DESC').all(req.businessId);
    res.json({ data: quotes });
}
const quoteSchema = zod_1.z.object({
    customerId: zod_1.z.string().max(64).optional().nullable(),
    customerName: zod_1.z.string().trim().min(1, 'Customer name is required').max(150),
    customerPhone: zod_1.z.string().trim().max(20).optional().nullable(),
    validUntil: zod_1.z.string().regex(dates_js_1.DATE_RE).optional().nullable().or(zod_1.z.literal('')),
    notes: zod_1.z.string().max(1000).optional().nullable(),
    items: zod_1.z.array(zod_1.z.object({
        productId: zod_1.z.string().max(64).optional().nullable(),
        productName: zod_1.z.string().trim().min(1).max(200),
        quantity: zod_1.z.coerce.number().positive(),
        unitPricePaise: zod_1.z.coerce.number().int().nonnegative(),
        taxRate: zod_1.z.coerce.number().min(0).max(100).default(0),
    })).min(1, 'Add at least one item').max(500),
});
function createQuotation(req, res) {
    const q = (0, http_js_1.parse)(quoteSchema, req.body);
    const businessId = req.businessId;
    const quoteId = (0, uuid_1.v4)();
    let subtotal = 0;
    let tax = 0;
    const processed = q.items.map((it) => {
        const lineSubtotal = Math.round(it.quantity * it.unitPricePaise);
        const lineTax = Math.round((lineSubtotal * it.taxRate) / 100);
        subtotal += lineSubtotal;
        tax += lineTax;
        const productId = it.productId && connection_js_1.db.prepare('SELECT 1 FROM products WHERE id = ? AND business_id = ?').get(it.productId, businessId) ? it.productId : null;
        return { ...it, productId, id: (0, uuid_1.v4)(), taxPaise: lineTax, totalPaise: lineSubtotal + lineTax };
    });
    let quoteNumber = '';
    connection_js_1.db.transaction(() => {
        const count = connection_js_1.db.prepare('SELECT COUNT(*) AS c FROM quotations WHERE business_id = ?').get(businessId).c;
        let n = 1001 + count;
        while (connection_js_1.db.prepare('SELECT 1 FROM quotations WHERE business_id = ? AND quotation_number = ?').get(businessId, `EST-${n}`))
            n++;
        quoteNumber = `EST-${n}`;
        connection_js_1.db.prepare(`INSERT INTO quotations (id, business_id, quotation_number, customer_id, customer_name, customer_phone, valid_until, subtotal_paise, tax_paise, total_paise, status, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SENT', ?, datetime('now'))`)
            .run(quoteId, businessId, quoteNumber, q.customerId || null, q.customerName, q.customerPhone || '', q.validUntil || null, subtotal, tax, subtotal + tax, q.notes || '');
        const insertItem = connection_js_1.db.prepare(`INSERT INTO quotation_items (id, business_id, quotation_id, product_id, product_name, quantity, unit_price_paise, tax_rate, tax_paise, total_paise)
                                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const it of processed) {
            insertItem.run(it.id, businessId, quoteId, it.productId, it.productName, it.quantity, it.unitPricePaise, it.taxRate, it.taxPaise, it.totalPaise);
        }
    })();
    res.status(201).json({ message: 'Quotation created successfully', quotationNumber: quoteNumber, id: quoteId });
}
/** Remove an estimate. Converted quotes can also be deleted — the linked invoice is left untouched. */
function deleteQuotation(req, res) {
    const businessId = req.businessId;
    const quote = connection_js_1.db.prepare('SELECT * FROM quotations WHERE id = ? AND business_id = ?').get(req.params.id, businessId);
    if (!quote)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Quotation not found');
    connection_js_1.db.transaction(() => {
        connection_js_1.db.prepare('DELETE FROM quotation_items WHERE quotation_id = ? AND business_id = ?').run(quote.id, businessId);
        connection_js_1.db.prepare('DELETE FROM quotations WHERE id = ? AND business_id = ?').run(quote.id, businessId);
    })();
    res.json({ message: `Quotation ${quote.quotation_number} deleted`, id: quote.id });
}
/** Convert a quotation to a real invoice through the invoice service (stock, GST and payments handled consistently). */
function convertToInvoice(req, res) {
    const businessId = req.businessId;
    const quote = connection_js_1.db.prepare('SELECT * FROM quotations WHERE id = ? AND business_id = ?').get(req.params.id, businessId);
    if (!quote)
        throw new http_js_1.HttpError(404, 'NOT_FOUND', 'Quotation not found');
    if (quote.status === 'CONVERTED')
        throw new http_js_1.HttpError(409, 'ALREADY_CONVERTED', 'Quotation has already been converted');
    const items = connection_js_1.db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ?').all(quote.id);
    const body = (req.body || {});
    const { invoice } = invoiceService.createInvoice(businessId, req.user?.userId || null, {
        customerId: quote.customer_id || undefined,
        customerName: quote.customer_name,
        customerPhone: quote.customer_phone || undefined,
        paymentMode: body.paymentMode || 'CASH',
        amountPaidPaise: body.amountPaidPaise,
        payments: body.payments,
        notes: `Converted from Quotation ${quote.quotation_number}`,
        items: items.map((it) => ({
            productId: it.product_id || undefined,
            productName: it.product_name,
            quantity: it.quantity,
            unitPricePaise: it.unit_price_paise,
            taxRate: it.tax_rate,
        })),
    });
    connection_js_1.db.prepare("UPDATE quotations SET status = 'CONVERTED', converted_invoice_id = ? WHERE id = ?").run(invoice.id, quote.id);
    res.json({ message: `Quotation converted to Invoice ${invoice.invoice_number}`, invoiceId: invoice.id, invoice });
}
