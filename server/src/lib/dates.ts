/**
 * Calendar date in the machine's local timezone (YYYY-MM-DD).
 * `toISOString()` is UTC, which dates invoices made between 00:00 and 05:30 IST to the previous day.
 */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
