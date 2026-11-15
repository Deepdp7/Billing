import { Response } from 'express';
import { localDate } from '../lib/dates.js';

export interface Column {
  key: string;
  label: string;
  /** Value is integer paise; exported as rupees with 2 decimals. */
  money?: boolean;
}

function cellValue(row: Record<string, any>, col: Column): string | number | null {
  const v = row[col.key];
  if (v === null || v === undefined) return null;
  if (col.money) return Math.round(Number(v)) / 100;
  return v;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralise spreadsheet formula injection from user-entered text.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: Column[], rows: Record<string, any>[]): string {
  const lines = [columns.map((c) => csvEscape(c.label)).join(',')];
  for (const r of rows) {
    lines.push(columns.map((c) => {
      const v = cellValue(r, c);
      return csvEscape(typeof v === 'number' && c.money ? v.toFixed(2) : v);
    }).join(','));
  }
  // BOM so Excel opens UTF-8 (₹, regional names) correctly.
  return '﻿' + lines.join('\r\n');
}

export async function toXlsx(sheetName: string, columns: Column[], rows: Record<string, any>[]): Promise<Buffer> {
  // Loaded on the first Excel export, not at start-up: exceljs and its zip libraries are the slowest part of starting
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Apna Billing';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  ws.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.min(40, Math.max(12, c.label.length + 4)),
    style: c.money ? { numFmt: '#,##0.00' } : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) {
    const out: Record<string, unknown> = {};
    for (const c of columns) out[c.key] = cellValue(r, c);
    ws.addRow(out);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Send rows as a CSV or XLSX download. */
export function sendTable(res: Response, format: string, baseName: string, columns: Column[], rows: Record<string, any>[]): void {
  const fileBase = `${baseName}-${localDate()}`;
  if (format === 'xlsx') {
    toXlsx(baseName, columns, rows)
      .then((buf) => {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
        res.send(buf);
      })
      .catch((err) => {
        console.error('[Export] XLSX failed', err);
        res.status(500).json({ code: 'EXPORT_FAILED', message: 'Could not generate Excel file' });
      });
    return;
  }
  if (format === 'json') {
    res.json({ columns, rows });
    return;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
  res.send(toCsv(columns, rows));
}
