"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfitAndLoss = getProfitAndLoss;
exports.getGstSummary = getGstSummary;
const connection_js_1 = require("../../db/connection.js");
function getProfitAndLoss(req, res) {
    const businessId = req.businessId;
    const { fromDate, toDate } = req.query;
    const invConditions = ["business_id = ?", "status = 'ISSUED'"];
    const expConditions = ["business_id = ?"];
    const params = [businessId];
    if (fromDate) {
        invConditions.push("invoice_date >= ?");
        expConditions.push("expense_date >= ?");
        params.push(fromDate);
    }
    if (toDate) {
        invConditions.push("invoice_date <= ?");
        expConditions.push("expense_date <= ?");
        params.push(toDate);
    }
    // 1. Total Revenue (Sales)
    const sales = connection_js_1.db.prepare(`
    SELECT 
      COALESCE(SUM(subtotal_paise - discount_paise), 0) as net_sales_paise,
      COALESCE(SUM(tax_paise), 0) as tax_collected_paise,
      COALESCE(SUM(total_paise), 0) as gross_sales_paise,
      COUNT(id) as invoice_count
    FROM invoices 
    WHERE ${invConditions.join(' AND ')}
  `).get(...params);
    // 2. Cost of Goods Sold (COGS)
    const cogs = connection_js_1.db.prepare(`
    SELECT 
      COALESCE(SUM(ii.quantity * p.purchase_price_paise), 0) as cogs_paise
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    LEFT JOIN products p ON ii.product_id = p.id
    WHERE ${invConditions.map(c => c.replace('business_id', 'i.business_id').replace('status', 'i.status').replace('invoice_date', 'i.invoice_date')).join(' AND ')}
  `).get(...params);
    // 3. Total Expenses
    const expenses = connection_js_1.db.prepare(`
    SELECT 
      category, 
      COALESCE(SUM(amount_paise), 0) as total_paise 
    FROM expenses 
    WHERE ${expConditions.join(' AND ')}
    GROUP BY category
  `).all(...params);
    const totalExpensePaise = expenses.reduce((acc, curr) => acc + curr.total_paise, 0);
    const grossProfitPaise = sales.net_sales_paise - cogs.cogs_paise;
    const netProfitPaise = grossProfitPaise - totalExpensePaise;
    res.json({
        revenuePaise: sales.net_sales_paise,
        grossSalesPaise: sales.gross_sales_paise,
        taxCollectedPaise: sales.tax_collected_paise,
        cogsPaise: cogs.cogs_paise,
        grossProfitPaise,
        expenses,
        totalExpensePaise,
        netProfitPaise,
        invoiceCount: sales.invoice_count,
    });
}
function getGstSummary(req, res) {
    const businessId = req.businessId;
    const { fromDate, toDate } = req.query;
    const conditions = ["business_id = ?", "status = 'ISSUED'"];
    const params = [businessId];
    if (fromDate) {
        conditions.push("invoice_date >= ?");
        params.push(fromDate);
    }
    if (toDate) {
        conditions.push("invoice_date <= ?");
        params.push(toDate);
    }
    // GSTR-1 totals
    const totals = connection_js_1.db.prepare(`
    SELECT 
      COALESCE(SUM(subtotal_paise - discount_paise), 0) as taxable_value_paise,
      COALESCE(SUM(cgst_paise), 0) as cgst_paise,
      COALESCE(SUM(sgst_paise), 0) as sgst_paise,
      COALESCE(SUM(igst_paise), 0) as igst_paise,
      COALESCE(SUM(total_paise), 0) as total_paise,
      COUNT(id) as total_invoices
    FROM invoices
    WHERE ${conditions.join(' AND ')}
  `).get(...params);
    // HSN-wise summary
    const hsnSummary = connection_js_1.db.prepare(`
    SELECT 
      ii.hsn_code,
      ii.tax_rate,
      SUM(ii.quantity) as total_quantity,
      SUM(ii.total_paise - ii.tax_paise) as taxable_value_paise,
      SUM(ii.tax_paise) as tax_amount_paise,
      SUM(ii.total_paise) as total_value_paise
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE ${conditions.map(c => c.replace('business_id', 'i.business_id').replace('status', 'i.status').replace('invoice_date', 'i.invoice_date')).join(' AND ')}
    GROUP BY ii.hsn_code, ii.tax_rate
    ORDER BY taxable_value_paise DESC
  `).all(...params);
    res.json({
        summary: totals,
        hsnSummary,
    });
}
