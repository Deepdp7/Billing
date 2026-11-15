import React, { Suspense, lazy, startTransition, useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { ThemeProvider } from './context/ThemeContext.js';
import { ThemeSwitch } from './components/ThemeSwitch.js';
import { LanguageProvider } from './context/LanguageContext.js';
import { LicenseProvider, useLicense } from './context/LicenseContext.js';
import { AppGuards, UpdatePrompt } from './components/system/AppGuards.js';
import { LicenseActivationPage, LicensePage, LicenseBanner, FeatureLocked, WorkspaceHold } from './pages/license/LicensePage.js';
import { PAGE_FEATURES } from './lib/features.js';
import { Navbar } from './components/layout/Navbar.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { desktop, isDesktopApp } from './lib/desktop.js';
import { ScanLookup } from './components/system/ScanLookup.js';

// Sign-in screens are part of start-up (they can be the first screen)
import { LoginPage } from './pages/auth/LoginPage.js';
import { RegisterPage, type SignupDraft } from './pages/auth/RegisterPage.js';

// Screens load the first time they are needed, so start-up only parses what the first screen needs. The dashboard
// starts loading at once (it is the first screen after sign-in) and all others right after start-up (from the local
// engine, in milliseconds). A loaded screen is drawn directly, and switching to one that is still loading keeps the
// current screen until it is ready (navigate below): changing screens never shows a spinner.
const SCREENS = {
  DashboardPage: () => import('./pages/dashboard/DashboardPage.js'),
  PosBillingPage: () => import('./pages/billing/PosBillingPage.js'),
  InvoicesPage: () => import('./pages/invoices/InvoicesPage.js'),
  ProductsPage: () => import('./pages/products/ProductsPage.js'),
  InventoryPage: () => import('./pages/inventory/InventoryPage.js'),
  CustomersPage: () => import('./pages/customers/CustomersPage.js'),
  SettingsPage: () => import('./pages/settings/SettingsPage.js'),
  AdminDashboardPage: () => import('./pages/admin/AdminDashboardPage.js'),
  PurchasesPage: () => import('./pages/purchases/PurchasesPage.js'),
  ExpensesPage: () => import('./pages/expenses/ExpensesPage.js'),
  ReportsPage: () => import('./pages/reports/ReportsPage.js'),
  StaffPage: () => import('./pages/staff/StaffPage.js'),
  QuotationsPage: () => import('./pages/quotations/QuotationsPage.js'),
  RestaurantPage: () => import('./pages/restaurant/RestaurantPage.js'),
  PharmacyPage: () => import('./pages/pharmacy/PharmacyPage.js'),
  ClothingFashionPage: () => import('./pages/clothing/ClothingFashionPage.js'),
  ReturnsRefundsPage: () => import('./pages/returns/ReturnsRefundsPage.js'),
  BarcodeGeneratorPage: () => import('./pages/barcodes/BarcodeGeneratorPage.js'),
  BackupPage: () => import('./pages/backup/BackupPage.js'),
  SupportPage: () => import('./pages/support/SupportPage.js'),
  BranchesPage: () => import('./pages/branches/BranchesPage.js'),
  AuditLogsPage: () => import('./pages/audit/AuditLogsPage.js'),
  PublicStorefrontPage: () => import('./pages/storefront/PublicStorefrontPage.js'),
  OnlineOrdersPage: () => import('./pages/storefront/OnlineOrdersPage.js'),
  ManufacturingPage: () => import('./pages/manufacturing/ManufacturingPage.js'),
  LoyaltyRewardsPage: () => import('./pages/loyalty/LoyaltyRewardsPage.js'),
  SchoolFeesPage: () => import('./pages/school/SchoolFeesPage.js'),
  WholesalePage: () => import('./pages/wholesale/WholesalePage.js'),
  ServiceBusinessPage: () => import('./pages/services/ServiceBusinessPage.js'),
} as const;
type ScreenName = keyof typeof SCREENS;
const loadedScreens: Partial<Record<ScreenName, React.ComponentType<any>>> = {};
function loadScreen(name: ScreenName) {
  return SCREENS[name]().then((m) => {
    const component = (m as unknown as Record<string, React.ComponentType<any>>)[name];
    loadedScreens[name] = component;
    return component;
  });
}
function screen(name: ScreenName) {
  const Lazy = lazy(() => loadScreen(name).then((component) => ({ default: component })));
  return function Screen(props: any) {
    const Loaded = loadedScreens[name];
    return Loaded ? <Loaded {...props} /> : <Lazy {...props} />;
  };
}
void loadScreen('DashboardPage').catch(() => {});
const DashboardPage = screen('DashboardPage');
const PosBillingPage = screen('PosBillingPage');
const InvoicesPage = screen('InvoicesPage');
const ProductsPage = screen('ProductsPage');
const InventoryPage = screen('InventoryPage');
const CustomersPage = screen('CustomersPage');
const SettingsPage = screen('SettingsPage');
const AdminDashboardPage = screen('AdminDashboardPage');
const PurchasesPage = screen('PurchasesPage');
const ExpensesPage = screen('ExpensesPage');
const ReportsPage = screen('ReportsPage');
const StaffPage = screen('StaffPage');
const QuotationsPage = screen('QuotationsPage');
const RestaurantPage = screen('RestaurantPage');
const PharmacyPage = screen('PharmacyPage');
const ClothingFashionPage = screen('ClothingFashionPage');
const ReturnsRefundsPage = screen('ReturnsRefundsPage');
const BarcodeGeneratorPage = screen('BarcodeGeneratorPage');
const BackupPage = screen('BackupPage');
const SupportPage = screen('SupportPage');
const BranchesPage = screen('BranchesPage');
const AuditLogsPage = screen('AuditLogsPage');
const PublicStorefrontPage = screen('PublicStorefrontPage');
const OnlineOrdersPage = screen('OnlineOrdersPage');
const ManufacturingPage = screen('ManufacturingPage');
const LoyaltyRewardsPage = screen('LoyaltyRewardsPage');
const SchoolFeesPage = screen('SchoolFeesPage');
const WholesalePage = screen('WholesalePage');
const ServiceBusinessPage = screen('ServiceBusinessPage');
/** Only while the very first screen's code arrives (screens opened later never show it, see SCREENS) */
function ScreenLoading() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center" role="status" aria-label="Loading">
      <div className="h-6 w-6 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  );
}

