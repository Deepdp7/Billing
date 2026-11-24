import { Response } from 'express';
import { z } from 'zod';
import { db } from '../../db/connection.js';
import { currentShopId } from '../../db/shops.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { parse } from '../../lib/http.js';
import { localDate, addDays } from '../../lib/dates.js';
import { getBusinessSettings, updateBusinessSettings } from '../../services/settingsService.js';
import { logAudit } from '../../services/auditService.js';
import { brandingSchema, getBranding, updateBranding } from '../../services/brandingService.js';

export function getBusinessProfile(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
  if (!business) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Business not found' });
    return;
  }
  res.json({ business });
}

export function updateBusinessProfile(req: AuthenticatedRequest, res: Response): void {
  const businessId = req.businessId;
  const { name, gstin, address, city, state, pincode, phone, email, invoicePrefix } = req.body;

  db.prepare(`
    UPDATE businesses SET
      name = COALESCE(?, name),
      gstin = COALESCE(?, gstin),
      address = COALESCE(?, address),
      city = COALESCE(?, city),
      state = COALESCE(?, state),
      pincode = COALESCE(?, pincode),
      phone = COALESCE(?, phone),
      email = COALESCE(?, email),
      invoice_prefix = COALESCE(?, invoice_prefix),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, gstin, address, city, state, pincode, phone, email, invoicePrefix, businessId);

  const updated = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
  res.json({ message: 'Profile updated successfully', business: updated });
}

const topCache = new Map<string, { at: number; rows: unknown[] }>();

export function getDashboardStats(req: AuthenticatedRequest, res: Response): void {
  const biz = req.businessId;
  const today = localDate();
  const monthStart = today.substring(0, 7) + '-01';
  const trendFrom = addDays(today, -29);

  const todaySales = db.prepare(`SELECT COALESCE(SUM(total_paise), 0) AS total, COUNT(id) AS count
    FROM invoices WHERE business_id = ? AND invoice_date = ? AND status = 'ISSUED'`).get(biz, today) as any;
  const monthSales = db.prepare(`SELECT COALESCE(SUM(total_paise), 0) AS total, COUNT(id) AS count,
      COALESCE(SUM(subtotal_paise - discount_paise), 0) AS net
    FROM invoices WHERE business_id = ? AND invoice_date >= ? AND status = 'ISSUED'`).get(biz, monthStart) as any;
  // From the day's sales per product (db/salesSummary.ts): a month of a big shop's bill lines added up in milliseconds
  const monthCogs = db.prepare(`SELECT COALESCE(SUM(cost_paise), 0) AS cogs FROM sales_rollup WHERE business_id = ? AND day >= ?`).get(biz, monthStart) as any;
  const monthPurchases = db.prepare(`SELECT COALESCE(SUM(total_paise), 0) AS total FROM purchase_invoices WHERE business_id = ? AND invoice_date >= ?`).get(biz, monthStart) as any;
  const monthExpenses = db.prepare(`SELECT COALESCE(SUM(amount_paise), 0) AS total FROM expenses WHERE business_id = ? AND expense_date >= ?`).get(biz, monthStart) as any;
  const receivables = db.prepare(`SELECT COALESCE(SUM(CASE WHEN outstanding_balance_paise > 0 THEN outstanding_balance_paise END), 0) AS total,
      SUM(CASE WHEN outstanding_balance_paise > 0 THEN 1 ELSE 0 END) AS customers
    FROM customers WHERE business_id = ?`).get(biz) as any;
  const payables = db.prepare(`SELECT COALESCE(SUM(CASE WHEN outstanding_balance_paise > 0 THEN outstanding_balance_paise END), 0) AS total
    FROM suppliers WHERE business_id = ?`).get(biz) as any;
  const lowStock = db.prepare(`SELECT COUNT(id) AS count FROM products
    WHERE business_id = ? AND is_active = 1 AND track_stock = 1 AND stock_quantity <= low_stock_threshold`).get(biz) as any;
  const lowStockItems = db.prepare(`SELECT id, name, sku, stock_quantity, low_stock_threshold, unit FROM products
    WHERE business_id = ? AND is_active = 1 AND track_stock = 1 AND stock_quantity <= low_stock_threshold
    ORDER BY stock_quantity ASC LIMIT 8`).all(biz);
  const catalogCount = db.prepare(`SELECT COUNT(id) AS count FROM products WHERE business_id = ? AND is_active = 1`).get(biz) as any;
  const customerStats = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_this_month
    FROM customers WHERE business_id = ? AND is_active = 1`).get(monthStart, biz) as any;
  const recentInvoices = db.prepare(`SELECT id, invoice_number, customer_name, total_paise, payment_mode, payment_status, created_at
    FROM invoices WHERE business_id = ? AND status = 'ISSUED' ORDER BY created_at DESC LIMIT 5`).all(biz);
  // The last 30 days (all time would read every bill line ever made: seconds for a shop with years of bills)
  // The 5 best sellers of 30 days hardly change from one minute to the next: worked out at most every 2 minutes
  const topKey = `${currentShopId()}|${biz}|${trendFrom}`;
  let top = topCache.get(topKey);
  if (!top || Date.now() - top.at > 120_000) {
    top = { at: Date.now(), rows: db.prepare(`SELECT MAX(product_name) AS product_name, SUM(quantity) AS total_sold, SUM(total_paise) AS total_revenue_paise
      FROM sales_rollup WHERE business_id = ? AND day >= ?
      GROUP BY product_key HAVING SUM(lines) > 0 ORDER BY total_sold DESC LIMIT 5`).all(biz, trendFrom) };
    topCache.set(topKey, top);
    if (topCache.size > 50) topCache.delete(topCache.keys().next().value as string);
  }
  const topProducts = top.rows;
  const trendRows = db.prepare(`SELECT invoice_date AS date, SUM(total_paise) AS sales_paise, COUNT(*) AS invoices
    FROM invoices WHERE business_id = ? AND status = 'ISSUED' AND invoice_date >= ? GROUP BY invoice_date`).all(biz, trendFrom) as any[];
  const byDate = new Map(trendRows.map((r) => [r.date, r]));
  const salesTrend = Array.from({ length: 30 }, (_, i) => {
    const d = addDays(trendFrom, i);
    const r = byDate.get(d);
    return { date: d, salesPaise: r?.sales_paise || 0, invoices: r?.invoices || 0 };
  });
  const paymentSummary = db.prepare(`SELECT payment_mode AS mode, SUM(CASE WHEN direction = 'IN' THEN amount_paise ELSE -amount_paise END) AS amount_paise, COUNT(*) AS count
    FROM payments WHERE business_id = ? AND status = 'ACTIVE' AND payment_date >= ? AND (invoice_id IS NOT NULL OR customer_id IS NOT NULL)
    GROUP BY payment_mode HAVING SUM(CASE WHEN direction = 'IN' THEN amount_paise ELSE -amount_paise END) != 0
    ORDER BY amount_paise DESC`).all(biz, monthStart);

  const monthGrossProfit = monthSales.net - Math.round(monthCogs.cogs);
  res.json({
    today: { salesPaise: todaySales.total, invoices: todaySales.count },
    month: {
      salesPaise: monthSales.total,
      invoices: monthSales.count,
      purchasesPaise: monthPurchases.total,
      expensesPaise: monthExpenses.total,
      grossProfitPaise: monthGrossProfit,
      netProfitPaise: monthGrossProfit - monthExpenses.total,
    },
    receivablesPaise: receivables.total,
    customersWithDues: receivables.customers || 0,
    payablesPaise: payables.total,
    lowStockCount: lowStock.count,
    lowStockItems,
    catalogCount: catalogCount.count,
    customers: { total: customerStats.total || 0, newThisMonth: customerStats.new_this_month || 0 },
    recentInvoices,
    topProducts,
    salesTrend,
    paymentSummary,
  });
}

