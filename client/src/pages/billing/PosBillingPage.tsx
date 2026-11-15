import React, { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api.js';
import { Product, Customer, CartItem, PaymentMode, Invoice } from '../../types/index.js';
import { formatINR, paiseToRupees, rupeesToPaise } from '../../lib/utils.js';
import { InvoiceModal } from '../../components/billing/InvoiceModal.js';
import { calculateInvoice } from '../../lib/invoiceCalc.js';
import { 
  Search, Barcode, Trash2, Plus, Minus, CreditCard, 
  Banknote, QrCode, PauseCircle, PlayCircle, Check, 
  AlertCircle, Sparkles, UserPlus 
} from 'lucide-react';
import { Select } from '../../components/ui/Select.js';
import { confirmDialog, promptDialog } from '../../components/ui/dialogs.js';
import { findProductByCode, openWithScan, scanBeep, takeScanIntent, useScanner } from '../../lib/scanner.js';

import { useLiveRefresh } from '../../lib/live.js';
export const PosBillingPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  
  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [billDiscountRupees, setBillDiscountRupees] = useState<string>('0');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
  
  // Customers
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('Walk-in Customer');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  
  // Held Bills (persisted on the local server so they survive restarts)
  const [heldBills, setHeldBills] = useState<Array<{ id: string; time: string; cart: CartItem[]; customerName: string; payload: any }>>([]);

  // Payment details: amount paid now (blank = full), optional split across two modes
  const [amountPaidRupees, setAmountPaidRupees] = useState<string>('');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitMode, setSplitMode] = useState<PaymentMode>('UPI');
  const [splitRupees, setSplitRupees] = useState<string>('');
  const [settings, setSettings] = useState<{ roundOffEnabled: boolean; pricesIncludeTaxDefault: boolean } | null>(null);
  // Idempotency key: a retried or double-clicked checkout never creates two invoices.
  const requestIdRef = useRef<string>(crypto.randomUUID());
  
  // Invoicing & Modal
  const [createdInvoice, setCreatedInvoice] = useState<Invoice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Load Catalog & Customers
  useEffect(() => {
    loadCatalog();
    loadCustomers();
    loadHeldBills();
    api.getBusinessSettings().then((r) => setSettings(r.settings)).catch(() => undefined);
  }, []);

  // Another computer of this account changed something: the lists reload quietly
  useLiveRefresh(() => { void loadHeldBills(true); void loadCatalog(true); void loadCustomers(true); });
  const loadHeldBills = async (quiet?: unknown) => {
    try {
      const res = await api.getHeldBills();
      setHeldBills(res.data.map((b: any) => ({
        id: b.id,
        time: new Date(b.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        cart: b.payload.cart || [],
        customerName: b.customer_name || 'Walk-in',
        payload: b.payload,
      })));
    } catch (err) {
      console.error('Failed to load held bills', err);
    }
  };

  const loadCatalog = async (quiet?: unknown) => {
    try {
      const [prodRes, catRes] = await Promise.all([
        api.getProducts({ limit: 200 }),
        api.getCategories(),
      ]);
      setProducts(prodRes.data);
      setCategories(catRes.data);
    } catch (err) {
      console.error('Failed to load products', err);
    }
  };

  const loadCustomers = async (quiet?: unknown) => {
    try {
      const res = await api.getCustomers();
      setCustomers(res.data);
    } catch (err) {
      console.error('Failed to load customers', err);
    }
  };

  // Add product to cart
  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.productId === product.id);
      if (existingIndex > -1) {
        const next = [...prev];
        next[existingIndex].quantity += 1;
        return next;
      }
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          hsnCode: product.hsn_code,
          unit: product.unit,
          quantity: 1,
          unitPricePaise: product.sale_price_paise,
          discountPaise: 0,
          taxRate: product.tax_rate,
          stockAvailable: product.stock_quantity,
        },
      ];
    });
  };

  // A scanned (or typed) barcode / SKU: add the product to the bill. Products beyond the loaded list are looked up;
  // a code that is no product yet can be added as one.
  const addByCode = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    let matched: Product | null = products.find((p) => p.barcode === code || p.sku?.toLowerCase() === code.toLowerCase()) || null;
    if (!matched) matched = await findProductByCode(code).catch(() => null);
    if (matched) {
      scanBeep(true);
      addToCart(matched);
      setBarcodeInput('');
      return;
    }
    scanBeep(false);
    if (await confirmDialog(`No product has the code ${code}. Add it as a new product?`, { title: 'Unknown barcode', confirmText: 'Add product', cancelText: 'Not now' })) {
      openWithScan('products', { kind: 'new-product', code });
    }
  };
  useScanner((code) => { void addByCode(code); return true; });
  // Opened from a scan elsewhere ("Sell in POS")
  useEffect(() => {
    const intent = takeScanIntent('sell');
    if (intent) void addByCode(intent.code);
  }, []);

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void addByCode(barcodeInput);
  };

  const updateQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) {
      removeFromCart(index);
      return;
    }
    setCart((prev) => {
      const next = [...prev];
      next[index].quantity = newQty;
      return next;
    });
  };

  const updateDiscount = (index: number, discountRupees: number) => {
    setCart((prev) => {
      const next = [...prev];
      next[index].discountPaise = rupeesToPaise(Math.max(0, discountRupees));
      return next;
    });
  };

  const removeFromCart = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const pickCustomer = (id: string) => {
    setSelectedCustomerId(id);
    if (!id) {
      setCustomerName('Walk-in Customer');
      setCustomerPhone('');
      return;
    }
    const match = customers.find((c) => c.id === id);
    if (!match) return;
    setCustomerName(match.name);
    setCustomerPhone(match.phone || '');
  };

  const clearCart = () => {
    setCart([]);
    setBillDiscountRupees('0');
    setAmountPaidRupees('');
    setSplitEnabled(false);
    setSplitRupees('');
  };

  // Hold Bill
  const holdBill = async () => {
    if (cart.length === 0) return;
    try {
      await api.holdBill({
        customerName: customerName || 'Walk-in',
        payload: { cart, customerName, customerPhone, selectedCustomerId, billDiscountRupees },
      });
      clearCart();
      loadHeldBills();
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not hold bill');
    }
  };

  // Resume Bill
  const resumeBill = async (holdId: string) => {
    const itemToResume = heldBills.find((b) => b.id === holdId);
    if (!itemToResume) return;
    const p = itemToResume.payload || {};
    setCart(itemToResume.cart);
    setCustomerName(p.customerName || itemToResume.customerName);
    setCustomerPhone(p.customerPhone || '');
    setSelectedCustomerId(p.selectedCustomerId || '');
    setBillDiscountRupees(p.billDiscountRupees || '0');
    try {
      await api.deleteHeldBill(holdId);
    } finally {
      loadHeldBills();
    }
  };

  // Calculations — same calculator as the server, so the preview equals the saved invoice.
  const subtotalPaise = cart.reduce((acc, it) => acc + Math.round(it.unitPricePaise * it.quantity), 0);
  const billDiscountPaise = rupeesToPaise(parseFloat(billDiscountRupees) || 0);
  let calc: ReturnType<typeof calculateInvoice> | null = null;
  let calcError = '';
  if (cart.length > 0) {
    try {
      calc = calculateInvoice(
        cart.map((it) => ({ quantity: it.quantity, unitPricePaise: it.unitPricePaise, discountPaise: it.discountPaise, taxRate: it.taxRate })),
        { billDiscountPaise, roundOff: settings?.roundOffEnabled ?? true, pricesIncludeTax: settings?.pricesIncludeTaxDefault ?? false },
      );
    } catch (err: any) {
      calcError = err.message;
    }
  }
  const totalTaxPaise = calc?.taxPaise ?? 0;
  const roundOffPaise = calc?.roundOffPaise ?? 0;
  const grandTotalPaise = calc?.totalPaise ?? 0;

  // Payment preview
  const enteredPaidPaise = amountPaidRupees.trim() === '' ? null : rupeesToPaise(parseFloat(amountPaidRupees) || 0);
  const splitPaise = splitEnabled ? rupeesToPaise(parseFloat(splitRupees) || 0) : 0;
  const primaryPaise = paymentMode === 'CREDIT' ? 0 : (enteredPaidPaise ?? Math.max(0, grandTotalPaise - splitPaise));
  const tenderedPaise = primaryPaise + splitPaise;
  const changeDuePaise = paymentMode === 'CASH' ? Math.max(0, tenderedPaise - grandTotalPaise) : 0;
  const balanceDuePaise = Math.max(0, grandTotalPaise - tenderedPaise);

  /**
   * Who the bill is for, when the cashier typed a name / phone instead of picking a customer from the list.
   * - Paid in full (Cash, UPI, Card): offer to save them to Customers (or to add the bill to their existing account
   *   when the phone matches). No is fine: the bill keeps the typed name and phone only.
   * - Money left on credit: the bill must belong to a customer account, so ask (name first, if none was typed), then
   *   use their existing account or add them. No cancels the save.
   * Returns the customer to bill, or null when the bill should not be saved.
   */
  const chooseCustomer = async (): Promise<{ id?: string; name: string } | null> => {
    const typedName = customerName.trim();
    const walkIn = !typedName || /^walk-?in( customer)?$/i.test(typedName);
    const phone = customerPhone.trim();
    const onCredit = balanceDuePaise > 0;
    if (selectedCustomerId || (!onCredit && walkIn)) return { id: selectedCustomerId || undefined, name: typedName || 'Walk-in Customer' };
    const owed = formatINR(balanceDuePaise);
    const justThisBill = { name: typedName, id: undefined };

    let name = typedName;
    if (walkIn) {
      const asked = await promptDialog(`${owed} of this bill stays on credit, so it is kept against the customer's name in Customers.`, {
        title: 'Who is this credit for?', placeholder: 'Customer name', required: true, confirmText: 'Continue',
      });
      if (!asked?.trim()) return null;
      name = asked.trim();
      setCustomerName(name);
    }

    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 6) {
      const found = (await api.getCustomers({ search: digits.slice(-10), limit: 20 })).data
        .find((c: any) => String(c.phone || '').replace(/\D/g, '').slice(-10) === digits.slice(-10));
      if (found) {
        const ok = await confirmDialog(onCredit
          ? `${found.name} (${found.phone}) is already in your Customers. Put ${owed} on their account?`
          : `${found.name} (${found.phone}) is already in your Customers. Add this bill to their account?`, {
          title: 'Existing customer', confirmText: onCredit ? 'Yes, save bill' : 'Yes, add to their account', cancelText: onCredit ? 'No' : 'No, just this bill',
        });
        if (!ok) return onCredit ? null : justThisBill;
        setSelectedCustomerId(found.id);
        setCustomerName(found.name);
        return { id: found.id, name: found.name };
      }
    }

    const who = `${name}${phone ? ` (${phone})` : ''}`;
    const ok = await confirmDialog(onCredit
      ? `${who} is not in your Customers yet. ${owed} of this bill stays on credit, so ${name} will be added to Customers to keep track of what they owe.`
      : `${who} is not in your Customers. Save them, so their details and bills are there next time?`, {
      title: onCredit ? 'Add new customer?' : 'Save this customer?',
      confirmText: onCredit ? 'Yes, add & save bill' : 'Yes, save customer',
      cancelText: onCredit ? 'No' : 'No, just this bill',
    });
    if (!ok) return onCredit ? null : justThisBill;
    const { customer } = await api.createCustomer({ name, phone: phone || undefined });
    setSelectedCustomerId(customer.id);
    setCustomers((list) => [customer, ...list]);
    return { id: customer.id, name: customer.name };
  };

  // Checkout Save
  const handleCheckout = async () => {
    if (cart.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const customer = await chooseCustomer();
      if (!customer) return;
      const payload = {
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customerPhone || undefined,
        items: cart.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          sku: it.sku,
          hsnCode: it.hsnCode,
          quantity: it.quantity,
          unitPricePaise: it.unitPricePaise,
          discountPaise: it.discountPaise,
          taxRate: it.taxRate,
        })),
        billDiscountPaise,
        clientRequestId: requestIdRef.current,
        // Cash tendered above the bill total is change, not payment.
        payments: [
          ...(paymentMode !== 'CREDIT' && primaryPaise - changeDuePaise > 0 ? [{ mode: paymentMode, amountPaise: primaryPaise - changeDuePaise }] : []),
          ...(splitEnabled && splitPaise > 0 ? [{ mode: splitMode, amountPaise: splitPaise }] : []),
        ],
        paymentMode: paymentMode === 'CREDIT' && !(splitEnabled && splitPaise > 0) ? 'CREDIT' : undefined,
      };
      if (payload.payments.length === 0) delete (payload as any).payments;

      const res = await api.checkout(payload);
      setCreatedInvoice(res.invoice);
      requestIdRef.current = crypto.randomUUID();
      clearCart();
      loadCatalog(); // Refresh stock
      loadCustomers(); // Refresh balances
    } catch (err: any) {
      setErrorMsg(err.message || 'Checkout failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter products
  const filteredProducts = products.filter((p) => {
    const matchCat = selectedCategory === 'all' || p.category_id === selectedCategory;
    const matchQuery =
      searchQuery === '' ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.barcode && p.barcode.includes(searchQuery));
    return matchCat && matchQuery;
  });

  return (
    <div className="h-full min-h-0 flex flex-col lg:flex-row overflow-hidden bg-slate-100 dark:bg-slate-950">
      
      {/* ================= LEFT: PRODUCT CATALOG & SCANNER ================= */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        
        {/* Top Search & Barcode Bar */}
        <div className="shrink-0 p-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2.5 bg-slate-50/70 dark:bg-slate-900/70">
          {/* Barcode scanner quick form */}
          <form onSubmit={handleBarcodeSubmit} className="flex-1 min-w-[200px] relative">
            <Barcode className="w-4 h-4 text-emerald-500 absolute left-3 top-2.5" />
            <input
              ref={barcodeInputRef}
              type="text"
              data-scan-input
              placeholder="Scan Barcode / Enter SKU (Enter to add)..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500 font-mono shadow-sm"
            />
          </form>

          {/* Search by text */}
          <div className="flex-1 min-w-[180px] relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search product name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500 shadow-sm"
            />
          </div>

          {/* Held Bills Counter */}
          {heldBills.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                {heldBills.length} Held
              </span>
              <button
                onClick={() => resumeBill(heldBills[0].id)}
                className="text-xs bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 px-2 py-1 rounded border border-amber-300 dark:border-amber-700 hover:bg-amber-200 transition font-medium"
              >
                Resume
              </button>
            </div>
          )}
        </div>

        {/* Category Pills */}
        <div className="shrink-0 px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto text-xs no-scrollbar bg-slate-50 dark:bg-slate-900/40">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap transition ${
              selectedCategory === 'all'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            All Items ({products.length})
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.id)}
              className={`px-3 py-1 rounded-lg font-medium whitespace-nowrap transition ${
                selectedCategory === c.id
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Catalog Grid */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5">
          {filteredProducts.length === 0 ? (
            <div className="h-full min-h-[12rem] flex flex-col items-center justify-center text-center text-slate-400 px-6">
              <Search className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                {products.length === 0 ? 'No products in the catalog' : 'No products match this search'}
              </p>
              <p className="text-xs mt-1 max-w-sm">
                {products.length === 0
                  ? 'Add products from the Products page, then scan a barcode or tap an item here.'
                  : 'Try another name, SKU, barcode, or category.'}
              </p>
            </div>
          ) : (
          <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 content-start">
          {filteredProducts.map((p) => {
            const isOutOfStock = p.stock_quantity <= 0;
            const isLowStock = p.stock_quantity <= p.low_stock_threshold;
            return (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                disabled={isOutOfStock}
                className="text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/60 hover:border-emerald-500 hover:shadow-md transition group flex flex-col gap-2 min-h-[8.5rem] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div>
                  <div className="flex items-start justify-between gap-1">
                    <h4 className="font-semibold text-xs text-slate-800 dark:text-slate-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 line-clamp-2">
                      {p.name}
                    </h4>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] font-mono text-slate-400">{p.sku}</span>
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1 rounded">
                      GST {p.tax_rate}%
                    </span>
                  </div>
                </div>

                <div className="flex items-end justify-between gap-2 mt-auto pt-2 border-t border-slate-100 dark:border-slate-700/60 w-full">
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {formatINR(p.sale_price_paise)}
                    </span>
                    {p.mrp_paise > p.sale_price_paise && (
                      <span className="text-[10px] text-slate-400 line-through ml-1">
                        {formatINR(p.mrp_paise)}
                      </span>
                    )}
                  </div>

                  <span
                    className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      isOutOfStock
                        ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                        : isLowStock
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                    }`}
                  >
                    {p.stock_quantity} {p.unit}
                  </span>
                </div>
              </button>
            );
          })}
          </div>
          )}
        </div>
      </div>

      {/* ================= RIGHT: LIVE CART & BILLING SUMMARY ================= */}
      <div className="w-full lg:w-96 shrink-0 min-h-0 max-lg:max-h-[48%] flex flex-col overflow-hidden bg-white dark:bg-slate-900 shadow-xl border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800">
        
        {/* Customer Header */}
        <div className="shrink-0 p-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Customer Details
            </span>
            <button
              onClick={() => {
                setSelectedCustomerId('');
                setCustomerName('Walk-in Customer');
                setCustomerPhone('');
              }}
              className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
            >
              Reset Walk-in
            </button>
          </div>

          <Select
            value={selectedCustomerId}
            onChange={(e) => pickCustomer(e.target.value)}
            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100"
          >
            <option value="">Walk-in / new customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.phone ? ` · ${c.phone}` : ''}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Customer Name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <input
              type="text"
              placeholder="Mobile Phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
              <Sparkles className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-xs font-semibold">Cart is currently empty</p>
              <p className="text-[11px] text-slate-400 mt-1">Scan a barcode or click catalog items on the left</p>
            </div>
          ) : (
            cart.map((item, idx) => (
              <div
                key={idx}
                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="truncate">
                    <h5 className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                      {item.productName}
                    </h5>
                    <span className="text-[10px] font-mono text-slate-400">
                      {formatINR(item.unitPricePaise)} / {item.unit} · GST {item.taxRate}%
                    </span>
                  </div>
                  <button
                    onClick={() => removeFromCart(idx)}
                    className="text-slate-400 hover:text-red-500 transition p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between pt-1">
                  {/* Quantity Stepper */}
                  <div className="flex items-center bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg">
                    <button
                      onClick={() => updateQuantity(idx, item.quantity - 1)}
                      className="px-2 py-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="number"
                      min="0.001"
                      value={item.quantity}
                      step="0.001"
                      onChange={(e) => { const q = Math.round((parseFloat(e.target.value) || 0) * 1000) / 1000; if (q > 0) updateQuantity(idx, q); }}
                      className="w-12 text-center text-xs font-bold bg-transparent focus:outline-none"
                    />
                    <button
                      onClick={() => updateQuantity(idx, item.quantity + 1)}
                      className="px-2 py-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Line Total */}
                  <div className="text-right">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      {formatINR(item.unitPricePaise * item.quantity)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="mx-3 p-2 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 text-xs rounded-lg flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Calculation & Payment Summary */}
        <div className="shrink-0 max-h-[58%] overflow-y-auto p-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2.5">
          {/* Subtotal, discounts, GST summary */}
          <div className="space-y-1 text-xs">
            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>Items Subtotal:</span>
              <span>{formatINR(subtotalPaise)}</span>
            </div>

            {/* Bill discount input */}
            <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
              <span>Bill Discount (₹):</span>
              <input
                type="number"
                min="0"
                value={billDiscountRupees}
                onChange={(e) => setBillDiscountRupees(e.target.value)}
                className="w-20 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs focus:outline-none"
              />
            </div>

            <div className="flex justify-between text-slate-500 dark:text-slate-400">
              <span>GST Tax:</span>
              <span>{formatINR(totalTaxPaise)}</span>
            </div>

            {roundOffPaise !== 0 && (
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>Round-off:</span>
                <span>{roundOffPaise > 0 ? '+' : '-'}{formatINR(Math.abs(roundOffPaise))}</span>
              </div>
            )}
            {calcError && <div className="text-[11px] text-red-600">{calcError}</div>}

            <div className="flex justify-between text-base font-extrabold text-slate-900 dark:text-white pt-1.5 border-t border-slate-200 dark:border-slate-800">
              <span>Grand Total:</span>
              <span className="text-emerald-600 dark:text-emerald-400">{formatINR(grandTotalPaise)}</span>
            </div>
          </div>

          {/* Payment Modes */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            {(['CASH', 'UPI', 'CARD', 'CREDIT'] as PaymentMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setPaymentMode(mode)}
                className={`py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${
                  paymentMode === mode
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                }`}
              >
                {mode === 'CASH' && <Banknote className="w-3.5 h-3.5" />}
                {mode === 'UPI' && <QrCode className="w-3.5 h-3.5 text-teal-500" />}
                {mode === 'CARD' && <CreditCard className="w-3.5 h-3.5" />}
                <span>{mode}</span>
              </button>
            ))}
          </div>

          {/* Amount paid now / split / balance */}
          {cart.length > 0 && (
            <div className="space-y-1.5 text-xs">
              {paymentMode !== 'CREDIT' && (
                <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                  <span>{paymentMode === 'CASH' ? 'Cash received (₹):' : 'Paid now (₹):'}</span>
                  <input type="number" min="0" step="0.01" placeholder={(Math.max(0, grandTotalPaise - splitPaise) / 100).toFixed(2)}
                    value={amountPaidRupees} onChange={(e) => setAmountPaidRupees(e.target.value)}
                    className="w-24 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs focus:outline-none" />
                </div>
              )}
              <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <input type="checkbox" checked={splitEnabled} onChange={(e) => setSplitEnabled(e.target.checked)} />
                <span>Split / additional payment</span>
              </label>
              {splitEnabled && (
                <div className="flex items-center gap-1.5">
                  <Select value={splitMode} onChange={(e) => setSplitMode(e.target.value as PaymentMode)}
                    className="flex-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-xs">
                    {['UPI', 'CARD', 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'WALLET'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                  </Select>
                  <input type="number" min="0" step="0.01" placeholder="Amount ₹" value={splitRupees} onChange={(e) => setSplitRupees(e.target.value)}
                    className="w-24 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs focus:outline-none" />
                </div>
              )}
              {changeDuePaise > 0 && <div className="flex justify-between font-semibold text-emerald-600"><span>Change to return:</span><span>{formatINR(changeDuePaise)}</span></div>}
              {balanceDuePaise > 0 && (
                <div className="flex justify-between font-semibold text-amber-600">
                  <span>Balance on credit{selectedCustomerId ? '' : ' (added to Customers)'}:</span><span>{formatINR(balanceDuePaise)}</span>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons: Hold, Clear, Complete Checkout */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={holdBill}
              disabled={cart.length === 0}
              className="p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition disabled:opacity-40"
              title="Hold Bill"
            >
              <PauseCircle className="w-4 h-4" />
            </button>

            <button
              onClick={clearCart}
              disabled={cart.length === 0}
              className="p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-40"
              title="Clear Cart"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            <button
              onClick={handleCheckout}
              disabled={cart.length === 0 || isSubmitting || !!calcError}
              className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs py-3 rounded-xl shadow-lg shadow-emerald-600/30 transition flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Generating Bill...' : `Save & Print (${formatINR(grandTotalPaise)})`}</span>
            </button>
          </div>
        </div>

      </div>

      {/* Invoice Modal for Immediate Thermal / A4 Print */}
      {createdInvoice && (
        <InvoiceModal
          invoice={createdInvoice}
          onClose={() => setCreatedInvoice(null)}
        />
      )}

    </div>
  );
};