function preloadScreens() {
  const run = () => (Object.keys(SCREENS) as ScreenName[]).forEach((name) => void loadScreen(name).catch(() => {}));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 500 });
  else setTimeout(run, 100);
}

function MainApp() {
  const { user, initializing, intent } = useAuth();
  const { system, license, loading: licenseLoading, hasFeature, adminLocked } = useLicense();
  const [authView, setAuthView] = useState<'login' | 'register'>('login');
  const [signupDraft, setSignupDraft] = useState<SignupDraft | null>(null);
  const [activePage, setActivePage] = useState<string>('dashboard');
  // A transition: the current screen stays until the next one is ready, never a loading spinner in between
  const navigate = useCallback((page: string) => startTransition(() => setActivePage(page)), []);
  useEffect(preloadScreens, []);
  // A barcode scan can open another screen (Sell in POS, Add as new product, …)
  useEffect(() => {
    const onNavigate = (e: Event) => navigate(String((e as CustomEvent).detail));
    window.addEventListener('apna:navigate', onNavigate);
    return () => window.removeEventListener('apna:navigate', onNavigate);
  }, [navigate]);
  // The desktop window stays hidden until the first real screen is drawn, then appears with it (never empty)
  const booting = initializing || licenseLoading;
  useEffect(() => { if (!booting && isDesktopApp()) void desktop.ready(); }, [booting]);

  // Check URL query parameters for public store view (e.g. ?store=apna-supermart)
  const urlParams = new URLSearchParams(window.location.search);
  const storeParam = urlParams.get('store');
  const [isPublicStoreView, setIsPublicStoreView] = useState<boolean>(Boolean(storeParam));

  if (isPublicStoreView) {
    return (
      <>
        <Suspense fallback={<ScreenLoading />}>
          <PublicStorefrontPage
            initialSlug={storeParam || 'apna-supermart'}
            onNavigateToLogin={() => {
              window.history.pushState({}, '', window.location.pathname);
              setIsPublicStoreView(false);
            }}
          />
        </Suspense>
        <div className="fixed top-3 right-3 z-50"><ThemeSwitch /></div>
      </>
    );
  }

  // Full-screen loader only for the initial session check; login/register keep their form (and errors) mounted.
  // Same start screen as the desktop window and index.html (styles in index.html), so starting up looks like one screen.
  if (initializing || licenseLoading) {
    return (
      <>
        <div className="boot" role="status" aria-label="Loading Apna Billing">
          <div><img src="/app-icon.png" alt="" /><b>Apna Billing</b><span><i /></span></div>
        </div>
        <div className="fixed top-4 right-4 z-10"><ThemeSwitch /></div>
      </>
    );
  }

  // Sign In / Sign Up toggle first; business category setup comes after Sign Up basics.
  if (!user) {
    if (authView === 'register' && signupDraft) {
      return (
        <>
          <RegisterPage
            account={signupDraft}
            onNavigateToLogin={() => setAuthView('login')}
          />
          <UpdatePrompt />
        </>
      );
    }
    return (
      <>
      <UpdatePrompt />
      <LoginPage
        setupRequired={!!system?.setupRequired}
        initialMode={signupDraft || system?.setupRequired || intent?.mode === 'signup' ? 'signup' : 'signin'}
        onContinueSignup={(draft) => {
          setSignupDraft(draft);
          setAuthView('register');
        }}
      />
      </>
    );
  }

  // A new account, or one that has not purchased, chooses a free trial or a license key.
  // An active or expired trial uses the app; the dashboard is where that account enters a key.
  const purchased = license?.license?.type === 'PAID';
  const onTrial = license?.license?.type === 'TRIAL';
  if (license?.enforced && !purchased && !onTrial) {
    return (
      <>
        <LicenseActivationPage />
        <UpdatePrompt />
      </>
    );
  }

  return (
    <div className="app-canvas h-full min-h-0 flex overflow-hidden text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200">
      {/* Sidebar Navigation */}
      <Sidebar activePage={activePage} onNavigate={navigate} />
      <ScanLookup />

      {/* Main Content Area — sits under the desktop title bar (never underlaps it) */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <Navbar activePage={activePage} onNavigate={navigate} />
        <LicenseBanner onOpen={() => navigate('license')} />

        {/* Keyed by screen: each screen settles in (ui-page, index.css) and starts scrolled to the top. The Suspense
            boundary is outside it, so it stays across screen changes and a transition keeps the current screen
            showing while the next one's code arrives (a boundary made new with each screen would show its spinner). */}
        <Suspense fallback={<ScreenLoading />}>
        <main key={activePage} className={`ui-page flex-1 min-h-0 overflow-x-hidden overscroll-none ${activePage === 'billing' && hasFeature(PAGE_FEATURES.billing) ? 'overflow-hidden' : 'overflow-y-auto p-6'}`}>
          {PAGE_FEATURES[activePage] && !hasFeature(PAGE_FEATURES[activePage]) ? (
            <FeatureLocked feature={PAGE_FEATURES[activePage]} lockedByAdmin={adminLocked(PAGE_FEATURES[activePage])} onOpenLicense={() => navigate('license')} />
          ) : (<>
          {activePage === 'dashboard' && <DashboardPage onNavigate={navigate} />}
          {activePage === 'billing' && <PosBillingPage />}
          {activePage === 'online-orders' && <OnlineOrdersPage />}
          {activePage === 'invoices' && <InvoicesPage />}
          {activePage === 'products' && <ProductsPage />}
          {activePage === 'inventory' && <InventoryPage />}
          {activePage === 'returns' && <ReturnsRefundsPage />}
          {activePage === 'purchases' && <PurchasesPage />}
          {activePage === 'expenses' && <ExpensesPage />}
          {activePage === 'reports' && <ReportsPage />}
          {activePage === 'quotations' && <QuotationsPage onNavigateToInvoices={() => navigate('invoices')} />}
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
        </Suspense>
      </div>
      <WorkspaceHold />
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
