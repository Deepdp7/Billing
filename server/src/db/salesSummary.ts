import type Database from 'better-sqlite3-multiple-ciphers';

/**
 * The day's sales per product, kept up to date by the database itself (sales_rollup): what the dashboard, profit & loss,
 * the GST summary and the product and HSN reports add up. A mall store makes thousands of bill lines a day; adding up a
 * month of lines took seconds, a year of them twenty. These read one row per product per day instead.
 *
 * Only issued bills count (as before). Triggers keep it right however a bill changes: a line added, edited or removed,
 * a draft issued, a bill cancelled or deleted, its date changed, or the same changes arriving from the account's other
 * computers (sync writes plain rows, so the triggers see them too). It is this computer's own figure, never synced, and
 * it can always be built again from the bills (rebuildSalesSummary). The last few days are built again each time the
 * business opens, so even a slip could not linger where the dashboard looks.
 */

const COLS = 'business_id, day, product_key, hsn_code, tax_rate, product_name, quantity, taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise, cost_paise, lines';

/** One upsert adding (or, with sign "-", taking away) bill lines `src` (NEW / OLD / x) of a bill on `biz` / `day` */
function apply(src: string, sign: '' | '-', biz: string, day: string, from: string, where: string): string {
  const v = (col: string) => `${sign}COALESCE(${src}.${col}, 0)`;
  return `INSERT INTO sales_rollup (${COLS})
    SELECT ${biz}, ${day}, COALESCE(${src}.product_id, ${src}.product_name, ''), COALESCE(${src}.hsn_code, ''), COALESCE(${src}.tax_rate, 0),
      COALESCE(${src}.product_name, ''), ${v('quantity')}, ${v('taxable_paise')}, ${v('cgst_paise')}, ${v('sgst_paise')}, ${v('igst_paise')},
      ${v('tax_paise')}, ${v('total_paise')}, ${sign}(COALESCE(${src}.quantity, 0) * COALESCE(${src}.cost_price_paise, 0)), ${sign}1
    FROM ${from} WHERE ${where}
    ON CONFLICT(business_id, day, product_key, hsn_code, tax_rate) DO UPDATE SET
      quantity = quantity + excluded.quantity, taxable_paise = taxable_paise + excluded.taxable_paise,
      cgst_paise = cgst_paise + excluded.cgst_paise, sgst_paise = sgst_paise + excluded.sgst_paise, igst_paise = igst_paise + excluded.igst_paise,
      tax_paise = tax_paise + excluded.tax_paise, total_paise = total_paise + excluded.total_paise, cost_paise = cost_paise + excluded.cost_paise,
      lines = lines + excluded.lines,
      product_name = CASE WHEN excluded.lines > 0 THEN excluded.product_name ELSE product_name END;`;
}

