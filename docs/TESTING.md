# Testing and Verification

Executed on 4 November 2026 against the rewritten app in the in-app Chromium browser (viewport 800 × 535, device scale 1.5), Vite dev server `http://localhost:5173`, and a production build.

Temporary test records were used. They were removed/reset after verification. No real pharmacy data was used.

## Automated checks

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm.cmd run lint` | Passed, 0 errors / 0 warnings |
| Unit tests | `npm.cmd run test` | 44/44 passed (Google OAuth backend + runtime config) |
| Production build | `npm.cmd run build` | Passed (Vite 8, 2118 modules, `dist/` generated) |
| Bundle | build output | JS 1,231.91 kB (359.46 kB gzip), CSS 56.66 kB (11.30 kB gzip); chunk-size warning only |
| Browser console | all ten routes | 0 error-level messages |

## Functional tests

### Authentication and users

| Test | Expected | Result |
| --- | --- | --- |
| First run route | Redirect to Create Administrator | Passed |
| Create first administrator | Account created and signed in | Passed |
| Password storage | Salt + hash, no plaintext | Passed — records contained `salt`, `hash`, `algorithm`, `iterations`; no `password` field |
| Logout / login as administrator | Session changes correctly | Passed |
| Create Cashier account | User appears in directory, can sign in | Passed |
| Cashier navigation | Only Dashboard, POS, Sales History, Medicines, Customers | Passed |
| Cashier direct `/settings` and `/purchases` | Access restricted | Passed both |
| Cashier medicines page | View/export only; no add/edit/delete actions | Passed |
| Session persistence on reload | Signed-in state retained | Passed |

### Suppliers, medicines and stock

| Test | Expected | Result |
| --- | --- | --- |
| Add supplier | Saved, listed, counts update | Passed |
| Add medicine (Paracetamol 500 mg, qty 100) | Saved with batch/expiry/prices/supplier | Passed |
| Add out-of-stock medicine (Amoxicillin, qty 0) | Listed as Out | Passed |
| Stock adjustment +5 | 80 → 85 with toast | Passed |
| Stock adjustment −5 | 85 → 80 | Passed |
| Delete supplier with linked medicines | Warning shown, cancel available | Passed |

### POS

| Test | Expected | Result |
| --- | --- | --- |
| Barcode + Enter | Adds exact medicine to cart | Passed |
| Quantity change | Line total and grand total recalculate | Passed |
| Discount | Subtotal − discount = grand total (160 − 10 = 150) | Passed |
| New customer at checkout | Customer record created and linked | Passed (`Ayesha Khan`, phone 03009876543) |
| Invoice generation | Unique prefixed invoice | Passed (`INV-…`, later `CCP-…` after prefix change) |
| Stock deduction | 100 → 80 after selling 20 | Passed |
| Second sale | 80 → 78 after selling 2 | Passed |
| Double-submit guard | 3 rapid clicks produced one invoice and one stock deduction | Passed (stock 80 → 79, one new sale) |
| Empty-cart guard | Complete Sale disabled | Passed |

### Sales history

| Test | Expected | Result |
| --- | --- | --- |
| Completed-sale totals | Revenue Rs. 1,750, COGS Rs. 1,100, gross Rs. 650 for two sales | Passed |
| Cancel invoice Rs. 150 | Status cancelled, stock restored once | Passed — revenue Rs. 1,600, gross Rs. 600, COGS Rs. 1,000, coverage 1/1 |
| Cancelled invoice display | Remains in history as Cancelled | Passed |
| CSV export / print | Download and print window | CSV verified; print window opened with invoice title, then native print dialog was closed |

### Purchases

| Test | Expected | Result |
| --- | --- | --- |
| Create two-line purchase (20 Amoxicillin + 10 Paracetamol) | Stock +20 / +10, total Rs. 1,100 | Passed |
| Edit quantities to 25 / 12 | Stock difference only (+5 / +2), total Rs. 1,350 | Passed — stock 25 / 92, “Revised 1 time” |
| Delete after selling 1 purchased unit | Blocked with stock explanation | Passed |
| Cancel sale, then delete purchase | Stock reversed correctly | Passed — Amoxicillin 25 → 0, Paracetamol 92 → 80 |
| Duplicate purchase invoice | Rejected with inline error, no stock change | Passed (`DUP-001`) |

### Customers and expenses

| Test | Expected | Result |
| --- | --- | --- |
| Auto-created customer | Order count 1, spend Rs. 1,600 | Passed |
| Add customer | Listed with zero orders | Passed |
| Edit customer | Email updated | Passed |
| Delete customer without sales | Removed with confirmation | Passed |
| Add expense | Rs. 15,000 rent recorded, totals update | Passed |

### Reports

| Test | Expected | Result |
| --- | --- | --- |
| Summary | Revenue Rs. 1,680, COGS Rs. 1,050, gross Rs. 630, expenses Rs. 15,000, net −Rs. 14,370 | Passed |
| Group by day / week / month / year | Correct period labels and same totals | Passed all four |
| Top seller | Paracetamol, 20 units, Rs. 1,600 | Passed |
| Inventory snapshot | 2 records, 80 units, cost Rs. 4,000, retail Rs. 6,400 | Passed |
| Low/out/expired/expiring | Amoxicillin shown as out of stock | Passed |
| CSV export | Sectioned CSV content checked | Passed — financial summary, breakdown, top sellers, supplier summary, inventory snapshot values matched UI |

### Backup, restore and settings

| Test | Expected | Result |
| --- | --- | --- |
| Save pharmacy profile | Sidebar/name/address/phone updated | Passed |
| Settings after full reload | Name, contact and invoice settings persist | Passed |
| Invoice prefix | New sale uses `CCP-…` and footer/profile print | Passed |
| Download backup | JSON with 9 records, settings and logo | Passed |
| Credentials excluded | No user/password/hash/salt fields in backup | Passed |
| Restore preview | Counts and export timestamp shown | Passed |
| Restore replace | Data restored, app reloads, counts preserved | Passed |
| Invalid backup | Rejected before writing with “missing its database section” | Passed |

### Cloud synchronization, device enrollment and Connect with Google

Backend unit tests cover session sealing, PKCE/state, cancellation, origin checks, method and configuration failures, plus the runtime configuration store and project-switch guard.

| Test | Expected | Result |
| --- | --- | --- |
| Session cookie sealing | Round-trips, rejects tampering, never contains the refresh token or email in clear text | Passed (unit) |
| Authorization start | Redirect to Google with state, PKCE S256, offline access, sealed state cookie; no client secret in the URL | Passed (live HTTP) |
| Unconfigured backend | `503 server_not_configured` without leaking secrets | Passed (unit + live HTTP) |
| Missing device identity | `401 missing_device_token` | Passed (unit + live HTTP) |
| Foreign origin | `403 origin_not_allowed` | Passed (unit + live HTTP) |
| Cancelled consent | Redirect back with `reason=cancelled`, session untouched | Passed (unit) |
| Expired/invalid state | State cookie cleared, safe error redirect | Passed (unit) |
| Revoked Google grant | Card shows the reconnect banner with the account email; local data and sync untouched | Passed (browser, hand-sealed cookie) |
| Admin gate | Device token verified against JWKS, member document read with the same token | Passed (live HTTP) |
| Runtime configuration | Complete config round-trips; incomplete/corrupt values refused; project switch blocked with pending changes | Passed (unit) |
| Device enrollment | Code issue/redeem, 8-character format, 15-minute expiry, single use | Passed (rules tests, 29/29) |
| Authorized/unauthorized Firestore access | Authorized devices sync; unenrolled devices are denied | Passed (rules tests) |
| Full Google consent, project list and Web config | Real OAuth client, consent screen and Management API | **Not executed** — requires a real OAuth client and test user |

### Responsive layout

Probed with same-origin iframes at exact widths:

| Width | Sidebar | Menu button | Dashboard stat columns | Horizontal overflow |
| --- | --- | --- | --- | --- |
| 1280 px | Visible (268 px) | Hidden | 4 | None |
| 768 px | Off-canvas | Visible | 2 | None |
| 390 px | Off-canvas | Visible | 1 | None |

At 800 px, all ten routes had no horizontal overflow, and the off-canvas drawer opened/closed correctly.

## Not executed / limitations of this test run

- The full Google consent, project listing and Web App configuration flow was not executed; it requires a real OAuth Web client, a consent screen and enabled Google APIs. All error paths and the backend logic are unit-tested.
- Native print output was not physically printed; the print window opened and the browser print dialog appeared. PDF/paper output depends on the browser print settings.
- Multi-tab concurrent checkout conflict testing was not performed beyond the synchronous double-click guard and transaction-level checks.
- Very large datasets (tens of thousands of records) were not benchmarked.
- Barcode hardware scanner input was simulated with keyboard events and barcode text entry, not a physical scanner.
- HTTPS-specific WebCrypto behavior was exercised on localhost; the plain-HTTP fallback path was not separately benchmarked.

## Reproducing the checks

```powershell
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run dev
npm.cmd run dev:api
```

Then follow the scenarios in `docs/USER_GUIDE.md` using temporary records. Export a backup before testing destructive actions.
