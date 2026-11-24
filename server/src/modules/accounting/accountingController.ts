import { Response } from 'express';
import { db } from '../../db/connection.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { HttpError } from '../../lib/http.js';
import { DATE_RE, localDate } from '../../lib/dates.js';
import { Column, sendTable } from '../../services/exportService.js';

function range(req: AuthenticatedRequest) {
  const { fromDate, toDate } = req.query as Record<string, string>;
  if (fromDate && !DATE_RE.test(fromDate)) throw new HttpError(400, 'BAD_DATE', 'fromDate must be YYYY-MM-DD');
  if (toDate && !DATE_RE.test(toDate)) throw new HttpError(400, 'BAD_DATE', 'toDate must be YYYY-MM-DD');
  return { from: fromDate || '0000-01-01', to: toDate || '9999-12-31' };
}

/** Sales per HSN code and GST rate in a period, from the day's sales per product (db/salesSummary.ts) */
const HSN_SQL = `SELECT NULLIF(hsn_code, '') AS hsn_code, tax_rate, SUM(quantity) AS total_quantity, SUM(taxable_paise) AS taxable_value_paise,
    SUM(cgst_paise) AS cgst_paise, SUM(sgst_paise) AS sgst_paise, SUM(igst_paise) AS igst_paise,
    SUM(tax_paise) AS tax_amount_paise, SUM(total_paise) AS total_value_paise
  FROM sales_rollup WHERE business_id = ? AND day BETWEEN ? AND ?
  GROUP BY hsn_code, tax_rate HAVING SUM(lines) > 0`;

function profitAndLoss(businessId: string, from: string, to: string) {
  const sales = db.prepare(`
    SELECT COALESCE(SUM(subtotal_paise - discount_paise), 0) AS net_sales_paise, COALESCE(SUM(tax_paise), 0) AS tax_collected_paise,
           COALESCE(SUM(total_paise), 0) AS gross_sales_paise, COALESCE(SUM(round_off_paise), 0) AS round_off_paise,
           COALESCE(SUM(discount_paise), 0) AS discount_paise, COUNT(id) AS invoice_count
    FROM invoices WHERE business_id = ? AND status = 'ISSUED' AND invoice_date BETWEEN ? AND ?`).get(businessId, from, to) as any;
  // Cost captured on each invoice line at the time of sale, added up per day (db/salesSummary.ts)
  const cogs = db.prepare(`
    SELECT COALESCE(SUM(cost_paise), 0) AS cogs_paise FROM sales_rollup
    WHERE business_id = ? AND day BETWEEN ? AND ?`).get(businessId, from, to) as any;
  const returns = db.prepare(`
    SELECT COALESCE(SUM(subtotal_paise), 0) AS returns_paise, COALESCE(SUM(tax_paise), 0) AS returns_tax_paise
    FROM credit_notes WHERE business_id = ? AND return_date BETWEEN ? AND ?`).get(businessId, from, to) as any;
  const returnedCost = db.prepare(`
    SELECT COALESCE(SUM(cni.quantity * COALESCE(p.purchase_price_paise, 0)), 0) AS cost_paise
    FROM credit_note_items cni JOIN credit_notes cn ON cn.id = cni.credit_note_id LEFT JOIN products p ON p.id = cni.product_id
    WHERE cn.business_id = ? AND cn.return_date BETWEEN ? AND ?`).get(businessId, from, to) as any;
  const expenses = db.prepare(`
    SELECT category, COALESCE(SUM(amount_paise), 0) AS total_paise FROM expenses
    WHERE business_id = ? AND expense_date BETWEEN ? AND ? GROUP BY category ORDER BY total_paise DESC`).all(businessId, from, to) as any[];

  const revenuePaise = sales.net_sales_paise - returns.returns_paise;
  const cogsPaise = Math.round(cogs.cogs_paise - returnedCost.cost_paise);
  const totalExpensePaise = expenses.reduce((a, e) => a + e.total_paise, 0);
  const grossProfitPaise = revenuePaise - cogsPaise;
  return {
    revenuePaise,
    grossSalesPaise: sales.gross_sales_paise,
    salesBeforeReturnsPaise: sales.net_sales_paise,
    returnsPaise: returns.returns_paise,
    discountPaise: sales.discount_paise,
    taxCollectedPaise: sales.tax_collected_paise - returns.returns_tax_paise,
    roundOffPaise: sales.round_off_paise,
    cogsPaise,
    grossProfitPaise,
    expenses,
    totalExpensePaise,
    netProfitPaise: grossProfitPaise - totalExpensePaise,
    invoiceCount: sales.invoice_count,
  };
}

