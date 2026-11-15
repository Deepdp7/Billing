import { Knex } from 'knex';
import crypto from 'crypto';
import { FEATURES, FEATURE_KEYS, TRIAL_DEFAULT_FEATURES } from './features.js';

/**
 * Schema migrations, portable across PostgreSQL (production) and SQLite (development/tests).
 * Timestamps are ISO-8601 UTC strings so comparisons behave identically on both engines.
 */
const ts = (t: Knex.CreateTableBuilder, name: string) => t.string(name, 32);

const migrations: Record<string, { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void> }> = {
  '001_initial': {
    async up(k) {
      await k.schema.createTable('admin_users', (t) => {
        t.string('id', 36).primary();
        t.string('email', 150).notNullable().unique();
        t.string('name', 120).notNullable();
        t.string('password_hash', 100).notNullable();
        t.string('role', 20).notNullable().defaultTo('ADMIN'); // OWNER, ADMIN, SUPPORT, VIEWER
        t.string('status', 20).notNullable().defaultTo('ACTIVE');
        t.string('totp_secret', 64);
        t.boolean('totp_enabled').notNullable().defaultTo(false);
        ts(t, 'last_login_at');
        ts(t, 'created_at').notNullable();
      });

      await k.schema.createTable('admin_sessions', (t) => {
        t.string('id', 36).primary();
        t.string('admin_id', 36).notNullable().references('admin_users.id').onDelete('CASCADE');
        t.string('token_hash', 64).notNullable().unique();
        ts(t, 'expires_at').notNullable();
        ts(t, 'revoked_at');
        t.string('ip', 64);
        t.string('user_agent', 255);
        ts(t, 'created_at').notNullable();
      });

      await k.schema.createTable('customers', (t) => {
        t.string('id', 36).primary();
        t.string('name', 150).notNullable();
        t.string('business_name', 150);
        t.string('email', 150).index();
        t.string('phone', 30);
        t.text('notes');
        t.string('status', 20).notNullable().defaultTo('ACTIVE');
        ts(t, 'created_at').notNullable();
        ts(t, 'updated_at').notNullable();
      });

      await k.schema.createTable('plans', (t) => {
        t.string('id', 36).primary();
        t.string('code', 40).notNullable().unique();
        t.string('name', 100).notNullable();
        t.integer('duration_days'); // null = lifetime
        t.integer('price_paise').notNullable().defaultTo(0);
        t.integer('max_devices').notNullable().defaultTo(1);
        t.boolean('is_trial').notNullable().defaultTo(false);
        t.text('features_json').notNullable(); // JSON array of feature keys, or ["*"]
        t.boolean('is_active').notNullable().defaultTo(true);
        t.integer('sort_order').notNullable().defaultTo(0);
        ts(t, 'created_at').notNullable();
      });

      await k.schema.createTable('licenses', (t) => {
        t.string('id', 36).primary();
        t.string('license_key', 40).notNullable().unique();
        t.string('customer_id', 36).notNullable().references('customers.id').onDelete('CASCADE');
        t.string('plan_id', 36).notNullable().references('plans.id');
        t.string('type', 10).notNullable(); // TRIAL, PAID
        t.string('status', 20).notNullable().defaultTo('ACTIVE'); // ACTIVE, SUSPENDED, REVOKED (EXPIRED is derived)
        ts(t, 'starts_at').notNullable();
        ts(t, 'expires_at'); // null = lifetime
        t.integer('max_devices').notNullable().defaultTo(1);
        t.integer('max_activations'); // null = unlimited re-activations
        t.integer('activations_count').notNullable().defaultTo(0);
        t.string('payment_reference', 120);
        t.integer('payment_amount_paise');
        t.string('payment_method', 40);
        ts(t, 'paid_at');
        t.text('notes');
        ts(t, 'created_at').notNullable();
        ts(t, 'updated_at').notNullable();
        t.index(['customer_id']);
        t.index(['status', 'expires_at']);
      });

      await k.schema.createTable('installations', (t) => {
        t.string('id', 36).primary();
        t.string('license_id', 36).notNullable().references('licenses.id').onDelete('CASCADE');
        t.string('customer_id', 36).notNullable().references('customers.id').onDelete('CASCADE');
        t.string('device_name', 100);
        t.string('os', 100);
        t.string('app_version', 30);
        t.string('fingerprint_hash', 64).index();
        t.string('secret_hash', 64).notNullable();
        t.string('pending_secret_hash', 64);
        t.boolean('rotate_requested').notNullable().defaultTo(false);
        t.string('status', 20).notNullable().defaultTo('ACTIVE'); // ACTIVE, SUSPENDED, DEACTIVATED
        t.boolean('force_revalidate').notNullable().defaultTo(false);
        ts(t, 'installed_at').notNullable();
        ts(t, 'activated_at').notNullable();
        ts(t, 'last_seen_at');
        ts(t, 'last_verified_at');
        t.string('last_ip', 64);
        ts(t, 'deactivated_at');
        t.index(['license_id', 'status']);
        t.index(['customer_id']);
      });

      await k.schema.createTable('features', (t) => {
        t.string('key', 40).primary();
        t.string('name', 100).notNullable();
        t.string('category', 30).notNullable();
        t.string('description', 255);
      });

      await k.schema.createTable('feature_overrides', (t) => {
        t.string('id', 36).primary();
        t.string('scope', 20).notNullable(); // GLOBAL, CUSTOMER, LICENSE, INSTALLATION
        t.string('scope_id', 36).notNullable().defaultTo(''); // '' for GLOBAL
        t.string('feature_key', 40).notNullable().references('features.key');
        t.boolean('enabled').notNullable();
        ts(t, 'expires_at');
        t.string('reason', 255);
        t.string('created_by', 36);
        ts(t, 'created_at').notNullable();
        t.unique(['scope', 'scope_id', 'feature_key']);
      });

      await k.schema.createTable('license_events', (t) => {
        t.string('id', 36).primary();
        t.string('license_id', 36).references('licenses.id').onDelete('CASCADE');
        t.string('installation_id', 36);
        t.string('customer_id', 36);
        t.string('event_type', 40).notNullable();
        t.text('details_json');
        t.string('actor', 60).notNullable(); // admin id, or 'client' / 'system'
        ts(t, 'created_at').notNullable();
        t.index(['license_id', 'created_at']);
        t.index(['event_type', 'created_at']);
      });

      await k.schema.createTable('usage_daily', (t) => {
        t.string('installation_id', 36).notNullable().references('installations.id').onDelete('CASCADE');
        t.string('feature_key', 40).notNullable();
        t.string('usage_date', 10).notNullable();
        t.integer('count').notNullable().defaultTo(0);
        ts(t, 'first_used_at');
        ts(t, 'last_used_at');
        ts(t, 'received_at').notNullable();
        t.primary(['installation_id', 'feature_key', 'usage_date']);
        t.index(['feature_key', 'usage_date']);
      });

      await k.schema.createTable('notices', (t) => {
        t.string('id', 36).primary();
        t.string('title', 150).notNullable();
        t.text('message').notNullable();
        t.string('level', 20).notNullable().defaultTo('INFO'); // INFO, WARNING, CRITICAL, UPDATE
        t.string('target_scope', 20).notNullable().defaultTo('ALL'); // ALL, CUSTOMER, LICENSE, INSTALLATION
        t.string('target_id', 36);
        ts(t, 'starts_at').notNullable();
        ts(t, 'ends_at');
        t.string('created_by', 36);
        ts(t, 'created_at').notNullable();
      });

      await k.schema.createTable('settings', (t) => {
        t.string('key', 60).primary();
        t.text('value').notNullable();
        ts(t, 'updated_at').notNullable();
      });

      await k.schema.createTable('audit_logs', (t) => {
        t.string('id', 36).primary();
        t.string('admin_id', 36);
        t.string('admin_email', 150);
        t.string('action', 60).notNullable();
        t.string('entity_type', 40).notNullable();
        t.string('entity_id', 36);
        t.text('details_json');
        t.string('ip', 64);
        ts(t, 'created_at').notNullable();
        t.index(['created_at']);
        t.index(['entity_type', 'entity_id']);
      });

      // ---- Seed reference data ----
      const now = new Date().toISOString();
      await k('features').insert(FEATURES.map((f) => ({ key: f.key, name: f.name, category: f.category, description: f.description })));
      const plan = (code: string, name: string, days: number | null, maxDevices: number, features: string[], isTrial: boolean, sort: number) => ({
        id: crypto.randomUUID(), code, name, duration_days: days, price_paise: 0, max_devices: maxDevices, is_trial: isTrial,
        features_json: JSON.stringify(features), is_active: true, sort_order: sort, created_at: now,
      });
      await k('plans').insert([
        plan('TRIAL', 'Free Trial', 7, 1, TRIAL_DEFAULT_FEATURES, true, 0),
        plan('MONTH_1', '1 Month', 30, 1, ['*'], false, 1),
        plan('MONTH_3', '3 Months', 90, 1, ['*'], false, 2),
        plan('MONTH_6', '6 Months', 180, 1, ['*'], false, 3),
        plan('YEAR_1', '1 Year', 365, 1, ['*'], false, 4),
        plan('YEAR_2', '2 Years', 730, 1, ['*'], false, 5),
        plan('LIFETIME', 'Lifetime', null, 1, ['*'], false, 6),
      ]);
      const settings: Record<string, string> = {
        trial_days: '7',
        trials_enabled: '1',
        trial_one_per_email: '1',
        trial_one_per_device: '1',
        offline_grace_days: '7',
        latest_version: '1.1.0',
        min_supported_version: '1.0.0',
        update_url: '',
        update_message: '',
      };
      await k('settings').insert(Object.entries(settings).map(([key, value]) => ({ key, value, updated_at: now })));
      void FEATURE_KEYS;
    },
    async down(k) {
      for (const t of ['audit_logs', 'settings', 'notices', 'usage_daily', 'license_events', 'feature_overrides', 'features',
        'installations', 'licenses', 'plans', 'customers', 'admin_sessions', 'admin_users']) {
        await k.schema.dropTableIfExists(t);
      }
    },
  },
  '002_app_releases': {
    // Desktop-app versions uploaded through the Admin Panel ("App Updates").
    async up(k) {
      await k.schema.createTable('app_releases', (t) => {
        t.string('id', 36).primary();
        t.string('version', 30).notNullable().unique();
        t.string('file_name', 200).notNullable();
        t.bigInteger('size_bytes').notNullable();
        t.string('sha256', 64).notNullable();
        t.text('signature').notNullable();
        t.text('notes');
        t.string('status', 20).notNullable().defaultTo('UPLOADED'); // UPLOADED, PUBLISHED, SUPERSEDED
        t.string('uploaded_by', 150);
        ts(t, 'uploaded_at').notNullable();
        ts(t, 'published_at');
      });
    },
    async down(k) {
      await k.schema.dropTableIfExists('app_releases');
    },
  },
};

export const migrationSource = {
  getMigrations: async () => Object.keys(migrations).sort(),
  getMigrationName: (m: string) => m,
  getMigration: async (m: string) => migrations[m],
};

export async function migrateLatest(k: Knex) {
  return k.migrate.latest({ migrationSource });
}
