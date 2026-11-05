# PharmaCare User Guide

This guide walks through daily use of PharmaCare. All data is stored locally in the browser on the device where you use the app.

## 1. First sign-in and accounts

### Create the first administrator

1. Open PharmaCare.
2. On **Create Administrator**, enter your full name, username and password twice.
3. Password rules: at least 8 characters, including at least one letter and one number.
4. Select **Create Administrator Account**.

You are signed in automatically. The account is stored locally with a salted PBKDF2-SHA256 hash; the plain password is never saved.

### Sign in and out

- Sign in with your username and password on the welcome screen.
- “Keep me signed in on this device for 30 days” keeps the session in `localStorage`; otherwise it is kept for the browser session and expires after 8 hours.
- Use the sign-out control in the sidebar or top bar. Signing out requires confirmation.
- Five failed sign-in attempts lock the login form for 60 seconds.

### Manage staff

Administrators open **Settings → Users & Roles** to:

- add staff accounts with a role (Administrator, Pharmacist, Cashier),
- edit names/usernames/roles/active status,
- reset another user’s password,
- deactivate or delete accounts (the last active administrator and your own account are protected).

Every user can change their own password under **Settings → My Account**.

## 2. Navigation and layout

- Desktop/tablet: use the dark navy sidebar. On narrow screens open it with the menu button and close it with the backdrop or X.
- The top bar shows the current page, today’s date, a **New Sale** shortcut, and the signed-in user.
- Only modules allowed by your role appear in navigation. Directly opening a forbidden URL shows **Access restricted**.
- Dialogs and toasts replace browser alert/confirm prompts. Errors appear inline near the relevant form.

## 3. Dashboard

The dashboard reads live IndexedDB data and shows:

- total medicine records, today’s sales, all-time completed sales,
- low-stock count, expired count, expiring-soon count,
- inventory cost value and potential retail value, total stock units,
- revenue summaries (today/month/all time),
- gross profit, expenses and net profit for the month and all time,
- purchase and expense summaries,
- inventory alerts with links to filtered medicine views,
- inventory value by category, recent sales and recent purchases,
- cost-coverage: how many completed sales contain recorded cost data.

Shortcuts on the dashboard open POS, a new purchase, reports, backup, the add-medicine dialog, or the matching stock filter.

## 4. Medicines and stock

### Add a medicine

1. Open **Medicines → Add Medicine**.
2. Complete name, batch number and expiry date (required), plus generic name, category, company, supplier, barcode, purchase price, sale price and opening quantity.
3. Save. The medicine appears immediately in inventory and POS.

Each row is a batch. Add a separate record when the same medicine arrives with a different batch/expiry.

### Search and filter

Search matches name, generic name, barcode, batch and company. Filter by category, supplier, stock status (in/low/out/expired/expiring) and sort by name, stock, expiry or stock value. Export the current list to CSV.

### Adjust stock

Use the **Adjust stock** action on a row:

- **Add to stock** — receive units,
- **Remove from stock** — write off damaged/lost units,
- **Set exact stock level** — cycle-count correction.

A reason is optional but recommended. Adjustments do not create purchase invoices or sales; they are recorded in the medicine record’s update time. Use purchases for supplier receipts and POS for sales.

### Edit or delete

- Edit prices, batch, expiry, supplier and other details from the row action.
- Deleting a medicine removes the inventory record. Historical sales/purchases keep their stored item snapshots. If a medicine has already been sold, cancelling that old sale may report that stock could not be restored because the medicine record no longer exists.

Expired and out-of-stock items cannot be added to a POS sale.

## 5. Point of sale (POS)

1. Open **POS / Billing**.
2. Scan a barcode and press **Enter**, or search by name/generic/batch and select **Add**.
3. Adjust quantities with +/− or type a quantity in the cart.
4. Optionally choose an existing customer, or enter a new customer name and phone. A new customer is created automatically at checkout; an existing customer with the same phone is reused.
5. Enter a discount amount (cannot exceed the subtotal).
6. Choose payment method, add a note, then select **Complete Sale**.

What happens at checkout:

- The cart, customer and invoice are validated.
- The sale and stock deductions are written in one Dexie transaction.
- Stock is re-read and checked inside the transaction; expired or over-sold items abort the sale.
- Invoice numbers are prefixed from Settings and checked for uniqueness; the save is guarded against double-clicks.
- A cost price snapshot is saved on each line for future profit reporting.