export function getProfitAndLoss(req: AuthenticatedRequest, res: Response): void {
  const { from, to } = range(req);
  res.json(profitAndLoss(req.businessId!, from, to));
}

export function getGstSummary(req: AuthenticatedRequest, res: Response): void {
  const { from, to } = range(req);
  const biz = req.businessId;
  const summary = db.prepare(`
    SELECT COALESCE(SUM(subtotal_paise - discount_paise), 0) AS taxable_value_paise, COALESCE(SUM(cgst_paise), 0) AS cgst_paise,
           COALESCE(SUM(sgst_paise), 0) AS sgst_paise, COALESCE(SUM(igst_paise), 0) AS igst_paise,
           COALESCE(SUM(total_paise), 0) AS total_paise, COUNT(id) AS total_invoices,
           SUM(CASE WHEN customer_gstin IS NOT NULL AND customer_gstin != '' THEN 1 ELSE 0 END) AS b2b_invoices
    FROM invoices WHERE business_id = ? AND status = 'ISSUED' AND invoice_date BETWEEN ? AND ?`).get(biz, from, to);
  const hsnSummary = db.prepare(`${HSN_SQL} ORDER BY taxable_value_paise DESC`).all(biz, from, to) as any[];
  // Per rate: the per-HSN rows added up (one pass over the period's bill lines instead of two: a big shop's year of
  // bills is millions of lines)
  const byRate = new Map<number, any>();
  for (const h of hsnSummary) {
    const r = byRate.get(h.tax_rate) || { tax_rate: h.tax_rate, taxable_value_paise: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, tax_amount_paise: 0 };
    r.taxable_value_paise += h.taxable_value_paise || 0;
    r.cgst_paise += h.cgst_paise || 0;
    r.sgst_paise += h.sgst_paise || 0;
    r.igst_paise += h.igst_paise || 0;
    r.tax_amount_paise += h.tax_amount_paise || 0;
    byRate.set(h.tax_rate, r);
  }
  const rateSummary = [...byRate.values()].sort((a, b) => a.tax_rate - b.tax_rate);
  const inputTax = db.prepare(`SELECT COALESCE(SUM(tax_paise), 0) AS input_tax_paise, COALESCE(SUM(subtotal_paise), 0) AS purchase_taxable_paise
                               FROM purchase_invoices WHERE business_id = ? AND invoice_date BETWEEN ? AND ?`).get(biz, from, to);
  const creditNotes = db.prepare(`SELECT COALESCE(SUM(tax_paise), 0) AS tax_paise, COALESCE(SUM(subtotal_paise), 0) AS taxable_paise, COUNT(*) AS count
                                  FROM credit_notes WHERE business_id = ? AND return_date BETWEEN ? AND ?`).get(biz, from, to);
  res.json({ summary, hsnSummary, rateSummary, inputTax, creditNotes });
}

// ---------------- Report registry (JSON view + CSV/XLSX export share one definition) ----------------

interface ReportResult { title: string; columns: Column[]; rows: any[]; summary?: Record<string, unknown> }

const PERIOD_EXPR: Record<string, string> = {
  day: "invoice_date",
  week: "strftime('%Y-W%W', invoice_date)",
  month: "substr(invoice_date, 1, 7)",
  year: "substr(invoice_date, 1, 4)",
};

