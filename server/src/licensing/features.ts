/**
 * Remotely controllable features. Keys must match the license server catalog
 * (license-server/src/features.ts); a test asserts the two lists are identical.
 *
 * Not listed (always available, so customers can never be locked out of their own data):
 * login, business profile/settings, backups & data export to JSON, license screen, support, notifications.
 */
export const FEATURE_KEYS = [
  'dashboard',
  'billing',
  'invoices',
  'customers',
  'products',
  'inventory',
  'purchases',
  'expenses',
  'quotations',
  'returns',
  'staff',
  'reports_basic',
  'reports_advanced',
  'inventory_analytics',
  'data_export',
  'pdf_export',
  'loyalty',
  'branches',
  'barcodes',
  'audit_logs',
  'restaurant',
  'pharmacy',
  'clothing',
  'manufacturing',
  'school',
  'wholesale',
  'services',
  'online_store',
] as const;

export type FeatureKey = typeof FEATURE_KEYS[number];

const BASIC_REPORTS = new Set(['sales', 'invoices', 'profit-loss', 'expenses', 'purchases']);

/** Lookup lists used by many screens (POS needs products and customers even if their management screens are disabled). */
const LOOKUP_GET = [/^\/products\/?$/, /^\/categories\/?$/, /^\/customers\/?$/, /^\/suppliers\/?$/, /^\/expenses\/categories$/];

/**
 * Map a request under /api/v1/app to the feature(s) it requires. All listed features must be enabled.
 * Returns [] for always-available endpoints.
 */
export function featuresForRequest(method: string, path: string): FeatureKey[] {
  const p = path.replace(/\/+$/, '') || '/';
  const isRead = method === 'GET';

  // Backups and the full-data export are never gated: customers must always be able to take their data.
  if (/^\/backups(\/|$)/.test(p)) return [];
  if (/\/export$/.test(p)) {
    // Exports need data_export plus the owning module (evaluated as a non-lookup request).
    const base = featuresForRequest('EXPORT', p.replace(/\/export$/, ''));
    return [...new Set<FeatureKey>(['data_export', ...base])];
  }
  if (isRead && LOOKUP_GET.some((re) => re.test(p))) return [];

  const rules: Array<[RegExp, FeatureKey | ((m: RegExpMatchArray) => FeatureKey)]> = [
    [/^\/business\/stats/, 'dashboard'],
    [/^\/billing\/(checkout|held)/, 'billing'],
    [/^\/cash-register/, 'billing'],
    [/^\/billing\/(invoices|payments)/, 'invoices'],
    [/^\/(products|categories)/, 'products'],
    [/^\/inventory\/valuation/, 'inventory_analytics'],
    [/^\/inventory/, 'inventory'],
    [/^\/customers/, 'customers'],
    [/^\/(suppliers|purchases|purchase-orders)/, 'purchases'],
    [/^\/expenses/, 'expenses'],
    [/^\/accounting\/profit-loss/, 'reports_basic'],
    [/^\/accounting\/gst-summary/, 'reports_advanced'],
    [/^\/reports\/inventory/, 'inventory_analytics'],
    [/^\/reports\/([a-z-]+)/, (m) => (BASIC_REPORTS.has(m[1]) ? 'reports_basic' : 'reports_advanced')],
    [/^\/reports\/?$/, 'reports_basic'],
    [/^\/staff/, 'staff'],
    [/^\/quotations/, 'quotations'],
    [/^\/returns/, 'returns'],
    [/^\/loyalty/, 'loyalty'],
    [/^\/(branches|transfers)/, 'branches'],
    [/^\/audit/, 'audit_logs'],
    [/^\/verticals\/restaurant/, 'restaurant'],
    [/^\/verticals\/pharmacy/, 'pharmacy'],
    [/^\/verticals\/clothing/, 'clothing'],
    [/^\/manufacturing/, 'manufacturing'],
    [/^\/verticals\/school/, 'school'],
    [/^\/verticals\/wholesale/, 'wholesale'],
    [/^\/verticals\/service/, 'services'],
    [/^\/store/, 'online_store'],
  ];
  for (const [re, f] of rules) {
    const m = p.match(re);
    if (m) return [typeof f === 'function' ? f(m) : f];
  }
  return [];
}
