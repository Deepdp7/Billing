# Apna Billing: Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | Apna Billing, an all-in-one business billing & management platform |
| **Version** | 1.0 (Draft) |
| **Date** | October 11, 2026 |
| **Status** | For review |
| **Stack** | React + TypeScript + Tailwind CSS · Node.js + Express.js · SQLite |

---

## 1. Overview

### 1.1 Summary
Apna Billing is a subscription-based SaaS platform that gives businesses, from small shops to large enterprises, one place for billing, inventory, accounting, customer and supplier management, reporting, and daily operations. It is built as **one shared core system with configurable business-specific modules**. During setup, a business picks its category (e.g., Restaurant, Pharmacy, Grocery), and the app enables the right modules, navigation, billing fields, and dashboard widgets.

### 1.2 Problem Statement
Small and mid-sized businesses (especially in India) often juggle separate tools for GST billing, stock, ledgers, and reports. Generic billing software doesn't fit industry-specific workflows (KOT for restaurants, batch/expiry for pharmacies, size/color variants for clothing). This leads to double entry, stock mismatches, and tax-compliance errors.

### 1.3 Vision
A single, fast, affordable platform that adapts to the business, not the other way around, and is easy to extend with new business categories without rebuilding the application.

### 1.4 Goals
- Deliver a **complete, functional** product where every button, form, table, and workflow is backed by the API and database (no decorative-only UI).
- Make everyday billing achievable in **minimal steps**.
- Support **multiple business categories** through configurable modules.
- Provide a **separate platform admin panel** for running the SaaS (users, plans, payments, support).
- Guarantee **strict data isolation** between businesses and **reliable transactions** for billing and inventory.

### 1.5 Non-Goals (v1)
- Native mobile apps (responsive web only).
- Direct integrations with third-party accounting suites or government e-invoicing/e-way bill APIs (can be a later phase; see §13).
- Payroll processing beyond staff accounts, roles, and activity tracking.
- Full e-commerce storefront with payment-gateway checkout (v1 covers catalog and order management).

---

## 2. Target Users & Personas

| Persona | Description | Key Needs |
|---|---|---|
| **Business Owner** | Owns one or more outlets | Profit visibility, outstanding payments, control over staff and branches |
| **Cashier / Billing Staff** | Creates bills all day | Speed, barcode scanning, simple UI, printing |
| **Manager / Accountant** | Oversees stock, expenses, books | Reports, ledgers, GST summaries, purchase tracking |
| **Branch Manager** | Runs a single branch | Branch-wise stock, sales, and staff |
| **Platform Admin (Super Admin)** | Operates Apna Billing itself | Manage users, plans, features, payments, support, audit logs |
| **Platform Support Agent** | Handles tickets | View/respond to support tickets |

---

## 3. Scope & Release Strategy

### 3.1 Business Categories Supported
Restaurant & Cafe · Grocery & Retail · Clothing & Fashion · Wholesale & Distribution · Service Businesses · Manufacturing · Pharmacy · School & Institute

### 3.2 Phased Delivery (Recommended)

| Phase | Focus | Contents |
|---|---|---|
| **Phase 1: Foundation (MVP)** | Core platform | Auth, RBAC, onboarding + business-type selection, products, billing/POS, GST invoices, customers, payments, basic inventory, dashboard, settings, platform admin basics |
| **Phase 2: Operations** | Back-office | Purchases, suppliers, expenses, accounting, returns/refunds, reports, staff management, notifications, barcode & labels |
| **Phase 3: Growth** | Scale features | Offers/coupons/loyalty, multi-branch, quotations/proforma, online store, backup/restore, subscriptions and feature gating |
| **Phase 4: Verticals** | Industry modules | Restaurant, Pharmacy, Clothing, Wholesale, Service, Manufacturing, School modules |
| **Phase 5: Polish** | Hardening | Performance, audit logs, help center, accessibility, QA |

> Note: The brief expects the full set of modules. Phasing is a recommendation for build order and risk management, not a reduction in scope.

---

