import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { ThemeProvider } from './context/ThemeContext.js';
import { ThemeSwitch } from './components/ThemeSwitch.js';
import { LanguageProvider } from './context/LanguageContext.js';
import { LicenseProvider, useLicense } from './context/LicenseContext.js';
import { AppGuards } from './components/system/AppGuards.js';
import { LicenseActivationPage, LicensePage, LicenseBanner, FeatureLocked, WorkspaceHold } from './pages/license/LicensePage.js';
import { PAGE_FEATURES } from './lib/features.js';
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
  const { user, initializing } = useAuth();
  const { system, license, loading: licenseLoading, hasFeature, adminLocked } = useLicense();
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [activePage, setActivePage] = useState<string>('dashboard');

  // Check URL query parameters for public store view (e.g. ?store=apna-supermart)
  const urlParams = new URLSearchParams(window.location.search);
  const storeParam = urlParams.get('store');
  const [isPublicStoreView, setIsPublicStoreView] = useState<boolean>(Boolean(storeParam));

  if (isPublicStoreView) {
    return (
      <>
        <PublicStorefrontPage
          initialSlug={storeParam || 'apna-supermart'}
          onNavigateToLogin={() => {
            window.history.pushState({}, '', window.location.pathname);
            setIsPublicStoreView(false);
          }}
        />
        <div className="fixed top-3 right-3 z-50"><ThemeSwitch /></div>
      </>
    );
  }

  // Full-screen loader only for the initial session check; login/register keep their form (and errors) mounted.
  if (initializing || licenseLoading) {
    return (
      <div className="relative min-h-screen bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
        <div className="absolute top-4 right-4"><ThemeSwitch /></div>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-emerald-400">Loading Apna Billing...</span>
        </div>
      </div>
    );
  }

  // Sign in or create an account before any license step.
  if (!user) {
    if (system?.setupRequired || authView === 'register') {
      return <RegisterPage onNavigateToLogin={system?.setupRequired ? undefined : () => setAuthView('login')} />;
    }
    return <LoginPage onNavigateToRegister={() => setAuthView('register')} />;
  }

  // A new account, or one that has not purchased, chooses a free trial or a license key.
  // An active or expired trial uses the app; the dashboard is where that account enters a key.
  const purchased = license?.license?.type === 'PAID';
  const onTrial = license?.license?.type === 'TRIAL';
  if (license?.enforced && !purchased && !onTrial) {
    return <LicenseActivationPage />;
  }

  return (
    <div className="app-canvas h-screen flex overflow-hidden text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200">
      {/* Sidebar Navigation */}
      <Sidebar activePage={activePage} onNavigate={setActivePage} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <Navbar activePage={activePage} onNavigate={setActivePage} />
        <LicenseBanner onOpen={() => setActivePage('license')} />

        <main className={`flex-1 min-h-0 ${activePage === 'billing' && hasFeature(PAGE_FEATURES.billing) ? 'overflow-hidden' : 'overflow-y-auto p-6'}`}>
          {PAGE_FEATURES[activePage] && !hasFeature(PAGE_FEATURES[activePage]) ? (
            <FeatureLocked feature={PAGE_FEATURES[activePage]} lockedByAdmin={adminLocked(PAGE_FEATURES[activePage])} onOpenLicense={() => setActivePage('license')} />
          ) : (<>
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
          {activePage === 'license' && <LicensePage />}
          </>)}
        </main>
      </div>
      <WorkspaceHold />
      {PAGE_FEATURES[activePage] && !hasFeature(PAGE_FEATURES[activePage]) && (
        <div className="fixed inset-0 z-[1020] flex items-center justify-center bg-slate-950/75 p-6 backdrop-blur-sm">
          <FeatureLocked feature={PAGE_FEATURES[activePage]} lockedByAdmin={adminLocked(PAGE_FEATURES[activePage])} onOpenLicense={() => setActivePage('license')} />
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <LicenseProvider>
          <AuthProvider>
            <MainApp />
          </AuthProvider>
          <AppGuards />
        </LicenseProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
