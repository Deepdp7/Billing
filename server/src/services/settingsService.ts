import { db } from '../db/connection.js';

export interface BusinessSettings {
  allowNegativeStock: boolean;
  roundOffEnabled: boolean;
  pricesIncludeTaxDefault: boolean;
  enforceCreditLimit: boolean;
  defaultCreditDays: number;
  invoiceTerms: string;
  invoiceFooter: string;
}

const DEFAULTS: Record<keyof BusinessSettings, string> = {
  allowNegativeStock: '0',
  roundOffEnabled: '1',
  pricesIncludeTaxDefault: '0',
  enforceCreditLimit: '1',
  defaultCreditDays: '30',
  invoiceTerms: 'Goods once sold will not be taken back without the original invoice.',
  invoiceFooter: 'Thank you for your business!',
};

const BOOL_KEYS = new Set(['allowNegativeStock', 'roundOffEnabled', 'pricesIncludeTaxDefault', 'enforceCreditLimit']);

export function getBusinessSettings(businessId: string): BusinessSettings {
  const rows = db.prepare('SELECT key, value FROM app_settings WHERE business_id = ?').all(businessId) as Array<{ key: string; value: string }>;
  const map: Record<string, string> = { ...DEFAULTS };
  for (const r of rows) if (r.key in DEFAULTS) map[r.key] = r.value;
  return {
    allowNegativeStock: map.allowNegativeStock === '1',
    roundOffEnabled: map.roundOffEnabled === '1',
    pricesIncludeTaxDefault: map.pricesIncludeTaxDefault === '1',
    enforceCreditLimit: map.enforceCreditLimit === '1',
    defaultCreditDays: Number(map.defaultCreditDays) || 0,
    invoiceTerms: map.invoiceTerms,
    invoiceFooter: map.invoiceFooter,
  };
}

export function updateBusinessSettings(businessId: string, input: Partial<BusinessSettings>): BusinessSettings {
  const upsert = db.prepare(`
    INSERT INTO app_settings (business_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(input)) {
      if (!(key in DEFAULTS) || value === undefined) continue;
      const stored = BOOL_KEYS.has(key) ? (value ? '1' : '0') : String(value);
      upsert.run(businessId, key, stored);
    }
  });
  tx();
  return getBusinessSettings(businessId);
}