## 4. Functional Requirements: Core Modules

Priority key: **P0** = must-have for launch · **P1** = important · **P2** = nice-to-have.

### 4.1 Dashboard
- Cards: today's/period sales, gross profit, expenses, outstanding receivables/payables, cash & bank balance, low-stock count.
- Charts: sales trend, top products, payment-mode split, category performance.
- Date-range filter; branch filter (multi-branch).
- Widgets vary by business category (e.g., open tables for restaurants, near-expiry batches for pharmacy). **(P0)**

### 4.2 Billing / POS
- Fast bill creation: product search, barcode scan, quantity edit, per-item and bill-level discount, notes. **(P0)**
- GST-compliant tax invoices (CGST/SGST/IGST, HSN/SAC, place of supply, invoice numbering series). **(P0)**
- Hold/resume bills, multi-payment split (cash + UPI, etc.), partial payment, credit sale. **(P0)**
- Print (thermal 58/80 mm and A4) and **PDF download**; share via WhatsApp/email link. **(P0 print/PDF, P1 share)**
- Keyboard shortcuts for rapid billing. **(P1)**
- Atomic transaction on save: invoice + stock deduction + payment + ledger entries succeed or fail together. **(P0)**

### 4.3 Products & Services
- Product/service catalog with SKU, barcode, category, unit, HSN/SAC, purchase/sale/MRP price, tax rate, images. **(P0)**
- Categories and sub-categories; price lists; bulk import/export (CSV/Excel). **(P1)**
- Variants (size/color) and batch attributes where the business type requires. **(P1)**

### 4.4 Inventory Management
- Real-time stock per product, per branch. **(P0)**
- Manual stock adjustment with reason codes and audit trail. **(P0)**
- Low-stock thresholds and alerts. **(P0)**
- Expiry tracking and near-expiry alerts. **(P1)**
- Stock transfer between branches. **(P1)**
- Stock movement ledger (every in/out traceable to a document). **(P0)**

### 4.5 Purchase Management
- Purchase orders, purchase invoices (with supplier GST), purchase history. **(P0)**
- Receiving goods updates stock and supplier payable. **(P0)**
- Purchase returns link to original purchase. **(P1)**

### 4.6 Customer Management
- Customer profiles (contact, GSTIN, address, credit limit). **(P0)**
- Purchase history, outstanding balance, payment records, statements. **(P0)**
- Payment reminders. **(P1)**

### 4.7 Supplier Management
- Supplier profiles, purchase history, outstanding payments, statements. **(P0)**

### 4.8 Payment Management
- Modes: Cash, UPI, Card, Bank Transfer, Credit. **(P0)**
- Record receipts against invoices (full/partial/advance) and payments to suppliers. **(P0)**
- Payment status tracking: paid / partial / unpaid / overdue. **(P0)**

### 4.9 Expense Management
- Record expenses with category, amount, date, payment mode, attachment (receipt). **(P0)**
- Custom expense categories; recurring expenses. **(P1)**

### 4.10 Accounting
- Cashbook, bank book, party ledgers, general income/expense ledger. **(P0)**
- Profit & Loss report; basic balance view. **(P0)**
- Double-entry-style ledger postings generated automatically from invoices, purchases, payments, and expenses. **(P1)**

### 4.11 Reports & Analytics
- Daily, monthly, yearly reports: sales, purchases, profit, stock, expenses, customer/supplier outstanding, staff activity. **(P0)**
- Filters (date, branch, category, staff); export to PDF/Excel/CSV. **(P0)**

### 4.12 Staff Management
- Staff accounts, roles, granular permissions per module/action. **(P0)**
- Activity tracking (who did what, when). **(P1)**
- Branch assignment. **(P1)**

### 4.13 Offers & Discounts
- Percentage/flat discounts, coupon codes with validity/limits, loyalty points (earn/redeem rules). **(P1)**

### 4.14 Returns & Refunds
- Sales returns (credit note) and purchase returns (debit note), with stock and ledger reversal. **(P0)**
- Refund tracking by mode. **(P0)**

