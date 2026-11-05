# PharmaCare — Pharmacy Management & POS

PharmaCare is a local-first pharmacy management application built with React, Vite and Dexie (IndexedDB). It covers inventory, point of sale, purchase invoices, suppliers, customers, expenses, reporting, staff roles, backups and pharmacy settings in one responsive desktop/tablet/mobile interface.

The application is an upgrade of the existing `PharmacySoft` project. The database name (`PharmacyDatabase`) and schema version 6 are unchanged, so existing local records continue to load. New optional fields are stored on new records only (for example `costPrice`, `supplierId`, `customerId`, `cashier`, `updatedAt`).

## Feature overview

| Module | What it does |
| --- | --- |
| Dashboard | Live medicine, stock, sales, expense, profit and alert figures from IndexedDB; today/month/all-time summaries; inventory alerts; recent sales and purchases. |
| Medicines | Batch-level inventory, search, filters, sorting, CSV export, add/edit/delete, safe stock adjustments, expiry and low-stock status, printable stock view. |
| POS / Billing | Barcode scan + Enter, catalog search, cart quantities, discounts, customer selection or auto-creation, payment method, notes, unique invoices, transactional stock deduction, receipt view and print. |
| Sales History | Date/status/payment filters, revenue/COGS/gross-profit/cost-coverage stats, invoice view/print, CSV export, safe cancellation with exactly-once stock restore. |
| Purchases | Supplier invoices with multiple medicine lines, duplicate-invoice protection, stock added exactly once, stock-difference reconciliation on edit, blocked deletion when purchased stock was already sold, history/filter/print. |
| Suppliers | Contact directory, linked-medicine and purchase counts, CRUD, CSV export, linked-record warnings. |
| Customers | Directory, phone-number uniqueness, order/spend history, CRUD, CSV export, automatic creation from POS. |
| Expenses | Operating costs by category, date and payment method, monthly/today totals, CRUD, CSV export. |
| Reports | Date presets/range, day/week/month/year grouping, revenue, COGS, gross/net profit, purchase spending, expenses, top sellers, supplier summary, inventory snapshot, low/out/expired/expiring lists, category chart, CSV export and print. |
| Settings | Pharmacy name/contact/address/currency, logo, invoice prefix/footer, low-stock and expiry thresholds, account password change, local users and roles, JSON backup/restore, storage usage and security notes. |

## Technology

- React 19 + Vite 8
- Dexie 4 / IndexedDB (database `PharmacyDatabase`, schema version 6)
- React Router 7
- Lucide icons
- Plain CSS design system in `src/App.css`
- Browser WebCrypto PBKDF2-SHA256 with a pure-JS fallback for non-secure contexts

Firebase is listed in `package.json` but is **not configured or used** by PharmaCare. The app is fully local and does not require a network connection after assets are loaded.

## Getting started

Requirements: Node.js 20+ and npm.

```powershell
npm install
npm run dev       # http://localhost:5173
npm run lint      # ESLint
npm run build     # production build in dist/
npm run preview   # serve the production build
```

On Windows PowerShell, use `npm.cmd run <script>` if script execution policy blocks `npm.ps1`.

### First run

1. Open the app. With no local users it redirects to **Create Administrator**.
2. Enter a name, username and a password of at least 8 characters containing a letter and a number.
3. The first administrator is created locally and signed in.
4. Configure the pharmacy profile under **Settings → Pharmacy Profile**, then add suppliers/medicines or restore an existing backup.

### Default roles

| Permission area | Administrator | Pharmacist | Cashier |
| --- | --- | --- | --- |
| Dashboard | Yes | Yes | Yes |
| POS / sales | Yes | Yes | Yes |
| Sales history / cancel | Yes | Yes | View only |
| Medicines | Manage | Manage | View |
| Purchases / suppliers | Manage | Manage | No |
| Customers | Manage | Manage | Manage |
| Expenses | Manage | Manage | No |
| Reports | Yes | Yes | No |
| Settings / users / backup | Yes | No | No |

Role checks control navigation, page access and action buttons. They are application-level controls, not a server security boundary; see `docs/SECURITY.md`.

## Data storage and persistence

| Data | Storage |
| --- | --- |
| Medicines, sales, purchases, suppliers, customers, expenses, sync queue | IndexedDB `PharmacyDatabase` |
| Pharmacy settings and logo | `localStorage` (`pharmacySettings`, `pharmacyLogo`) |
| Staff accounts, password hashes and session | `localStorage` / `sessionStorage` (`pharmacyUsers`, `pharmacySession`, `pharmacyAuthLock`) |
| Last backup metadata | `localStorage` (`pharmacyLastBackup`) |

Data belongs to the browser profile and origin used to open the app. It persists across reloads, restarts and normal browser closure. It is **not** shared between browsers, devices or origins (for example `localhost:5173` and `localhost:4173` have separate databases).

Clearing browser site data, using private/incognito mode, changing origin/port, or selecting “clear cookies and site data” will remove the database. Keep exported backups.

## Backups and restore

Use **Settings → Data Protection → Download Backup**. The JSON file contains all Dexie tables, pharmacy settings and the logo. It intentionally does **not** contain staff accounts or password hashes.

Restore validates the file structure before changing data and supports:

- **Replace** — clears known tables and writes the backup records (recommended).
- **Merge** — keeps existing records and inserts/updates by `id`.

The app reloads after a successful restore. Always download a fresh backup before restoring, especially before choosing Replace. See `docs/BACKUP_AND_RESTORE.md`.

## Profit and reporting rules

- **Revenue** = grand totals of completed sales in the selected period.
- **COGS** = quantity × cost snapshot captured when each sale was checked out.
- **Gross profit** = revenue from sales with recorded cost − COGS.
- **Net profit** = gross profit − operating expenses in the period.
- **Purchase spending** is reported separately and is not subtracted from profit, to avoid double-counting stock.
- Sales created before cost snapshots existed (legacy records without item `costPrice`) are excluded from profit and disclosed through the cost-coverage indicator.
- Inventory snapshot values use current stock × purchase/sale price and are independent of the report date range.

## Printing

Sales receipts, purchase invoices and reports open a print-ready window and then invoke the browser print dialog. Use the browser’s “Save as PDF” option for PDF copies. Pop-up blocking must allow the app to open print windows.

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Backup and restore](docs/BACKUP_AND_RESTORE.md)
- [Security notes](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Testing and verification](docs/TESTING.md)

## Project structure

```text
src/
  App.jsx                 routes, providers, permission guards
  App.css                 design system, responsive and print styles
  components/             layout, sidebar, invoice view, UI primitives
  context/                local auth/session and dialogs/toasts
  database/db.js          Dexie schema versions 1–6
  hooks/useSettings.js    persisted settings and logo
  lib/                    constants, crypto, formatting, backup, printing
  pages/                  Dashboard, POS, inventory, people, finance, settings
```

## Known limitations

- Local-only, single-browser application: there is no server, multi-device sync or conflict resolution.
- Application login is a local lock, not encryption. Someone with access to the browser profile or developer tools can read IndexedDB.
- Invoice uniqueness is enforced per local database; it is not a central sequence shared by multiple devices.
- Deleting a medicine does not rewrite historical invoices; those invoices keep their stored name/batch/price snapshots.
- Restoring a backup made by a much newer schema is not supported; the app validates known tables and record shapes but does not migrate future schemas.
- The production bundle is a single JavaScript chunk (~581 kB, ~167 kB gzip). Splitting by route is possible if bundle size becomes important.
