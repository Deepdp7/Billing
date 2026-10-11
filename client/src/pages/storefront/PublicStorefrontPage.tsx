import React, { useState, useEffect } from 'react';
import {
  ShoppingBag, Search, Plus, Minus, Trash2, CheckCircle2,
  Clock, MapPin, Phone, MessageSquare, ArrowLeft,
  Store, AlertCircle, Sparkles, Tag, ChevronRight, X
} from 'lucide-react';
import { api } from '../../lib/api.js';

interface CartItem {
  product_id: string;
  name: string;
  sku?: string;
  price_paise: number;
  quantity: number;
  unit?: string;
}

interface PublicStorefrontProps {
  initialSlug?: string;
  onNavigateToLogin?: () => void;
}

export function PublicStorefrontPage({ initialSlug = 'apna-supermart', onNavigateToLogin }: PublicStorefrontProps) {
  const [slug, setSlug] = useState(initialSlug);
  const [storeData, setStoreData] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cart & Checkout
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryPincode, setDeliveryPincode] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMode, setPaymentMode] = useState<'COD' | 'UPI'>('COD');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Completed Order Modal
  const [placedOrder, setPlacedOrder] = useState<any | null>(null);

  useEffect(() => {
    loadStore(slug);
  }, [slug]);

  const loadStore = async (storeSlug: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getPublicStore(storeSlug);
      setStoreData(res.store);
      setCategories(res.categories || []);
      setProducts(res.products || []);
    } catch (err: any) {
      setError(err.message || 'Store not found or currently offline');
    } finally {
      setIsLoading(false);
    }
  };

  const addToCart = (product: any) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.product_id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product_id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          sku: product.sku,
          price_paise: product.sale_price_paise,
          quantity: 1,
          unit: product.unit,
        },
      ];
    });
  };

  const updateCartQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product_id === productId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.product_id !== productId));
  };

  const subtotalPaise = cart.reduce((sum, item) => sum + item.price_paise * item.quantity, 0);
  const deliveryFeePaise = storeData?.delivery_fee_paise || 0;
  const totalPaise = subtotalPaise + deliveryFeePaise;
  const totalItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const filteredProducts = products.filter((p) => {
    const matchesCategory = selectedCategory === 'all' || p.category_name === selectedCategory;
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName || !customerPhone || !deliveryAddress) {
      alert('Please fill in your name, phone number, and delivery address.');
      return;
    }

    if (cart.length === 0) {
      alert('Your cart is empty.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.createPublicOrder(slug, {
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_email: customerEmail || undefined,
        delivery_address: deliveryAddress,
        delivery_city: deliveryCity || undefined,
        delivery_pincode: deliveryPincode || undefined,
        notes: notes || undefined,
        payment_mode: paymentMode,
        items: cart.map((c) => ({
          product_id: c.product_id,
          quantity: c.quantity,
        })),
      });

      setPlacedOrder({
        orderNumber: res.orderNumber,
        totalPaise: res.totalAmountPaise,
        customerName,
        customerPhone,
        deliveryAddress,
        paymentMode,
        itemsCount: res.itemCount,
      });

      // Clear cart
      setCart([]);
      setIsCartOpen(false);
    } catch (err: any) {
      alert(err.message || 'Failed to place order. Please check minimum order limit or try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-sm font-semibold text-slate-600">Loading Storefront...</p>
      </div>
    );
  }

  if (error || !storeData) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-slate-200">
          <Store className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-slate-900">Store Not Available</h2>
          <p className="text-sm text-slate-500 mt-2 mb-6">
            {error || 'The requested storefront could not be located.'}
          </p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => setSlug('apna-supermart')}
              className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-700 transition"
            >
              Try Demo Supermart
            </button>
            {onNavigateToLogin && (
              <button
                onClick={onNavigateToLogin}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-200 transition"
              >
                Merchant Login
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Banner */}
      {storeData.banner_message && (
        <div className="bg-emerald-600 text-white text-xs font-medium py-2 px-4 text-center flex items-center justify-center gap-2 shadow-sm">
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          <span>{storeData.banner_message}</span>
        </div>
      )}

      {/* Main Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-600/20 font-black text-lg">
              {storeData.store_name?.charAt(0) || 'S'}
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate flex items-center gap-2">
                {storeData.store_name}
                <span className="hidden sm:inline-flex text-[10px] bg-emerald-100 text-emerald-800 font-semibold px-2 py-0.5 rounded-full">
                  Verified Store
                </span>
              </h1>
              <p className="text-xs text-slate-500 truncate">{storeData.tagline || 'Online Store'}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {storeData.contact_phone && (
              <a
                href={`tel:${storeData.contact_phone}`}
                className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                <span>{storeData.contact_phone}</span>
              </a>
            )}

            {onNavigateToLogin && (
              <button
                onClick={onNavigateToLogin}
                className="text-xs font-semibold text-slate-600 hover:text-emerald-600 px-2.5 py-1.5 transition"
              >
                Merchant Login
              </button>
            )}

            {/* Cart Trigger */}
            <button
              onClick={() => setIsCartOpen(true)}
              className="relative flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition cursor-pointer"
            >
              <ShoppingBag className="w-4 h-4" />
              <span className="hidden sm:inline">Cart</span>
              {totalItemsCount > 0 && (
                <span className="bg-white text-emerald-700 font-black text-[11px] px-1.5 py-0.2 rounded-full min-w-5 text-center">
                  {totalItemsCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full flex flex-col gap-6">
        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search products by name or SKU..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-none shadow-2xs"
            />
          </div>

          {/* Quick Demo Switcher */}
          <div className="flex items-center gap-2 text-xs text-slate-500 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            <span className="text-[11px] font-semibold text-slate-400">Stores:</span>
            <button
              onClick={() => setSlug('apna-supermart')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                slug === 'apna-supermart'
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Grocery Supermart
            </button>
            <button
              onClick={() => setSlug('zara-trends')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                slug === 'zara-trends'
                  ? 'bg-purple-100 text-purple-800 border-purple-300 font-bold'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Zara Fashion
            </button>
          </div>
        </div>

        {/* Categories Horizontal Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            All Items ({products.length})
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedCategory(c.name)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                selectedCategory === c.name
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Product Catalog Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5 sm:gap-4">
          {filteredProducts.map((p) => {
            const inCart = cart.find((item) => item.product_id === p.id);
            const isOutOfStock = p.stock_quantity <= 0;

            return (
              <div
                key={p.id}
                className="bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-4 flex flex-col justify-between hover:shadow-md transition-shadow group"
              >
                <div>
                  {/* Category & Stock Tag */}
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="text-[10px] font-semibold text-slate-600 truncate uppercase tracking-wider">
                      {p.category_name || 'Standard'}
                    </span>
                    {isOutOfStock ? (
                      <span className="text-[10px] font-bold text-rose-800 bg-rose-50 px-1.5 py-0.5 rounded">
                        Out of Stock
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded">
                        In Stock
                      </span>
                    )}
                  </div>

                  {/* Product Title */}
                  <h3 className="text-xs sm:text-sm font-bold text-slate-800 line-clamp-2 mb-1 group-hover:text-emerald-700 transition">
                    {p.name}
                  </h3>
                  <div className="text-[11px] text-slate-600 mb-3 font-mono">
                    {p.sku} {p.unit && `· ${p.unit}`}
                  </div>
                </div>

                <div>
                  {/* Price */}
                  <div className="flex items-baseline gap-1.5 mb-3">
                    <span className="text-sm sm:text-base font-extrabold text-slate-900">
                      ₹{(p.sale_price_paise / 100).toFixed(2)}
                    </span>
                    {p.mrp_paise > p.sale_price_paise && (
                      <span className="text-[11px] text-slate-600 line-through">
                        ₹{(p.mrp_paise / 100).toFixed(2)}
                      </span>
                    )}
                  </div>

                  {/* Add to Cart Actions */}
                  {isOutOfStock ? (
                    <button
                      disabled
                      className="w-full py-1.5 bg-slate-100 text-slate-400 rounded-xl text-xs font-semibold cursor-not-allowed text-center"
                    >
                      Sold Out
                    </button>
                  ) : inCart ? (
                    <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-2 py-1">
                      <button
                        onClick={() => updateCartQuantity(p.id, -1)}
                        className="w-6 h-6 flex items-center justify-center rounded-lg bg-white text-emerald-700 shadow-2xs hover:bg-emerald-100 cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs font-extrabold text-emerald-800">{inCart.quantity}</span>
                      <button
                        onClick={() => updateCartQuantity(p.id, 1)}
                        className="w-6 h-6 flex items-center justify-center rounded-lg bg-emerald-600 text-white shadow-2xs hover:bg-emerald-700 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => addToCart(p)}
                      className="w-full py-2 bg-slate-900 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add to Cart</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filteredProducts.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center my-6">
            <Search className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-slate-700">No products matched your search</h4>
            <p className="text-xs text-slate-400 mt-1">Try switching categories or clear the search query</p>
          </div>
        )}
      </main>

      {/* Slide-Over Cart Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-sm">Your Order Cart ({totalItemsCount} items)</h3>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-500 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Cart Items */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <ShoppingBag className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                  <p className="text-sm font-semibold">Your cart is empty</p>
                  <p className="text-xs mt-1">Browse products and add items to checkout</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.product_id}
                    className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-bold text-slate-800 truncate">{item.name}</h4>
                      <p className="text-[11px] text-slate-500 font-mono">
                        ₹{(item.price_paise / 100).toFixed(2)} × {item.quantity} = ₹{((item.price_paise * item.quantity) / 100).toFixed(2)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center bg-white border border-slate-200 rounded-lg">
                        <button
                          onClick={() => updateCartQuantity(item.product_id, -1)}
                          className="w-6 h-6 flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-l"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                        <button
                          onClick={() => updateCartQuantity(item.product_id, 1)}
                          className="w-6 h-6 flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-r"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      <button
                        onClick={() => removeFromCart(item.product_id)}
                        className="p-1 text-slate-400 hover:text-rose-600 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}

              {/* Checkout Form */}
              {cart.length > 0 && (
                <form id="checkout-form" onSubmit={handlePlaceOrder} className="pt-4 border-t border-slate-200 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Customer & Delivery Details</span>
                  </h4>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Ramesh Patel"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Phone Number *</label>
                      <input
                        type="tel"
                        required
                        placeholder="e.g. 9820012345"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Email (Optional)</label>
                      <input
                        type="email"
                        placeholder="you@email.com"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Delivery Address *</label>
                    <textarea
                      required
                      rows={2}
                      placeholder="Flat, building, street, landmark..."
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">City</label>
                      <input
                        type="text"
                        placeholder="e.g. Mumbai"
                        value={deliveryCity}
                        onChange={(e) => setDeliveryCity(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">Pincode</label>
                      <input
                        type="text"
                        placeholder="e.g. 400001"
                        value={deliveryPincode}
                        onChange={(e) => setDeliveryPincode(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Payment Method</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentMode('COD')}
                        className={`py-2 px-3 rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                          paymentMode === 'COD'
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        <CheckCircle2 className={`w-3.5 h-3.5 ${paymentMode === 'COD' ? 'text-emerald-600' : 'text-slate-400'}`} />
                        <span>Cash on Delivery</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMode('UPI')}
                        className={`py-2 px-3 rounded-lg border text-xs font-bold transition flex items-center justify-center gap-1.5 ${
                          paymentMode === 'UPI'
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        <CheckCircle2 className={`w-3.5 h-3.5 ${paymentMode === 'UPI' ? 'text-emerald-600' : 'text-slate-400'}`} />
                        <span>UPI on Delivery</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">Order Notes (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Ring bell, deliver before 6 PM"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                    />
                  </div>
                </form>
              )}
            </div>

            {/* Cart Footer */}
            {cart.length > 0 && (
              <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Items Subtotal</span>
                    <span className="font-semibold">₹{(subtotalPaise / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Delivery Fee</span>
                    <span className="font-semibold text-emerald-700">
                      {deliveryFeePaise > 0 ? `₹${(deliveryFeePaise / 100).toFixed(2)}` : 'FREE'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-1 border-t border-slate-200">
                    <span>Total Payable</span>
                    <span className="text-emerald-700">₹{(totalPaise / 100).toFixed(2)}</span>
                  </div>
                </div>

                <button
                  type="submit"
                  form="checkout-form"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span>Placing Order...</span>
                  ) : (
                    <>
                      <span>Place Order (₹{(totalPaise / 100).toFixed(2)})</span>
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Order Confirmation Modal */}
      {placedOrder && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <h3 className="text-lg font-bold text-slate-900">Order Received!</h3>
            <p className="text-xs text-slate-500 mt-1">
              Thank you, <span className="font-bold text-slate-700">{placedOrder.customerName}</span>. Your order has been dispatched to the store.
            </p>

            <div className="bg-slate-50 rounded-xl p-4 my-4 text-left border border-slate-200/80 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Order Reference:</span>
                <span className="font-mono font-bold text-emerald-700">{placedOrder.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Amount:</span>
                <span className="font-bold">₹{(placedOrder.totalPaise / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment:</span>
                <span className="font-semibold">{placedOrder.paymentMode === 'COD' ? 'Cash on Delivery' : 'UPI on Delivery'}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 text-slate-600">
                <div className="font-semibold text-slate-700">Delivery Address:</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{placedOrder.deliveryAddress}</div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {storeData.contact_whatsapp && (
                <a
                  href={`https://wa.me/${storeData.contact_whatsapp.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                    `Hello, I placed order ${placedOrder.orderNumber} for ₹${(placedOrder.totalPaise / 100).toFixed(2)}. Please confirm delivery time.`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Send Order Details on WhatsApp</span>
                </a>
              )}

              <button
                onClick={() => setPlacedOrder(null)}
                className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