### 4.15 GST & Tax
- Configurable tax rates and tax groups. **(P0)**
- Reports: GSTR-1-style sales summary, GSTR-3B-style summary, HSN summary, input/output tax. **(P1)**
- Export in formats suitable for filing preparation. **(P1)**

### 4.16 Invoice Management
- Invoice history with search/filter; status (draft, issued, paid, cancelled). **(P0)**
- Quotations and proforma invoices with convert-to-invoice. **(P1)**
- Customizable invoice templates. **(P1)**

### 4.17 Barcode & Labels
- Generate barcodes (EAN-13/Code128/QR), print label sheets, scanner support (keyboard-wedge/USB). **(P1)**

### 4.18 Notifications
- In-app notifications: payment reminders, low stock, invoice events. **(P1)**
- Email/SMS/WhatsApp delivery via pluggable providers. **(P2)**

### 4.19 Multi-Store / Branch Management
- Multiple branches per business; branch-wise stock, sales, staff, and reports. **(P1)**

### 4.20 Online Store
- Public product catalog page, online order intake, order status management; orders flow into billing/inventory. **(P2)**

### 4.21 Backup & Restore
- Manual and scheduled backups; download/export; restore/import with validation. **(P1)**
- Per-business export of all data. **(P1)**

### 4.22 Settings
- Business profile, logo, GSTIN, address, financial year, invoice numbering, templates, taxes, payment modes, printer preferences, theme. **(P0)**

### 4.23 Subscription & Plans
- Plans: **Free, Pro, Business**; limits (users, branches, invoices) and feature access per plan. **(P0 plan model, P1 billing flow)**
- Upgrade/downgrade, renewal, plan status display. **(P1)**

### 4.24 Help & Support
- In-app documentation/FAQ, support ticket creation and tracking. **(P1)**

---

## 5. Functional Requirements: Business-Specific Modules

Each module is a **configurable add-on** enabled by business category (and optionally by plan).

| Category | Capabilities |
|---|---|
| **Restaurant & Cafe** | Table management, menu with modifiers, KOT (kitchen order tickets), kitchen display/orders, dine-in/takeaway/delivery billing, table merge/split |
| **Grocery & Retail** | Barcode billing, weighing-scale support, expiry tracking, fast-moving inventory views |
| **Clothing & Fashion** | Size/color variants, product exchange, variant-level stock |
| **Wholesale & Distribution** | Bulk/tiered pricing, customer credit limits, party ledger, distributor management |
| **Service Businesses** | Appointments, service records, quotations, recurring invoices |
| **Manufacturing** | Raw materials, bill of materials, production records, finished-goods inventory |
| **Pharmacy** | Medicine master, batch numbers, expiry dates, batch-wise stock, expiry alerts, relevant stock records |
| **School & Institute** | Student records, fee structures, fee collection and receipts, outstanding fees |

### 5.1 Module Configuration Mechanism
- A **module registry** defines each module: ID, name, routes, menu items, permissions, dashboard widgets, extra fields, and required plan.
- On onboarding, the chosen **business category maps to a default module set**.
- Owners can enable/disable optional modules in Settings (subject to plan).
- Adding a new category = adding a registry entry + module code; **no core rewrite**.

---

## 6. Platform Admin Panel

A **separate application area** (separate route group, separate auth, separate role set) from business dashboards.

| # | Feature | Requirements |
|---|---|---|
| 1 | **Admin Dashboard** | Total users, active businesses, subscriptions by plan, revenue, signups trend, platform statistics |
| 2 | **User Management** | View, search, filter, suspend, activate, reset access |
| 3 | **Business Management** | List registered businesses, category, plan, status, created date |
| 4 | **Subscription Management** | Create/edit plans, pricing, renewals, status, manual overrides |
| 5 | **Feature Management** | Toggle modules/features per plan |
| 6 | **Payment Management** | Subscription payments, transaction records, status |
| 7 | **Support Management** | View, assign, reply to, and close tickets |
| 8 | **Notifications & Announcements** | Create platform-wide announcements; targeted by plan/category |
| 9 | **System Settings** | Platform config, security settings, preferences |
| 10 | **Audit Logs** | Immutable log of admin actions and key system events, searchable and filterable |

