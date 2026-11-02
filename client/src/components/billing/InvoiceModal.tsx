import React, { useState } from 'react';
import { Invoice } from '../../types/index.js';
import { formatINR, formatDateTime } from '../../lib/utils.js';
import { saveAsPdf } from '../../lib/api.js';
import { Printer, Download, X, CheckCircle, FileText, Smartphone } from 'lucide-react';

interface InvoiceModalProps {
  invoice: Invoice | null;
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ invoice, onClose }) => {
  const [format, setFormat] = useState<'thermal' | 'a4'>('thermal');

  if (!invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  const [pdfMsg, setPdfMsg] = useState('');
  const handlePdf = async () => {
    setPdfMsg('');
    try {
      const r = await saveAsPdf(`Invoice-${invoice.invoice_number}.pdf`);
      if (r === 'saved') setPdfMsg('PDF saved');
    } catch (err: any) {
      setPdfMsg(err.message || 'PDF export failed');
    }
  };

  // Business details always come from this installation's own profile (never a hard-coded placeholder).
  const inv: any = invoice;
  const business: any = inv.business || {};
  const balanceDue = inv.status === 'ISSUED' ? Math.max(0, invoice.total_paise - invoice.amount_paid_paise) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header Bar */}
        <div className="no-print p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-500" />
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">
              Invoice Generated: {invoice.invoice_number}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {/* Format toggle */}
            <div className="flex bg-slate-200 dark:bg-slate-800 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setFormat('thermal')}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  format === 'thermal'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Thermal (80mm)
              </button>
              <button
                onClick={() => setFormat('a4')}
                className={`px-3 py-1 rounded-md font-medium transition ${
                  format === 'a4'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Standard A4
              </button>
            </div>

            <button
              onClick={handlePdf}
              className="flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition"
              title="Save as PDF"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PDF</span>
            </button>
            {pdfMsg && <span className="text-[11px] text-slate-500">{pdfMsg}</span>}

            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Invoice Printable Viewport */}
        <div className="overflow-y-auto p-6 flex justify-center bg-slate-100 dark:bg-slate-950/50">
          
          {/* ===================== THERMAL RECEIPT VIEW (80mm) ===================== */}
          {format === 'thermal' && (
            <div className="print-area bg-white text-black p-5 rounded-lg shadow-md border border-slate-200 w-80 font-mono text-[11px] leading-tight select-text">
              <div className="text-center pb-3 border-b border-dashed border-gray-400 space-y-1">
                <h2 className="text-base font-extrabold uppercase tracking-wide">{business.name}</h2>
                <p className="text-[10px] text-gray-700">{[business.address, business.city].filter(Boolean).join(', ')}</p>
                {business.gstin && <p className="text-[10px] font-bold">GSTIN: {business.gstin}</p>}
                {business.phone && <p className="text-[10px]">Ph: {business.phone}</p>}
                <div className="pt-1 text-[11px] font-bold border-t border-dashed border-gray-300">
                  TAX INVOICE
                </div>
              </div>

              <div className="py-2 border-b border-dashed border-gray-400 space-y-0.5 text-[10px]">
                <div className="flex justify-between">
                  <span>Bill No: <b>{invoice.invoice_number}</b></span>
                  <span>Date: {invoice.invoice_date}</span>
                </div>
                <div className="flex justify-between">
                  <span>Customer: {invoice.customer_name}</span>
                  <span>{invoice.payment_mode}</span>
                </div>
                {invoice.customer_phone && <div>Ph: {invoice.customer_phone}</div>}
              </div>

              {/* Items List */}
              <div className="py-2 border-b border-dashed border-gray-400">
                <table className="w-full text-left text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="py-1">Item</th>
                      <th className="text-center">Qty</th>
                      <th className="text-right">Price</th>
                      <th className="text-right">Amt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {invoice.items?.map((it, idx) => (
                      <tr key={idx}>
                        <td className="py-1 pr-1 font-medium truncate max-w-[120px]">
                          {it.product_name}
                          {it.hsn_code ? <span className="block text-[8px] text-gray-500">HSN:{it.hsn_code}</span> : null}
                        </td>
                        <td className="text-center">{it.quantity}</td>
                        <td className="text-right">{formatINR(it.unit_price_paise)}</td>
                        <td className="text-right font-bold">{formatINR(it.total_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals & Tax Breakdown */}
              <div className="py-2 border-b border-dashed border-gray-400 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatINR(invoice.subtotal_paise)}</span>
                </div>
                {invoice.discount_paise > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>Discount:</span>
                    <span>-{formatINR(invoice.discount_paise)}</span>
                  </div>
                )}
                {invoice.cgst_paise > 0 && (
                  <div className="flex justify-between text-gray-600 text-[10px]">
                    <span>CGST:</span>
                    <span>{formatINR(invoice.cgst_paise)}</span>
                  </div>
                )}
                {invoice.sgst_paise > 0 && (
                  <div className="flex justify-between text-gray-600 text-[10px]">
                    <span>SGST:</span>
                    <span>{formatINR(invoice.sgst_paise)}</span>
                  </div>
                )}
                {invoice.igst_paise > 0 && (
                  <div className="flex justify-between text-gray-600 text-[10px]">
                    <span>IGST:</span>
                    <span>{formatINR(invoice.igst_paise)}</span>
                  </div>
                )}
                {inv.round_off_paise ? (
                  <div className="flex justify-between text-gray-600 text-[10px]">
                    <span>Round-off:</span>
                    <span>{formatINR(inv.round_off_paise)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-sm font-black pt-1 border-t border-gray-400">
                  <span>GRAND TOTAL:</span>
                  <span>{formatINR(invoice.total_paise)}</span>
                </div>
                <div className="flex justify-between text-[10px] text-gray-600 pt-0.5">
                  <span>Paid ({invoice.payment_mode}):</span>
                  <span>{formatINR(invoice.amount_paid_paise)}</span>
                </div>
                {balanceDue > 0 && (
                  <div className="flex justify-between text-[10px] font-bold">
                    <span>Balance due:</span>
                    <span>{formatINR(balanceDue)}</span>
                  </div>
                )}
              </div>
              {inv.status === 'CANCELLED' && <div className="py-2 text-center font-black text-red-600 border-b border-dashed border-gray-400">CANCELLED</div>}

              <div className="pt-3 text-center text-[10px] text-gray-600 space-y-0.5">
                <p className="font-semibold">{inv.footer || 'Thank you for your business!'}</p>
                {inv.terms && <p>{inv.terms}</p>}
                <p className="text-[8px] text-gray-400">Powered by Apna Billing</p>
              </div>
            </div>
          )}

          {/* ===================== STANDARD A4 TAX INVOICE VIEW ===================== */}
          {format === 'a4' && (
            <div className="print-area bg-white text-slate-900 p-8 rounded-lg shadow-md border border-slate-200 w-full font-sans text-xs leading-normal select-text">
              {/* Header */}
              <div className="flex justify-between items-start pb-4 border-b-2 border-slate-800">
                <div>
                  <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">{business.name}</h1>
                  <p className="text-slate-600">{[business.address, business.city, business.state, business.pincode].filter(Boolean).join(', ')}</p>
                  <p className="font-semibold text-slate-700">GSTIN: {business.gstin || 'Unregistered'}</p>
                  <p className="text-slate-600">Contact: {business.phone}</p>
                </div>
                <div className="text-right">
                  <div className="inline-block bg-slate-900 text-white font-bold text-sm px-3 py-1 rounded mb-2">
                    TAX INVOICE
                  </div>
                  <p className="font-bold">Invoice #: {invoice.invoice_number}</p>
                  <p className="text-slate-600">Date: {invoice.invoice_date}</p>
                  <p className="text-slate-600">Place of Supply: {inv.place_of_supply || business.state}</p>
                  {inv.due_date && balanceDue > 0 && <p className="text-slate-600">Due: {inv.due_date}</p>}
                  {inv.status === 'CANCELLED' && <p className="font-black text-red-600">CANCELLED</p>}
                </div>
              </div>

              {/* Bill To */}
              <div className="grid grid-cols-2 gap-4 py-4 border-b border-slate-200 bg-slate-50/50 p-3 rounded my-3">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Billed To</span>
                  <h4 className="font-bold text-sm text-slate-800">{invoice.customer_name}</h4>
                  {invoice.customer_phone && <p className="text-slate-600">Phone: {invoice.customer_phone}</p>}
                  {invoice.customer_gstin && <p className="font-semibold text-slate-700">GSTIN: {invoice.customer_gstin}</p>}
                  {inv.billing_address && <p className="text-slate-600">{inv.billing_address}</p>}
                  {inv.shipping_address && <p className="text-slate-500 text-[11px]">Ship to: {inv.shipping_address}</p>}
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Payment Details</span>
                  <p className="font-bold text-slate-800">Mode: {invoice.payment_mode}</p>
                  <p className="text-emerald-700 font-semibold">Status: {invoice.payment_status}</p>
                  <p className="text-slate-600">Paid: {formatINR(invoice.amount_paid_paise)}</p>
                  {balanceDue > 0 && <p className="font-bold text-slate-800">Balance due: {formatINR(balanceDue)}</p>}
                </div>
              </div>

              {/* Items Table */}
              <table className="w-full text-left border-collapse border border-slate-200 my-4 text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold">
                    <th className="p-2 border-r border-slate-200 w-8">#</th>
                    <th className="p-2 border-r border-slate-200">Item Description</th>
                    <th className="p-2 border-r border-slate-200 text-center">HSN</th>
                    <th className="p-2 border-r border-slate-200 text-center">Qty</th>
                    <th className="p-2 border-r border-slate-200 text-right">Rate</th>
                    <th className="p-2 border-r border-slate-200 text-center">GST %</th>
                    <th className="p-2 border-r border-slate-200 text-right">Tax</th>
                    <th className="p-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {invoice.items?.map((it, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="p-2 border-r border-slate-200 text-slate-400">{idx + 1}</td>
                      <td className="p-2 border-r border-slate-200 font-medium">{it.product_name}</td>
                      <td className="p-2 border-r border-slate-200 text-center text-slate-500 font-mono text-[11px]">{it.hsn_code || '-'}</td>
                      <td className="p-2 border-r border-slate-200 text-center font-bold">{it.quantity}</td>
                      <td className="p-2 border-r border-slate-200 text-right">{formatINR(it.unit_price_paise)}</td>
                      <td className="p-2 border-r border-slate-200 text-center text-slate-600">{it.tax_rate}%</td>
                      <td className="p-2 border-r border-slate-200 text-right">{formatINR(it.tax_paise)}</td>
                      <td className="p-2 text-right font-bold">{formatINR(it.total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Summary and Signature */}
              <div className="grid grid-cols-2 gap-8 pt-4">
                <div className="space-y-2">
                  <div className="text-[11px] bg-slate-50 p-2.5 rounded border border-slate-200">
                    <span className="font-bold text-slate-700 block mb-1">Terms & Conditions:</span>
                    <p className="text-slate-500 text-[10px] whitespace-pre-line">{inv.terms || 'Goods once sold will not be taken back without the original invoice.'}</p>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs bg-slate-50 p-3 rounded border border-slate-200">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="font-semibold">{formatINR(invoice.subtotal_paise)}</span>
                  </div>
                  {invoice.discount_paise > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount:</span>
                      <span>-{formatINR(invoice.discount_paise)}</span>
                    </div>
                  )}
                  {invoice.igst_paise > 0 ? (
                    <div className="flex justify-between text-slate-600">
                      <span>IGST:</span>
                      <span>{formatINR(invoice.igst_paise)}</span>
                    </div>
                  ) : (<>
                    <div className="flex justify-between text-slate-600">
                      <span>CGST:</span>
                      <span>{formatINR(invoice.cgst_paise)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>SGST:</span>
                      <span>{formatINR(invoice.sgst_paise)}</span>
                    </div>
                  </>)}
                  {inv.round_off_paise ? (
                    <div className="flex justify-between text-slate-600">
                      <span>Round-off:</span>
                      <span>{formatINR(inv.round_off_paise)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between border-t-2 border-slate-900 pt-2 text-sm font-black text-slate-900">
                    <span>Invoice Total:</span>
                    <span>{formatINR(invoice.total_paise)}</span>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-200 flex justify-between items-end text-[11px] text-slate-500">
                <div>E. & O.E.</div>
                <div className="text-right">
                  <div className="font-bold text-slate-800">For {business.name}</div>
                  <div className="h-10"></div>
                  <div className="border-t border-slate-400 pt-1 text-[10px]">Authorized Signatory</div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