export function getSettings(req: AuthenticatedRequest, res: Response): void {
  res.json({ settings: getBusinessSettings(req.businessId!) });
}

const settingsSchema = z.object({
  allowNegativeStock: z.boolean().optional(),
  roundOffEnabled: z.boolean().optional(),
  pricesIncludeTaxDefault: z.boolean().optional(),
  enforceCreditLimit: z.boolean().optional(),
  defaultCreditDays: z.coerce.number().int().min(0).max(365).optional(),
  invoiceTerms: z.string().max(1000).optional(),
  invoiceFooter: z.string().max(300).optional(),
});

export function updateSettings(req: AuthenticatedRequest, res: Response): void {
  const input = parse(settingsSchema, req.body);
  const settings = updateBusinessSettings(req.businessId!, input);
  logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'SETTINGS_UPDATED', entityType: 'SETTINGS', details: input });
  res.json({ message: 'Settings saved', settings });
}

export function getBrandingSettings(req: AuthenticatedRequest, res: Response): void {
  res.json({ branding: getBranding(req.businessId!) });
}

export function updateBrandingSettings(req: AuthenticatedRequest, res: Response): void {
  const changed = updateBranding(req.businessId!, parse(brandingSchema, req.body));
  // Only what changed is recorded: pictures are far too big for the audit log
  if (changed.length) logAudit({ businessId: req.businessId, userId: req.user?.userId, action: 'BRANDING_UPDATED', entityType: 'SETTINGS', details: { changed } });
  res.json({ message: 'Branding saved', branding: getBranding(req.businessId!) });
}