**Rule:** Platform admins manage accounts and settings but should not casually access business transactional data. Any such access must be explicit, restricted, and logged.

---

## 7. Roles & Permissions (RBAC)

### 7.1 Role Tiers
- **Platform level:** Super Admin, Support Agent.
- **Business level:** Owner, Manager, Accountant, Cashier, Branch Manager, Custom roles.

### 7.2 Permission Model
- Permissions defined as `module.action` (e.g., `invoice.create`, `inventory.adjust`, `report.view`).
- Roles are sets of permissions; users can be assigned a role and branch scope.
- Enforced **server-side on every endpoint** and mirrored in the UI (hide or disable unauthorized actions).

---

## 8. User Experience & Interface Requirements

- Modern SaaS dashboard layout with **collapsible sidebar** navigation.
- **Responsive** across desktop, tablet, and mobile.
- **Light and dark themes**, with persisted preference.
- Dashboard metric cards with meaningful, clickable KPIs.
- Tables: **search, filter, sort, pagination**, column visibility, export.
- Forms: inline validation with clear, helpful error messages; unsaved-change warnings.
- Consistent design system (typography, spacing, colors, buttons, icons) built on Tailwind with reusable components.
- Billing screen optimized for speed (keyboard-first, minimal clicks).
- Print-friendly invoice layouts and downloadable PDFs.
- Loading, empty, and error states for every screen.
- Accessibility: keyboard navigation, sufficient contrast, labelled controls (target WCAG 2.1 AA).
- Localization-ready (English first; Hindi and other Indian languages later), with INR currency and Indian number formatting.

---

## 9. System Architecture

### 9.1 High-Level
```
[ React + TS + Tailwind SPA ]  <-- HTTPS/JSON -->  [ Express.js API ]  <-->  [ SQLite DB ]
   Business App | Admin Panel                       Auth · RBAC · Modules      Files/Backups
```

### 9.2 Frontend
- React + TypeScript, Tailwind CSS, component library of shared UI primitives.
- Client-side routing with route guards (auth, role, module, plan).
- Server-state management via a data-fetching library (e.g., TanStack Query) and typed API client.
- Form handling with schema validation (e.g., Zod) shared with the backend where possible.
- PDF/print generation for invoices.

### 9.3 Backend
- Node.js + Express.js (TypeScript recommended) with layered structure: routes → controllers → services → repositories.
- Middleware: authentication, tenant resolution, RBAC, validation, rate limiting, error handling, request logging.
- Modular code layout so each business module registers its own routes/services.
- Background jobs (scheduled backups, reminders, recurring invoices) via an in-process scheduler.

### 9.4 Database (SQLite)
- **Multi-tenancy via `business_id` on every tenant-owned table**, enforced centrally in the data-access layer (no query may omit it).
- Foreign keys enabled; WAL mode for concurrency; indexes on `business_id` + lookup fields.
- All billing, purchase, return, and stock updates wrapped in **transactions**.
- Versioned **migrations** for schema changes.
- Money stored as **integers (paise)** to avoid floating-point errors.
- Soft-delete/cancel for financial documents; never hard-delete issued invoices.

### 9.5 Extensibility
- Module registry (§5.1), configurable fields (custom fields per business category), and feature flags tied to plans.

---

## 10. Core Data Model (Key Entities)