The success screen shows the invoice and allows **Print Receipt** or **Start New Sale**. Receipt printing opens the browser print dialog.

## 6. Sales history

- Filter by date range, status (completed/cancelled) and payment method; search invoice, customer, phone or cashier.
- Stats show invoice counts, completed revenue, gross profit, COGS and cost-data coverage.
- **View** opens the invoice; **Print** opens a print window; **Export CSV** downloads the filtered list.
- **Cancel sale** asks for confirmation, marks the invoice cancelled and returns every sold quantity to stock exactly once inside a transaction. The invoice remains in history with cancellation metadata.

Cancelled sales are excluded from revenue/profit but remain visible for audit.

## 7. Purchases

1. Open **Purchases → New Purchase**.
2. Choose the supplier, purchase date, unique invoice number and optional notes.
3. Select a medicine, quantity and purchase price, then **Add Item**. Repeat for multiple medicines.
4. Save. Stock is added exactly once inside a transaction.

Editing a purchase applies only the **difference** between the old and new quantities, so stock is never added twice. The purchase row shows `Revised N time(s)`.

Deleting a purchase reverses the stock it added. Deletion is blocked if that stock has already been sold and insufficient units remain; use **Edit** to correct the invoice instead. Purchase totals are reported separately from profit.

## 8. Suppliers

Add/edit supplier name, phone, email and address. The directory shows linked medicine count, purchase invoice count and purchase value. Deleting a supplier warns about linked records; purchase history keeps the supplier name, and medicine supplier links are cleared.

## 9. Customers

Add/edit name, phone, email and address. Phone numbers must be unique so sales remain linked to the right person. The directory shows order count, total spend and last visit based on completed sales. Deleting a customer with completed sales is blocked or warned; sales history is preserved.

Customers are also created automatically during POS checkout when a name and phone are supplied.

## 10. Expenses

Record rent, electricity, salaries, transport, utilities, maintenance, internet, office supplies or other costs. Each record has a title, category, amount, payment method, date and optional description. Filter by search, category, month or date range; export CSV. Expenses reduce net profit in reports and the dashboard.

## 11. Reports

Choose a date range or a preset (Today, This Week, This Month, This Year, All Time), then group sales by day/week/month/year.

Report sections:

- Financial summary: revenue, COGS, gross profit, operating expenses, net profit, purchase spending, and sales excluded for missing cost data.
- Period breakdown: sales, COGS, gross profit, purchases, expenses and net profit per period.
- Top sellers: units, revenue, known cost, gross profit and cost coverage.
- Supplier summary: invoices, units, value and last purchase in the period.
- Inventory snapshot: current records/units, cost value, retail value, potential margin, low/out-of-stock, expired and expiring lists, category value.
- **Export CSV** downloads a sectioned Excel-compatible CSV.
- **Print** opens a print-ready report.

## 12. Settings

### Pharmacy Profile

Name, phone, email, address, currency and logo. The name/logo appear in the sidebar and on printed documents. Settings persist in `localStorage` and survive restarts.

### Invoices & Alerts

- Invoice prefix (letters, numbers, dash and slash only),
- receipt footer,
- low-stock threshold,
- expiry warning window (days).

Changing the low-stock threshold or expiry window immediately changes dashboard, inventory and report flags.

### My Account

Change your own password by entering the current password and a new password twice.

### Users & Roles

Create/edit/deactivate/delete local accounts and reset passwords. Role permissions are listed on the page.

### Data Protection

Download a JSON backup, restore a validated backup (Replace or Merge), and inspect local storage usage and table counts. See `BACKUP_AND_RESTORE.md`.

### About

App version, storage model and security notes.

## 13. Common messages

| Message | Meaning / action |
| --- | --- |
| Expired medicine cannot be sold | Remove/replace the batch; expired items are blocked in POS. |
| Insufficient stock | Another action reduced stock; reload inventory and retry. |
| Invoice number already exists | Purchase invoices must be unique; change the invoice number. |
| Cannot delete purchase: only N units left | Purchased stock was sold. Use Edit to reconcile instead. |
| Cost coverage below 100% | Some sales have no cost snapshot; they are excluded from profit. |
| Access restricted | Your role lacks the module permission; ask an administrator. |
| Backup missing database section / invalid record | The selected JSON is not a PharmaCare backup; choose a fresh export. |
