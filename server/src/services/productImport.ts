/**
 * Reading a product list from Excel (.xlsx) or CSV for Products → Import Excel. The columns of the Export (or common
 * names for them) in any order, one product per row; the first row with a "Name" column is the header.
 */

export const IMPORT_FIELDS = {
  name: ['name', 'product name', 'product', 'item', 'item name'],
  sku: ['sku', 'code', 'item code', 'product code'],
  barcode: ['barcode', 'bar code', 'ean'],
  category: ['category'],
  unit: ['unit', 'uom'],
  hsn: ['hsn/sac', 'hsn', 'sac', 'hsn code', 'hsn/sac code'],
  gst: ['gst %', 'gst', 'gst rate', 'tax %', 'tax rate', 'tax'],
  purchase: ['purchase price (₹)', 'purchase price', 'purchase', 'cost price', 'cost'],
  sale: ['selling price (₹)', 'selling price', 'sale price (₹)', 'sale price', 'price', 'rate'],
  mrp: ['mrp (₹)', 'mrp'],
  stock: ['stock', 'quantity', 'qty', 'stock quantity', 'opening stock'],
  low: ['low stock level', 'low stock', 'reorder level', 'minimum stock'],
} as const;

export type ImportField = keyof typeof IMPORT_FIELDS;
export interface ImportRow { row: number; values: Partial<Record<ImportField, string>> }

/** Text of an Excel cell, whatever it holds (number, date, formula result, rich text, hyperlink) */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as any;
    if (o.result !== undefined) return cellText(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => t.text).join('');
    if (o.text !== undefined) return cellText(o.text);
    return '';
  }
  return String(v).trim();
}

/** RFC 4180 CSV (quoted fields, "" escapes, CRLF or LF); a UTF-8 BOM is ignored */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field.trim()); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field.trim()); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

/** All rows of the first sheet (Excel) or the file (CSV), as text */
export async function readSheet(buffer: Buffer): Promise<string[][]> {
  const isXlsx = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b; // a zip file: PK
  if (!isXlsx) return parseCsv(buffer.toString('utf8'));
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (r) => {
    const values = r.values as unknown[]; // index 0 is unused by ExcelJS
    rows.push(values.slice(1).map(cellText));
  });
  return rows;
}

/** Finds the header row and maps every following row to fields; `missing` lists required columns not found */
export function mapRows(table: string[][]): { rows: ImportRow[]; missing: string[] } {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const headerAt = table.findIndex((r) => r.some((c) => (IMPORT_FIELDS.name as readonly string[]).includes(norm(c))));
  if (headerAt < 0) return { rows: [], missing: ['Name'] };
  const columns = new Map<ImportField, number>();
  table[headerAt].forEach((c, i) => {
    const h = norm(c);
    for (const [field, names] of Object.entries(IMPORT_FIELDS) as [ImportField, readonly string[]][]) {
      if (!columns.has(field) && names.includes(h)) columns.set(field, i);
    }
  });
  const rows: ImportRow[] = [];
  for (let i = headerAt + 1; i < table.length; i++) {
    const values: ImportRow['values'] = {};
    for (const [field, col] of columns) values[field] = (table[i][col] ?? '').trim();
    if (Object.values(values).some((v) => v)) rows.push({ row: i + 1, values });
  }
  return { rows, missing: columns.has('sale') ? [] : ['Selling Price'] };
}