| Domain | Entities |
|---|---|
| **Platform** | `users`, `businesses`, `plans`, `subscriptions`, `subscription_payments`, `features`, `plan_features`, `support_tickets`, `ticket_messages`, `announcements`, `audit_logs`, `system_settings` |
| **Access** | `roles`, `permissions`, `role_permissions`, `staff`, `sessions` |
| **Org** | `branches`, `business_settings`, `enabled_modules` |
| **Catalog** | `categories`, `products`, `product_variants`, `batches`, `price_lists`, `tax_rates` |
| **Inventory** | `stock_levels`, `stock_movements`, `stock_adjustments`, `stock_transfers` |
| **Sales** | `invoices`, `invoice_items`, `quotations`, `proforma_invoices`, `sales_returns`, `credit_notes`, `coupons`, `loyalty_ledger` |
| **Purchases** | `suppliers`, `purchase_orders`, `purchase_invoices`, `purchase_items`, `purchase_returns` |
| **Parties** | `customers`, `party_ledger` |
| **Finance** | `payments`, `expenses`, `expense_categories`, `ledger_entries`, `cashbook` |
| **Vertical** | `tables`, `kots`, `appointments`, `bom`, `production_orders`, `students`, `fee_structures`, `fee_receipts` |
| **Comms** | `notifications`, `notification_settings` |
| **Online** | `online_orders`, `store_settings` |

---

## 11. API Requirements

- RESTful JSON API under `/api/v1`, with separate namespaces: `/api/v1/app/*` (business) and `/api/v1/admin/*` (platform).
- Standard conventions: pagination (`page`, `limit`), sorting, filtering, consistent error format `{ code, message, details }`.
- Every endpoint: authenticated, permission-checked, tenant-scoped, input-validated.
- Idempotency keys for invoice and payment creation to prevent duplicates.
- Documented via OpenAPI/Swagger.

---

## 12. Non-Functional Requirements

### 12.1 Security
- Secure authentication: salted password hashing (bcrypt/argon2), secure session/JWT handling with expiry and refresh, HTTP-only cookies.
- Optional 2FA for owners and platform admins (P2).
- Role-based access control on every API route.
- **Strict tenant isolation:** automated tests that prove cross-business access fails.
- Input validation and sanitization on **both frontend and backend**; protection against SQL injection, XSS, CSRF.
- Rate limiting, brute-force protection, secure headers (Helmet), HTTPS only.
- Secrets in environment config, never in source.
- Audit/activity logging for sensitive actions.

### 12.2 Reliability & Data Integrity
- ACID transactions for billing, inventory, and ledger updates.
- Scheduled backups with verified restore; backup retention policy.
- Graceful error handling with user-friendly messages and server-side logging.

### 12.3 Performance
- Billing screen interactions respond in **< 200 ms** (local actions) and invoice save in **< 1 s** at p95 under normal load.
- List pages load in **< 2 s** with pagination for datasets up to 100k rows per business.
- Product search results in **< 300 ms**.

### 12.4 Scalability
- Architecture designed so the data layer can migrate from SQLite to a server database (e.g., PostgreSQL) via a repository abstraction, if scale demands it.

### 12.5 Usability & Compatibility
- Latest two versions of Chrome, Edge, Firefox, Safari; mobile browsers.
- Works well on low-end devices and moderate network conditions.

### 12.6 Maintainability
- TypeScript throughout, linting/formatting, unit + integration + end-to-end tests, CI pipeline, documented setup.

---

## 13. Integrations & Future Considerations
- Payment gateway for subscription billing (e.g., Razorpay/Stripe), pluggable.
- UPI QR on invoices.
- SMS/WhatsApp/Email providers for notifications.
- GST e-invoicing / e-way bill APIs (future).
- Accounting export (Tally-compatible formats) (future).
- Hardware: thermal printers, barcode scanners, weighing scales, cash drawers.
- Native/PWA mobile experience with offline billing (future).

---

## 14. Subscription Plans (Proposed Starting Point)

| Capability | Free | Pro | Business |
|---|---|---|---|
| Users/staff | 1-2 | Up to 10 | Unlimited / high cap |
| Branches | 1 | 1-3 | Multiple |
| Invoices / month | Limited | High | Unlimited |
| Core billing, inventory, customers | ✔ | ✔ | ✔ |
| Reports & GST | Basic | Full | Full + advanced |
| Business-specific modules | Limited | ✔ | ✔ |
| Multi-branch, online store | ✘ | Partial | ✔ |
| Backup & restore | Manual | Scheduled | Scheduled + priority |
| Support | Community / docs | Email | Priority |

