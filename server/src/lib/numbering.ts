import { db } from '../db/connection.js';
import { seriesTag } from '../sync/syncEngine.js';

/**
 * The next document number with this prefix (CN-1001, DN-1001, BOM-001, …): one above the highest already used, so a
 * number is never handed out twice, even after documents are deleted. `table` and `column` are code constants.
 * On a second computer of the same account the prefix carries that computer's letter (CN-B1001), so two computers
 * never hand out the same number.
 */
export function nextDocumentNumber(table: string, column: string, businessId: string, basePrefix: string, first: number, pad = 0): string {
  const prefix = `${basePrefix}${seriesTag()}`;
  const rows = db.prepare(`SELECT ${column} AS n FROM ${table} WHERE business_id = ? AND ${column} LIKE ?`)
    .all(businessId, `${prefix}%`) as Array<{ n: string }>;
  let highest = first - 1;
  for (const { n } of rows) {
    const rest = n.slice(prefix.length);
    if (/^\d+$/.test(rest)) highest = Math.max(highest, Number(rest));
  }
  return `${prefix}${String(highest + 1).padStart(pad, '0')}`;
}