/** The table and its triggers (idempotent) */
export const SALES_SUMMARY_SQL = `
  CREATE TABLE IF NOT EXISTS sales_rollup (
    business_id TEXT NOT NULL,
    day TEXT NOT NULL,
    product_key TEXT NOT NULL,
    hsn_code TEXT NOT NULL DEFAULT '',
    tax_rate REAL NOT NULL DEFAULT 0,
    product_name TEXT NOT NULL DEFAULT '',
    quantity REAL NOT NULL DEFAULT 0,
    taxable_paise INTEGER NOT NULL DEFAULT 0,
    cgst_paise INTEGER NOT NULL DEFAULT 0,
    sgst_paise INTEGER NOT NULL DEFAULT 0,
    igst_paise INTEGER NOT NULL DEFAULT 0,
    tax_paise INTEGER NOT NULL DEFAULT 0,
    total_paise INTEGER NOT NULL DEFAULT 0,
    cost_paise REAL NOT NULL DEFAULT 0,
    lines INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (business_id, day, product_key, hsn_code, tax_rate)
  ) WITHOUT ROWID;

  CREATE TRIGGER IF NOT EXISTS rollup_line_added AFTER INSERT ON invoice_items BEGIN
    ${apply('NEW', '', 'i.business_id', 'i.invoice_date', 'invoices i', "i.id = NEW.invoice_id AND i.status = 'ISSUED'")}
  END;
  CREATE TRIGGER IF NOT EXISTS rollup_line_removed AFTER DELETE ON invoice_items BEGIN
    ${apply('OLD', '-', 'i.business_id', 'i.invoice_date', 'invoices i', "i.id = OLD.invoice_id AND i.status = 'ISSUED'")}
  END;
  CREATE TRIGGER IF NOT EXISTS rollup_line_changed AFTER UPDATE ON invoice_items BEGIN
    ${apply('OLD', '-', 'i.business_id', 'i.invoice_date', 'invoices i', "i.id = OLD.invoice_id AND i.status = 'ISSUED'")}
    ${apply('NEW', '', 'i.business_id', 'i.invoice_date', 'invoices i', "i.id = NEW.invoice_id AND i.status = 'ISSUED'")}
  END;
  -- A bill that arrives (from another computer) after its lines
  CREATE TRIGGER IF NOT EXISTS rollup_bill_added AFTER INSERT ON invoices WHEN NEW.status = 'ISSUED' BEGIN
    ${apply('x', '', 'NEW.business_id', 'NEW.invoice_date', 'invoice_items x', 'x.invoice_id = NEW.id')}
  END;
  -- Issued, cancelled, re-dated or moved to another business
  CREATE TRIGGER IF NOT EXISTS rollup_bill_changed AFTER UPDATE OF status, invoice_date, business_id ON invoices
    WHEN (OLD.status = 'ISSUED' OR NEW.status = 'ISSUED')
     AND (OLD.status IS NOT NEW.status OR OLD.invoice_date IS NOT NEW.invoice_date OR OLD.business_id IS NOT NEW.business_id) BEGIN
    ${apply('x', '-', 'OLD.business_id', 'OLD.invoice_date', 'invoice_items x', "x.invoice_id = OLD.id AND OLD.status = 'ISSUED'")}
    ${apply('x', '', 'NEW.business_id', 'NEW.invoice_date', 'invoice_items x', "x.invoice_id = NEW.id AND NEW.status = 'ISSUED'")}
  END;
  -- Before the bill goes (its lines go after it, when the bill is no longer there to count them)
  CREATE TRIGGER IF NOT EXISTS rollup_bill_removed BEFORE DELETE ON invoices WHEN OLD.status = 'ISSUED' BEGIN
    ${apply('x', '-', 'OLD.business_id', 'OLD.invoice_date', 'invoice_items x', 'x.invoice_id = OLD.id')}
  END;
`;

/**
 * Builds the summary again from the bills: everything, or from `fromDay` on. Business by business, so each uses the
 * bills' (business, status, date) index.
 */
export function rebuildSalesSummary(db: Database.Database, fromDay = '0000-01-01'): void {
  const businesses = db.prepare('SELECT id FROM businesses').pluck().all() as string[];
  const clear = db.prepare('DELETE FROM sales_rollup WHERE business_id = ? AND day >= ?');
  const fill = db.prepare(`INSERT INTO sales_rollup (${COLS})
    SELECT i.business_id, i.invoice_date, COALESCE(x.product_id, x.product_name, ''), COALESCE(x.hsn_code, ''), COALESCE(x.tax_rate, 0),
      MAX(COALESCE(x.product_name, '')), SUM(COALESCE(x.quantity, 0)), SUM(COALESCE(x.taxable_paise, 0)), SUM(COALESCE(x.cgst_paise, 0)),
      SUM(COALESCE(x.sgst_paise, 0)), SUM(COALESCE(x.igst_paise, 0)), SUM(COALESCE(x.tax_paise, 0)), SUM(COALESCE(x.total_paise, 0)),
      SUM(COALESCE(x.quantity, 0) * COALESCE(x.cost_price_paise, 0)), COUNT(*)
    FROM invoices i JOIN invoice_items x ON x.invoice_id = i.id
    WHERE i.business_id = ? AND i.status = 'ISSUED' AND i.invoice_date >= ?
    GROUP BY 1, 2, 3, 4, 5`);
  db.transaction(() => {
    for (const biz of businesses) {
      clear.run(biz, fromDay);
      fill.run(biz, fromDay);
    }
    // Lines whose bill was removed while foreign keys were off (sync) have no business any more: not counted
    if (fromDay === '0000-01-01') db.prepare('DELETE FROM sales_rollup WHERE business_id NOT IN (SELECT id FROM businesses)').run();
  })();
}

/** At opening: the last few days built again from the bills (milliseconds) */
export function repairRecentSales(db: Database.Database, days = 3): void {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  rebuildSalesSummary(db, from);
}