*Exact limits and pricing to be decided by the product owner and configurable from the admin panel (Feature Management).*

---

## 15. Success Metrics

| Metric | Target (6 months post-launch, indicative) |
|---|---|
| Time to create a standard bill | < 30 seconds |
| Onboarding completion (signup → first invoice) | > 70% within first session |
| Weekly active businesses / registered businesses | > 50% |
| Free → paid conversion | > 5% |
| Critical data-integrity incidents (stock/ledger mismatch) | 0 |
| Support tickets per 100 active businesses / month | Trending down |
| System uptime | ≥ 99.5% |

---

## 16. Acceptance Criteria (Release-Level)

1. A new user can sign up, choose a business category, and land in a correctly configured dashboard (navigation, forms, widgets match the category).
2. A cashier can create, print, and download a GST invoice; stock, customer balance, payments, and ledger all update **atomically**.
3. A failed save never leaves partial data (verified by fault-injection tests).
4. Business A can **never** read or modify Business B's data (verified by automated tests across all endpoints).
5. Permissions restrict both UI and API for each role.
6. Every listed module, button, form, and table is wired to the backend and database.
7. Platform admin can manage users, businesses, plans, features, payments, tickets, announcements, settings, and view audit logs, entirely separate from business dashboards.
8. Backup can be created and restored successfully, with data verified after restore.
9. UI works on desktop, tablet, and mobile, in light and dark themes.
10. Feature access changes correctly when a business's plan changes.

---

## 17. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **SQLite with many concurrent tenants** | Write contention, scaling limits | WAL mode, short transactions, repository abstraction for future DB migration, per-business DB option evaluated early |
| **Tenant data leakage** | Severe trust/legal impact | Centralized tenant-scoped data layer, mandatory `business_id`, isolation tests |
| **Scope size (24 core + 8 verticals + admin)** | Delays, quality drop | Phased delivery, strict P0/P1/P2 prioritization |
| **GST compliance complexity** | Incorrect invoices/returns | Validate against GST rules, review by a tax professional, thorough test cases |
| **Stock/ledger inconsistency** | Financial errors | Transactions, movement ledger as source of truth, reconciliation reports |
| **Hardware variability (printers/scanners)** | Poor POS experience | Standard print CSS/ESC-POS support, tested device matrix |
| **Performance on large catalogs** | Slow billing | Indexing, server-side search, pagination, caching |

---

## 18. Assumptions & Open Questions

**Assumptions**
- Primary market is India (INR, GST), with architecture open to other regions later.
- Web-first delivery; hosted SaaS model.
- One business may have multiple users and (on higher plans) multiple branches.

**Open Questions**
1. Deployment model: central hosted SaaS only, or also an on-premise/desktop-installable option?
2. Is offline billing required in v1?
3. Which payment gateway(s) for subscription collection?
4. Single shared SQLite database vs. one database file per business?
5. Is e-invoicing / e-way bill in scope for v1 or later?
6. Which notification channels (SMS/WhatsApp/email) are required at launch?
7. Final plan limits and pricing for Free / Pro / Business.
8. Languages required beyond English at launch?

---

## 19. Appendix: Module-to-Plan & Phase Map (Summary)

| Module | Phase | Plan Availability (proposed) |
|---|---|---|
| Dashboard, Billing/POS, Products, Customers, Payments, Settings | 1 | All |
| Inventory, Purchases, Suppliers, Expenses, Accounting, Reports, GST, Returns, Staff, Barcode, Notifications | 2 | Free (basic) → Pro/Business (full) |
| Offers/Loyalty, Multi-Branch, Quotations/Proforma, Online Store, Backup, Subscriptions | 3 | Pro / Business |
| Vertical modules | 4 | Per category; some gated to Pro/Business |
| Admin panel (core) | 1 | Platform only |
| Admin panel (full) | 3-5 | Platform only |