import type Database from 'better-sqlite3-multiple-ciphers';
import fs from 'fs';
import path from 'path';
import { SCHEMA_SQL } from './schema.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

export function addColumn(db: Database.Database, table: string, column: string, definition: string): void {
  if (!columnExists(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline_schema',
    up: (db) => {
      db.exec(SCHEMA_SQL);
      // Columns previously added by ad-hoc ALTER statements.
      addColumn(db, 'customers', 'loyalty_points', 'INTEGER DEFAULT 0');
      addColumn(db, 'invoices', 'loyalty_points_redeemed', 'INTEGER DEFAULT 0');
      addColumn(db, 'invoices', 'loyalty_points_earned', 'INTEGER DEFAULT 0');
      addColumn(db, 'customers', 'customer_type', "TEXT DEFAULT 'RETAIL'");
      addColumn(db, 'customers', 'credit_days', 'INTEGER DEFAULT 30');
    },
  },
  {
    version: 2,
    name: 'billing_integrity_and_desktop',
    up: (db) => {
      // ---- Invoices: GST breakdown, round-off, drafts, cancellation audit, idempotency ----
      addColumn(db, 'invoices', 'round_off_paise', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'invoices', 'is_inter_state', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'invoices', 'place_of_supply', 'TEXT');
      addColumn(db, 'invoices', 'prices_include_tax', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'invoices', 'due_date', 'TEXT');
      addColumn(db, 'invoices', 'billing_address', 'TEXT');
      addColumn(db, 'invoices', 'shipping_address', 'TEXT');
      addColumn(db, 'invoices', 'cancelled_at', 'TEXT');
      addColumn(db, 'invoices', 'cancel_reason', 'TEXT');
      addColumn(db, 'invoices', 'cancelled_by', 'TEXT');
      addColumn(db, 'invoices', 'client_request_id', 'TEXT');
      addColumn(db, 'invoices', 'source_invoice_id', 'TEXT');
      addColumn(db, 'invoices', 'draft_payload_json', 'TEXT');
      addColumn(db, 'invoices', 'updated_at', 'TEXT');

      addColumn(db, 'invoice_items', 'unit', 'TEXT');
      addColumn(db, 'invoice_items', 'taxable_paise', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'invoice_items', 'cgst_paise', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'invoice_items', 'sgst_paise', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'invoice_items', 'igst_paise', 'INTEGER NOT NULL DEFAULT 0');
      // Cost captured at time of sale so COGS does not drift when purchase prices change.
      addColumn(db, 'invoice_items', 'cost_price_paise', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'invoice_items', 'mrp_paise', 'INTEGER NOT NULL DEFAULT 0');

      // ---- Payments: direction (receipt/refund), suppliers, voiding ----
      addColumn(db, 'payments', 'direction', "TEXT NOT NULL DEFAULT 'IN'");
      addColumn(db, 'payments', 'payment_date', 'TEXT');
      addColumn(db, 'payments', 'supplier_id', 'TEXT REFERENCES suppliers(id) ON DELETE SET NULL');
      addColumn(db, 'payments', 'purchase_id', 'TEXT REFERENCES purchase_invoices(id) ON DELETE SET NULL');
      addColumn(db, 'payments', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
      addColumn(db, 'payments', 'created_by', 'TEXT');

      // ---- Customers & suppliers ----
      addColumn(db, 'customers', 'billing_address', 'TEXT');
      addColumn(db, 'customers', 'shipping_address', 'TEXT');
      addColumn(db, 'customers', 'city', 'TEXT');
      addColumn(db, 'customers', 'state', 'TEXT');
      addColumn(db, 'customers', 'pincode', 'TEXT');
      addColumn(db, 'customers', 'notes', 'TEXT');
      addColumn(db, 'customers', 'is_active', 'INTEGER NOT NULL DEFAULT 1');

      // Services and fee items are not stock-tracked, so they never block on "insufficient stock".
      addColumn(db, 'products', 'track_stock', 'INTEGER NOT NULL DEFAULT 1');
      db.exec(`UPDATE products SET track_stock = 0
               WHERE business_id IN (SELECT id FROM businesses WHERE category IN ('SERVICE', 'SCHOOL'))`);

      addColumn(db, 'suppliers', 'state', 'TEXT');
      addColumn(db, 'suppliers', 'is_active', 'INTEGER NOT NULL DEFAULT 1');

      addColumn(db, 'purchase_invoices', 'is_inter_state', 'INTEGER NOT NULL DEFAULT 0');
      addColumn(db, 'purchase_invoices', 'purchase_order_id', 'TEXT');

      addColumn(db, 'quotation_items', 'product_id', 'TEXT REFERENCES products(id) ON DELETE SET NULL');
      addColumn(db, 'quotations', 'customer_id', 'TEXT REFERENCES customers(id) ON DELETE SET NULL');
      addColumn(db, 'quotations', 'converted_invoice_id', 'TEXT');

      addColumn(db, 'expenses', 'reference', 'TEXT');
      addColumn(db, 'expenses', 'attachment_path', 'TEXT');
      addColumn(db, 'expenses', 'updated_at', 'TEXT');
      addColumn(db, 'categories', 'updated_at', 'TEXT');

      addColumn(db, 'users', 'last_login_at', 'TEXT');

      db.exec(`
        -- Per-business application settings (key/value)
        CREATE TABLE IF NOT EXISTS app_settings (
          business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (business_id, key)
        );

        -- Installation-wide settings (backup directory and schedule, etc.)
        CREATE TABLE IF NOT EXISTS system_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Held (parked) POS bills, persisted so they survive restarts
        CREATE TABLE IF NOT EXISTS held_bills (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          label TEXT,
          customer_name TEXT,
          payload_json TEXT NOT NULL,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Expense categories (user-defined)
        CREATE TABLE IF NOT EXISTS expense_categories (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (business_id, name)
        );

        -- Purchase orders (before goods are received)
        CREATE TABLE IF NOT EXISTS purchase_orders (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          po_number TEXT NOT NULL,
          supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
          supplier_name TEXT NOT NULL,
          order_date TEXT NOT NULL DEFAULT (date('now')),
          expected_date TEXT,
          subtotal_paise INTEGER NOT NULL DEFAULT 0,
          tax_paise INTEGER NOT NULL DEFAULT 0,
          total_paise INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN, RECEIVED, CANCELLED
          received_purchase_id TEXT REFERENCES purchase_invoices(id) ON DELETE SET NULL,
          notes TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (business_id, po_number)
        );
        CREATE TABLE IF NOT EXISTS purchase_order_items (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
          product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
          product_name TEXT NOT NULL,
          quantity REAL NOT NULL,
          unit_price_paise INTEGER NOT NULL DEFAULT 0,
          tax_rate REAL NOT NULL DEFAULT 0,
          tax_paise INTEGER NOT NULL DEFAULT 0,
          total_paise INTEGER NOT NULL DEFAULT 0
        );

        -- Cash register shifts
        CREATE TABLE IF NOT EXISTS cash_register_sessions (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
          opened_by TEXT,
          closed_by TEXT,
          opening_cash_paise INTEGER NOT NULL DEFAULT 0,
          expected_cash_paise INTEGER,
          counted_cash_paise INTEGER,
          difference_paise INTEGER,
          status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN, CLOSED
          opened_at TEXT NOT NULL DEFAULT (datetime('now')),
          closed_at TEXT,
          notes TEXT
        );

        -- File-based backup history (the backups themselves live outside the database)
        CREATE TABLE IF NOT EXISTS backup_history (
          id TEXT PRIMARY KEY,
          file_name TEXT NOT NULL,
          file_path TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          sha256 TEXT,
          kind TEXT NOT NULL DEFAULT 'MANUAL', -- MANUAL, AUTO, PRE_MIGRATION, PRE_RESTORE
          status TEXT NOT NULL DEFAULT 'OK', -- OK, VERIFIED, FAILED, MISSING
          integrity TEXT,
          schema_version INTEGER,
          created_by TEXT,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Licensing state for this installation. The signed token is the source of truth;
        -- every field here is re-verified against the token signature before use.
        CREATE TABLE IF NOT EXISTS license_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          installation_id TEXT,
          installation_secret TEXT,
          license_token TEXT,
          last_sync_at TEXT,
          last_sync_error TEXT,
          max_seen_time TEXT,
          notices_json TEXT NOT NULL DEFAULT '[]',
          update_json TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Privacy-conscious feature usage counters (feature key + day + count only)
        CREATE TABLE IF NOT EXISTS feature_usage (
          feature_key TEXT NOT NULL,
          usage_date TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          synced_count INTEGER NOT NULL DEFAULT 0,
          first_used_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (feature_key, usage_date)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_client_request
          ON invoices(business_id, client_request_id) WHERE client_request_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(business_id, customer_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_status_date ON invoices(business_id, status, invoice_date);
        CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(business_id, invoice_id);
        CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(business_id, customer_id);
        CREATE INDEX IF NOT EXISTS idx_payments_supplier ON payments(business_id, supplier_id);
        CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(business_id, payment_date);
        CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
        CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchase_invoices(business_id, supplier_id);
        CREATE INDEX IF NOT EXISTS idx_products_name ON products(business_id, name);
        CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(business_id, name);
        CREATE INDEX IF NOT EXISTS idx_held_bills_biz ON held_bills(business_id);
        CREATE INDEX IF NOT EXISTS idx_po_biz ON purchase_orders(business_id, status);
        CREATE INDEX IF NOT EXISTS idx_po_items ON purchase_order_items(purchase_order_id);
        CREATE INDEX IF NOT EXISTS idx_cash_sessions ON cash_register_sessions(business_id, status);
      `);

      // Invoice numbers must be unique per business. Only enforce at the DB level when existing
      // data allows it; historical duplicates are left untouched (they are legal documents).
      const dupes = db.prepare(`
        SELECT COUNT(*) AS c FROM (
          SELECT 1 FROM invoices GROUP BY business_id, invoice_number HAVING COUNT(*) > 1
        )`).get() as { c: number };
      if (dupes.c === 0) {
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_unique_number ON invoices(business_id, invoice_number);');
      } else {
        console.warn(`[Migration] ${dupes.c} duplicate invoice numbers exist; unique index not created.`);
      }
      const skuDupes = db.prepare(`
        SELECT COUNT(*) AS c FROM (
          SELECT 1 FROM products WHERE is_active = 1 GROUP BY business_id, sku HAVING COUNT(*) > 1
        )`).get() as { c: number };
      if (skuDupes.c === 0) {
        db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_unique_sku ON products(business_id, sku) WHERE is_active = 1;');
      }

      // businesses.plan_id references plans; a fresh (non-demo) install previously had no plan rows, so
      // first-run registration failed with a foreign-key error. Entitlements now come from the license server.
      db.exec(`
        INSERT OR IGNORE INTO plans (id, name, tier, price_paise, billing_period, max_users, max_branches, max_invoices_per_month, features_json)
        VALUES ('plan_free', 'Starter', 'FREE', 0, 'MONTHLY', 2, 1, 100, '[]'),
               ('plan_pro', 'Licensed', 'PRO', 0, 'MONTHLY', 10, 3, 1000000, '[]'),
               ('plan_business', 'Enterprise', 'BUSINESS', 0, 'MONTHLY', 50, 10, 1000000, '[]');
      `);

      backfillAfterRestore(db);
    },
  },
  {
    version: 3,
    name: 'return_refunds_in_cash_book',
    up: (db) => {
      // Looked up on every sale (duplicate-checkout guard) and every bill opened; both scanned the whole table
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_invoices_request ON invoices(business_id, client_request_id);
        CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_credit_note_items_note ON credit_note_items(credit_note_id);
        CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(business_id, reference_number);
      `);
      // Returns refunded in cash / UPI / bank used to leave no trace in the cash book. Statements now show every
      // credit / debit note, so add the matching refund row for those made before.
      db.exec(`
        INSERT INTO payments (id, business_id, invoice_id, customer_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_at)
        SELECT lower(hex(randomblob(16))), cn.business_id, cn.invoice_id, cn.customer_id, cn.total_refund_paise, cn.refund_mode,
               cn.credit_note_number, 'Refund for sales return ' || cn.credit_note_number, 'OUT', cn.return_date, 'ACTIVE', cn.created_at
        FROM credit_notes cn
        WHERE cn.refund_mode NOT IN ('STORE_CREDIT', 'ADJUST_BALANCE') AND cn.total_refund_paise > 0
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.business_id = cn.business_id AND p.reference_number = cn.credit_note_number);
        INSERT INTO payments (id, business_id, supplier_id, purchase_id, amount_paise, payment_mode, reference_number, notes, direction, payment_date, status, created_at)
        SELECT lower(hex(randomblob(16))), dn.business_id, dn.supplier_id, dn.purchase_id, dn.total_paise, dn.refund_mode,
               dn.debit_note_number, 'Money back for purchase return ' || dn.debit_note_number, 'IN', dn.return_date, 'ACTIVE', dn.created_at
        FROM debit_notes dn
        WHERE dn.refund_mode <> 'ADJUST_PAYABLE' AND dn.total_paise > 0
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.business_id = dn.business_id AND p.reference_number = dn.debit_note_number);
      `);
    },
  },
  {
    version: 4,
    name: 'account_sync',
    up: (db) => {
      // The owner's sign-in as last set on this computer, until the vendor's server has it (sent = 1), and the last
      // change from the vendor (Admin Panel or a password reset) this computer has taken over (applied_rev)
      db.exec(`
        CREATE TABLE IF NOT EXISTS account_sync (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          user_id TEXT,
          email TEXT,
          password TEXT,
          source TEXT,
          sent INTEGER NOT NULL DEFAULT 0,
          applied_rev INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT
        );
      `);
    },
  },
  {
    version: 5,
    name: 'sync',
    up: (db) => {
      // Sync with the account's other computers (sync/syncEngine.ts). Triggers note every changed row in sync_outbox
      // and every change of a stock / balance counter in sync_deltas; both are emptied once the vendor's server has
      // them. sync_ctl.applying is 1 while changes from elsewhere are written (they are not sent back).
      db.exec(`
        CREATE TABLE IF NOT EXISTS sync_ctl (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          applying INTEGER NOT NULL DEFAULT 0,
          ver INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO sync_ctl (id) VALUES (1);
        CREATE TABLE IF NOT EXISTS sync_outbox (
          tbl TEXT NOT NULL,
          pk TEXT NOT NULL,
          ver INTEGER NOT NULL,
          PRIMARY KEY (tbl, pk)
        );
        CREATE INDEX IF NOT EXISTS idx_sync_outbox_ver ON sync_outbox(ver);
        CREATE TABLE IF NOT EXISTS sync_deltas (
          id TEXT PRIMARY KEY,
          tbl TEXT NOT NULL,
          pk TEXT NOT NULL,
          col TEXT NOT NULL,
          delta REAL NOT NULL,
          ver INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sync_deltas_row ON sync_deltas(tbl, pk);
        CREATE INDEX IF NOT EXISTS idx_sync_deltas_ver ON sync_deltas(ver);
        CREATE TABLE IF NOT EXISTS sync_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          joined INTEGER NOT NULL DEFAULT 0,
          business_id TEXT,
          epoch INTEGER NOT NULL DEFAULT 0,
          cursor INTEGER NOT NULL DEFAULT 0,
          device_no INTEGER NOT NULL DEFAULT 0,
          is_primary INTEGER NOT NULL DEFAULT 1,
          reset_pending INTEGER NOT NULL DEFAULT 0,
          last_push_at TEXT,
          last_pull_at TEXT,
          last_error TEXT
        );
        INSERT OR IGNORE INTO sync_state (id) VALUES (1);
      `);
    },
  },
];

/**
 * Derive v2 columns for rows that predate them (historical data, or data restored from an older backup).
 * Idempotent: only touches rows whose derived columns are still at their defaults.
 */
export function backfillAfterRestore(db: Database.Database): void {
  db.exec(`
    UPDATE invoice_items SET taxable_paise = total_paise - tax_paise WHERE taxable_paise = 0 AND total_paise > 0;
    UPDATE invoice_items SET
      cgst_paise = tax_paise / 2,
      sgst_paise = tax_paise - (tax_paise / 2)
    WHERE cgst_paise = 0 AND sgst_paise = 0 AND igst_paise = 0 AND tax_paise > 0
      AND invoice_id IN (SELECT id FROM invoices WHERE igst_paise = 0);
    UPDATE invoice_items SET igst_paise = tax_paise
    WHERE igst_paise = 0 AND tax_paise > 0 AND invoice_id IN (SELECT id FROM invoices WHERE igst_paise > 0);
    UPDATE invoice_items SET cost_price_paise = COALESCE(
      (SELECT purchase_price_paise FROM products WHERE products.id = invoice_items.product_id), 0)
    WHERE cost_price_paise = 0;
    UPDATE invoices SET is_inter_state = 1 WHERE igst_paise > 0 AND is_inter_state = 0;
    UPDATE invoices SET updated_at = created_at WHERE updated_at IS NULL;
    UPDATE payments SET payment_date = date(created_at) WHERE payment_date IS NULL;
    UPDATE customers SET billing_address = address WHERE billing_address IS NULL AND address IS NOT NULL;
  `);
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function getSchemaVersion(db: Database.Database): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

function hasUserData(db: Database.Database): boolean {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='businesses'").get();
  if (!t) return false;
  const row = db.prepare('SELECT COUNT(*) AS c FROM businesses').get() as { c: number };
  return row.c > 0;
}

/**
 * Apply pending migrations. If the database already holds data, a consistent copy is written to
 * `backupDir` first (VACUUM INTO), so a failed upgrade can always be rolled back.
 */
export function runMigrations(
  db: Database.Database,
  opts: { backupDir?: string; onBackup?: (filePath: string, fromVersion: number) => void } = {}
): { from: number; to: number; backupPath?: string } {
  const from = getSchemaVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from };

  let backupPath: string | undefined;
  if (opts.backupDir && hasUserData(db)) {
    fs.mkdirSync(opts.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = path.join(opts.backupDir, `pre-migration-v${from}-${stamp}.db`);
    db.prepare('VACUUM INTO ?').run(backupPath);
  }

  for (const m of pending) {
    const apply = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    });
    apply();
    console.log(`[Migration] Applied v${m.version} ${m.name}`);
  }

  if (backupPath && opts.onBackup) opts.onBackup(backupPath, from);
  return { from, to: pending[pending.length - 1].version, backupPath };
}