const REPORTS: Record<string, (biz: string, from: string, to: string, q: Record<string, string>) => ReportResult> = {
  sales: (biz, from, to, q) => {
    const groupBy = PERIOD_EXPR[q.groupBy] ? q.groupBy : 'day';
    const expr = PERIOD_EXPR[groupBy];
    const rows = db.prepare(`
      SELECT ${expr} AS period, COUNT(*) AS invoices, SUM(subtotal_paise - discount_paise) AS taxable_paise, SUM(discount_paise) AS discount_paise,
             SUM(tax_paise) AS tax_paise, SUM(total_paise) AS total_paise, SUM(amount_paid_paise) AS collected_paise,
             SUM(total_paise - amount_paid_paise) AS outstanding_paise
      FROM invoices WHERE business_id = ? AND status = 'ISSUED' AND invoice_date BETWEEN ? AND ?
      GROUP BY period ORDER BY period`).all(biz, from, to) as any[];
    const sum = (k: string) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    return {
      title: `Sales report (${groupBy}ly)`.replace('dayly', 'daily'),
      columns: [
        { key: 'period', label: 'Period' }, { key: 'invoices', label: 'Invoices' }, { key: 'taxable_paise', label: 'Taxable (₹)', money: true },
        { key: 'discount_paise', label: 'Discount (₹)', money: true }, { key: 'tax_paise', label: 'GST (₹)', money: true },
        { key: 'total_paise', label: 'Total (₹)', money: true }, { key: 'collected_paise', label: 'Collected (₹)', money: true },
        { key: 'outstanding_paise', label: 'Outstanding (₹)', money: true },
      ],
      rows,
      summary: { invoices: sum('invoices'), total_paise: sum('total_paise'), tax_paise: sum('tax_paise'), collected_paise: sum('collected_paise') },
    };
  },
  invoices: (biz, from, to) => ({
    title: 'Invoice register',
    columns: [
      { key: 'invoice_date', label: 'Date' }, { key: 'invoice_number', label: 'Invoice No' }, { key: 'customer_name', label: 'Customer' },
      { key: 'customer_gstin', label: 'GSTIN' }, { key: 'taxable_paise', label: 'Taxable (₹)', money: true }, { key: 'cgst_paise', label: 'CGST (₹)', money: true },
      { key: 'sgst_paise', label: 'SGST (₹)', money: true }, { key: 'igst_paise', label: 'IGST (₹)', money: true },
      { key: 'round_off_paise', label: 'Round-off (₹)', money: true }, { key: 'total_paise', label: 'Total (₹)', money: true },
      { key: 'payment_mode', label: 'Payment' }, { key: 'payment_status', label: 'Status' }, { key: 'status', label: 'Invoice Status' },
    ],
    rows: db.prepare(`SELECT *, subtotal_paise - discount_paise AS taxable_paise FROM invoices
                      WHERE business_id = ? AND status IN ('ISSUED','CANCELLED') AND invoice_date BETWEEN ? AND ? ORDER BY invoice_date, invoice_number`)
      .all(biz, from, to),
  }),
  payments: (biz, from, to) => {
    const rows = db.prepare(`
      SELECT payment_mode, direction, COUNT(*) AS count, SUM(amount_paise) AS amount_paise FROM payments
      WHERE business_id = ? AND status = 'ACTIVE' AND payment_date BETWEEN ? AND ? GROUP BY payment_mode, direction ORDER BY direction, amount_paise DESC`)
      .all(biz, from, to) as any[];
    return {
      title: 'Payments by mode',
      columns: [{ key: 'direction', label: 'Direction (IN = received, OUT = paid)' }, { key: 'payment_mode', label: 'Mode' },
        { key: 'count', label: 'Transactions' }, { key: 'amount_paise', label: 'Amount (₹)', money: true }],
      rows,
      summary: {
        received_paise: rows.filter((r) => r.direction === 'IN').reduce((a, r) => a + r.amount_paise, 0),
        paid_out_paise: rows.filter((r) => r.direction === 'OUT').reduce((a, r) => a + r.amount_paise, 0),
      },
    };
  },
  'customer-outstanding': (biz) => ({
    title: 'Customer outstanding (receivables) with ageing',
    columns: [
      { key: 'name', label: 'Customer' }, { key: 'phone', label: 'Phone' }, { key: 'outstanding_balance_paise', label: 'Outstanding (₹)', money: true },
      { key: 'age_0_30_paise', label: '0–30 days (₹)', money: true }, { key: 'age_31_60_paise', label: '31–60 days (₹)', money: true },
      { key: 'age_61_90_paise', label: '61–90 days (₹)', money: true }, { key: 'age_90_plus_paise', label: '90+ days (₹)', money: true },
      { key: 'oldest_due', label: 'Oldest Unpaid Invoice' },
    ],
    rows: db.prepare(`
      SELECT c.name, c.phone, c.outstanding_balance_paise,
        COALESCE(SUM(CASE WHEN julianday('now','localtime') - julianday(i.invoice_date) <= 30 THEN i.total_paise - i.amount_paid_paise END), 0) AS age_0_30_paise,
        COALESCE(SUM(CASE WHEN julianday('now','localtime') - julianday(i.invoice_date) BETWEEN 30.0001 AND 60 THEN i.total_paise - i.amount_paid_paise END), 0) AS age_31_60_paise,
        COALESCE(SUM(CASE WHEN julianday('now','localtime') - julianday(i.invoice_date) BETWEEN 60.0001 AND 90 THEN i.total_paise - i.amount_paid_paise END), 0) AS age_61_90_paise,
        COALESCE(SUM(CASE WHEN julianday('now','localtime') - julianday(i.invoice_date) > 90 THEN i.total_paise - i.amount_paid_paise END), 0) AS age_90_plus_paise,
        MIN(i.invoice_date) AS oldest_due
      FROM customers c
      LEFT JOIN invoices i ON i.customer_id = c.id AND i.status = 'ISSUED' AND i.amount_paid_paise < i.total_paise
      WHERE c.business_id = ? AND c.outstanding_balance_paise != 0
      GROUP BY c.id ORDER BY c.outstanding_balance_paise DESC`).all(biz),
  }),
  'supplier-outstanding': (biz) => ({
    title: 'Supplier outstanding (payables)',
    columns: [{ key: 'name', label: 'Supplier' }, { key: 'phone', label: 'Phone' }, { key: 'gstin', label: 'GSTIN' },
      { key: 'outstanding_balance_paise', label: 'Payable (₹)', money: true }, { key: 'unpaid_bills', label: 'Unpaid Bills' }],
    rows: db.prepare(`SELECT s.name, s.phone, s.gstin, s.outstanding_balance_paise,
                        (SELECT COUNT(*) FROM purchase_invoices p WHERE p.supplier_id = s.id AND p.amount_paid_paise < p.total_paise) AS unpaid_bills
                      FROM suppliers s WHERE s.business_id = ? AND s.outstanding_balance_paise != 0 ORDER BY s.outstanding_balance_paise DESC`).all(biz),
  }),
  purchases: (biz, from, to) => ({
    title: 'Purchase register',
    columns: [{ key: 'invoice_date', label: 'Date' }, { key: 'purchase_number', label: 'Bill No' }, { key: 'supplier_name', label: 'Supplier' },
      { key: 'subtotal_paise', label: 'Taxable (₹)', money: true }, { key: 'tax_paise', label: 'GST (₹)', money: true },
      { key: 'total_paise', label: 'Total (₹)', money: true }, { key: 'amount_paid_paise', label: 'Paid (₹)', money: true }, { key: 'payment_status', label: 'Status' }],
    rows: db.prepare(`SELECT * FROM purchase_invoices WHERE business_id = ? AND invoice_date BETWEEN ? AND ? ORDER BY invoice_date`).all(biz, from, to),
  }),
  expenses: (biz, from, to) => ({
    title: 'Expenses',
    columns: [{ key: 'expense_date', label: 'Date' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' },
      { key: 'payment_mode', label: 'Mode' }, { key: 'amount_paise', label: 'Amount (₹)', money: true }],
    rows: db.prepare('SELECT * FROM expenses WHERE business_id = ? AND expense_date BETWEEN ? AND ? ORDER BY expense_date').all(biz, from, to),
  }),
  inventory: (biz) => ({
    title: 'Inventory valuation',
    columns: [{ key: 'name', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'category_name', label: 'Category' }, { key: 'stock_quantity', label: 'Stock' },
      { key: 'unit', label: 'Unit' }, { key: 'purchase_price_paise', label: 'Cost (₹)', money: true }, { key: 'value_paise', label: 'Value at Cost (₹)', money: true },
      { key: 'sale_price_paise', label: 'Price (₹)', money: true }, { key: 'low_stock', label: 'Low Stock' }],
    rows: db.prepare(`SELECT p.name, p.sku, c.name AS category_name, p.stock_quantity, p.unit, p.purchase_price_paise, p.sale_price_paise,
                        ROUND(MAX(p.stock_quantity, 0) * p.purchase_price_paise) AS value_paise,
                        CASE WHEN p.stock_quantity <= p.low_stock_threshold THEN 'YES' ELSE '' END AS low_stock
                      FROM products p LEFT JOIN categories c ON c.id = p.category_id
                      WHERE p.business_id = ? AND p.is_active = 1 AND p.track_stock = 1 ORDER BY value_paise DESC`).all(biz),
  }),
  'cash-flow': (biz, from, to, q) => {
    const groupBy = q.groupBy === 'month' ? 'month' : 'day';
    const pe = groupBy === 'month' ? 'substr(d, 1, 7)' : 'd';
    const rows = db.prepare(`
      WITH flows AS (
        SELECT payment_date AS d, CASE WHEN direction = 'IN' THEN amount_paise ELSE 0 END AS inflow,
               CASE WHEN direction = 'OUT' THEN amount_paise ELSE 0 END AS outflow, payment_mode AS mode
        FROM payments WHERE business_id = ? AND status = 'ACTIVE' AND payment_date BETWEEN ? AND ?
        UNION ALL
        SELECT expense_date, 0, amount_paise, payment_mode FROM expenses WHERE business_id = ? AND expense_date BETWEEN ? AND ?
      )
      SELECT ${pe} AS period, SUM(inflow) AS inflow_paise, SUM(outflow) AS outflow_paise, SUM(inflow) - SUM(outflow) AS net_paise,
             SUM(CASE WHEN mode = 'CASH' THEN inflow - outflow ELSE 0 END) AS net_cash_paise
      FROM flows GROUP BY period ORDER BY period`).all(biz, from, to, biz, from, to) as any[];
    return {
      title: 'Cash flow summary',
      columns: [{ key: 'period', label: 'Period' }, { key: 'inflow_paise', label: 'Money In (₹)', money: true },
        { key: 'outflow_paise', label: 'Money Out (₹)', money: true }, { key: 'net_paise', label: 'Net (₹)', money: true },
        { key: 'net_cash_paise', label: 'Net Cash-in-hand (₹)', money: true }],
      rows,
      summary: { inflow_paise: rows.reduce((a, r) => a + r.inflow_paise, 0), outflow_paise: rows.reduce((a, r) => a + r.outflow_paise, 0) },
    };
  },
  'top-products': (biz, from, to) => ({
    title: 'Product-wise sales',
    columns: [{ key: 'product_name', label: 'Product' }, { key: 'quantity', label: 'Qty Sold' }, { key: 'revenue_paise', label: 'Revenue ex-GST (₹)', money: true },
      { key: 'cost_paise', label: 'Cost (₹)', money: true }, { key: 'profit_paise', label: 'Gross Profit (₹)', money: true }],
    rows: db.prepare(`SELECT MAX(product_name) AS product_name, SUM(quantity) AS quantity, SUM(taxable_paise) AS revenue_paise,
                        ROUND(SUM(cost_paise)) AS cost_paise, SUM(taxable_paise) - ROUND(SUM(cost_paise)) AS profit_paise
                      FROM sales_rollup WHERE business_id = ? AND day BETWEEN ? AND ?
                      GROUP BY product_key HAVING SUM(lines) > 0 ORDER BY revenue_paise DESC`).all(biz, from, to),
  }),
  'gst-hsn': (biz, from, to) => ({
    title: 'GST HSN summary',
    columns: [{ key: 'hsn_code', label: 'HSN/SAC' }, { key: 'tax_rate', label: 'GST %' }, { key: 'total_quantity', label: 'Qty' },
      { key: 'taxable_value_paise', label: 'Taxable (₹)', money: true }, { key: 'cgst_paise', label: 'CGST (₹)', money: true },
      { key: 'sgst_paise', label: 'SGST (₹)', money: true }, { key: 'igst_paise', label: 'IGST (₹)', money: true }, { key: 'total_value_paise', label: 'Total (₹)', money: true }],
    rows: db.prepare(`${HSN_SQL} ORDER BY taxable_value_paise DESC`).all(biz, from, to),
  }),
  'profit-loss': (biz, from, to) => {
    const pl = profitAndLoss(biz, from, to);
    const rows = [
      { line: 'Sales (ex-GST)', amount_paise: pl.salesBeforeReturnsPaise },
      { line: 'Less: Sales returns', amount_paise: -pl.returnsPaise },
      { line: 'Net revenue', amount_paise: pl.revenuePaise },
      { line: 'Less: Cost of goods sold', amount_paise: -pl.cogsPaise },
      { line: 'Gross profit', amount_paise: pl.grossProfitPaise },
      ...pl.expenses.map((e: any) => ({ line: `Less: ${e.category}`, amount_paise: -e.total_paise })),
      { line: 'Net profit', amount_paise: pl.netProfitPaise },
    ];
    return { title: 'Profit & loss', columns: [{ key: 'line', label: 'Particulars' }, { key: 'amount_paise', label: 'Amount (₹)', money: true }], rows, summary: pl };
  },
};

export const REPORT_TYPES = Object.keys(REPORTS);

function runReport(req: AuthenticatedRequest): ReportResult & { type: string; from: string; to: string } {
  const type = req.params.type;
  const fn = REPORTS[type];
  if (!fn) throw new HttpError(404, 'UNKNOWN_REPORT', `Unknown report "${type}". Available: ${REPORT_TYPES.join(', ')}`);
  const { from, to } = range(req);
  return { type, from, to, ...fn(req.businessId!, from, to, req.query as Record<string, string>) };
}

/** Rows shown on screen; a bigger report (a mall's month of bills: 80,000 rows, 75 MB) is downloaded with Export */
const VIEW_ROWS = 1000;

export function getReport(req: AuthenticatedRequest, res: Response): void {
  const r = runReport(req);
  if (r.rows.length <= VIEW_ROWS) {
    res.json(r);
    return;
  }
  // The totals (summary) are of the whole report; only the list is cut
  res.json({ ...r, rows: r.rows.slice(0, VIEW_ROWS), totalRows: r.rows.length });
}

export function exportReport(req: AuthenticatedRequest, res: Response): void {
  const r = runReport(req);
  sendTable(res, (req.query.format as string) || 'csv', `${r.type}-report`, r.columns, r.rows);
}

export function listReports(req: AuthenticatedRequest, res: Response): void {
  res.json({ data: REPORT_TYPES, today: localDate() });
}
