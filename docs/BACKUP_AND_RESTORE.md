# Backup and Restore

PharmaCare data lives in the browser’s IndexedDB and `localStorage`. There is no cloud copy. Regular exported backups are the only protection against clearing browser data, a damaged profile or moving to another device.

## What a backup contains

A PharmaCare backup is a JSON file with:

- `app`, `appVersion`, `schemaVersion`, `exportedAt` and record counts,
- `settings` (pharmacy profile, currency, invoice defaults, thresholds),
- `logo` (data URL, if set),
- `data` — every Dexie table (`medicines`, `syncQueue`, `sales`, `suppliers`, `purchases`, `customers`, `expenses`).

**Staff accounts and password hashes are intentionally excluded.** Restoring data does not recreate users or sessions. After restoring on a new browser/device, create the administrator account again and recreate staff accounts under Settings → Users & Roles.

## Download a backup

1. Sign in as an Administrator.
2. Open **Settings → Data Protection**.
3. Select **Download Backup**.
4. Store the JSON file on a separate drive/cloud folder. The filename includes the date and time.
5. The page shows the last backup time and filename (metadata only, stored locally).

Recommended cadence: at least daily after closing the till, plus before any restore, browser update or device change. Keep several historical copies.

## Restore a backup

1. Download a fresh backup of the current data first (safety copy).
2. Open **Settings → Data Protection**.
3. Select **Choose Backup File** and pick a `.json` PharmaCare backup.
4. Review the preview: export time, app version and record counts per table.
5. Choose a mode:
   - **Replace all current data** — clears known tables and writes the backup records. Recommended for disaster recovery or moving to a clean browser.
   - **Merge into current data** — keeps existing records and inserts/updates records by `id`. Use with care; merge does not resolve business-rule conflicts beyond record IDs.
6. Confirm **Replace data** / merge.
7. The app reloads. Sign in again if the session expired.

Restoring also overwrites pharmacy settings and the logo when present in the backup.

## Validation

Before writing anything, the app checks that:

- the file is a JSON object,
- a `data` object exists,
- at least one recognised table is present,
- each recognised table is an array,
- every record is a plain object.

Unknown tables are ignored. Malformed tables/records reject the whole restore with an inline message. Validation does not guarantee that relationships are coherent (for example a sale pointing at a missing medicine); such records are preserved because they are audit history.

## Safety notes

- Replace mode is destructive. Export first.
- A backup from a newer, unsupported schema should not be trusted; known tables are restored, but future migration logic is not applied.
- Restoring on a different origin/port creates or replaces data only for that origin.
- Clearing browser site data deletes IndexedDB and `localStorage`, including settings and accounts. Backups are external files and are not affected.
- Do not edit backup JSON by hand unless you understand the schema and business invariants.

## Moving to another computer

1. On the old computer: **Settings → Data Protection → Download Backup**.
2. Install/serve PharmaCare on the new computer.
3. Create the first administrator account.
4. Restore the backup with **Replace**.
5. Recreate staff accounts and roles (credentials are not in the backup).
6. Verify counts on the Data Protection page against the backup preview.
7. Keep the old computer’s browser profile until the new installation is verified.
