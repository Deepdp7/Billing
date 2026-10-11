import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { ThemeProvider } from './context/ThemeContext.js';
import { LanguageProvider } from './context/LanguageContext.js';
import { Navbar } from './components/layout/Navbar.js';
import { Sidebar } from './components/layout/Sidebar.js';

// Phase 1 Pages
import { LoginPage } from './pages/auth/LoginPage.js';
import { RegisterPage } from './pages/auth/RegisterPage.js';
import { DashboardPage } from './pages/dashboard/DashboardPage.js';
import { PosBillingPage } from './pages/billing/PosBillingPage.js';
import { InvoicesPage } from './pages/invoices/InvoicesPage.js';
import { ProductsPage } from './pages/products/ProductsPage.js';
import { InventoryPage } from './pages/inventory/InventoryPage.js';
import { CustomersPage } from './pages/customers/CustomersPage.js';
import { SettingsPage } from './pages/settings/SettingsPage.js';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage.js';

// Phase 2, 3 & 4 Pages
import { PurchasesPage } from './pages/purchases/PurchasesPage.js';
import { ExpensesPage } from './pages/expenses/ExpensesPage.js';
import { ReportsPage } from './pages/reports/ReportsPage.js';
import { StaffPage } from './pages/staff/StaffPage.js';
import { QuotationsPage } from './pages/quotations/QuotationsPage.js';
import { RestaurantPage } from './pages/restaurant/RestaurantPage.js';
import { PharmacyPage } from './pages/pharmacy/PharmacyPage.js';
import { ClothingFashionPage } from './pages/clothing/ClothingFashionPage.js';
import { ReturnsRefundsPage } from './pages/returns/ReturnsRefundsPage.js';

// Phase 5 Enterprise & Scale Pages
import { BarcodeGeneratorPage } from './pages/barcodes/BarcodeGeneratorPage.js';
import { BackupPage } from './pages/backup/BackupPage.js';
import { SupportPage } from './pages/support/SupportPage.js';
import { BranchesPage } from './pages/branches/BranchesPage.js';
import { AuditLogsPage } from './pages/audit/AuditLogsPage.js';

// Phase 9: Online Storefront & Manufacturing Pages
import { PublicStorefrontPage } from './pages/storefront/PublicStorefrontPage.js';
import { OnlineOrdersPage } from './pages/storefront/OnlineOrdersPage.js';
import { ManufacturingPage } from './pages/manufacturing/ManufacturingPage.js';

// Phase 10: Loyalty & School Pages
import { LoyaltyRewardsPage } from './pages/loyalty/LoyaltyRewardsPage.js';
import { SchoolFeesPage } from './pages/school/SchoolFeesPage.js';

// Phase 11: Wholesale & Services Verticals
import { WholesalePage } from './pages/wholesale/WholesalePage.js';
import { ServiceBusinessPage } from './pages/services/ServiceBusinessPage.js';

function MainApp() {
  const { user, isLoading } = useAuth();
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [activePage, setActivePage] = useState<string>('dashboard');

  // Check URL query parameters for public store view (e.g. ?store=apna-supermart)
  const urlParams = new URLSearchParams(window.location.search);
  const storeParam = urlParams.get('store');
  const [isPublicStoreView, setIsPublicStoreView] = useState<boolean>(Boolean(storeParam));

  if (isPublicStoreView) {
    return (
      <PublicStorefrontPage
        initialSlug={storeParam || 'apna-supermart'}
        onNavigateToLogin={() => {
          // Clear query param and show login
          window.history.pushState({}, '', window.location.pathname);
          setIsPublicStoreView(false);
        }}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-emerald-400">Loading Apna Billing...</span>
        </div>
      </div>
    );
  }

  // Not logged in -> Show Login or Register
  if (!user) {
    if (authView === 'register') {
      return <RegisterPage onNavigateToLogin={() => setAuthView('login')} />;
    }
    return <LoginPage onNavigateToRegister={() => setAuthView('register')} />;
  }

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200">
      {/* Sidebar Navigation */}
      <Sidebar activePage={activePage} onNavigate={setActivePage} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <Navbar activePage={activePage} onNavigate={setActivePage} />

        <main className="flex-1 p-6">
          {activePage === 'dashboard' && <DashboardPage onNavigate={setActivePage} />}
          {activePage === 'billing' && <PosBillingPage />}
          {activePage === 'online-orders' && <OnlineOrdersPage />}
          {activePage === 'invoices' && <InvoicesPage />}
          {activePage === 'products' && <ProductsPage />}
          {activePage === 'inventory' && <InventoryPage />}
          {activePage === 'returns' && <ReturnsRefundsPage />}
          {activePage === 'purchases' && <PurchasesPage />}
          {activePage === 'expenses' && <ExpensesPage />}
          {activePage === 'reports' && <ReportsPage />}
          {activePage === 'quotations' && <QuotationsPage onNavigateToInvoices={() => setActivePage('invoices')} />}
          {activePage === 'customers' && <CustomersPage />}
          {activePage === 'wholesale' && <WholesalePage />}
          {activePage === 'services' && <ServiceBusinessPage />}
          {activePage === 'loyalty' && <LoyaltyRewardsPage />}
          {activePage === 'staff' && <StaffPage />}
          {activePage === 'restaurant' && <RestaurantPage />}
          {activePage === 'pharmacy' && <PharmacyPage />}
          {activePage === 'clothing' && <ClothingFashionPage />}
          {activePage === 'manufacturing' && <ManufacturingPage />}
          {activePage === 'school' && <SchoolFeesPage />}
          {activePage === 'barcodes' && <BarcodeGeneratorPage />}
          {activePage === 'backup' && <BackupPage />}
          {activePage === 'branches' && <BranchesPage />}
          {activePage === 'support' && <SupportPage />}
          {activePage === 'audit-logs' && <AuditLogsPage />}
          {activePage === 'settings' && <SettingsPage />}
          {activePage === 'admin' && <AdminDashboardPage />}
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <MainApp />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
