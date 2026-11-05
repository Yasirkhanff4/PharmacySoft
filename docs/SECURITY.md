# Security Notes

PharmaCare is a local-first, browser-based application. It provides an application-level login and role-based UI restrictions to prevent casual or accidental access on a shared device. It is **not** a server-grade access-control or encryption system.

## What is protected

- Passwords are never stored in plain text. Each account stores a random salt, iteration count and PBKDF2-SHA256 hash.
- WebCrypto is used in secure contexts (`https://`, `localhost`), with 210,000 iterations. A pure-JavaScript PBKDF2-HMAC-SHA256 fallback (60,000 iterations) supports plain-HTTP LAN deployments; it is slower and should not be treated as equivalent to server-side authentication.
- Sign-in has a five-attempt / 60-second lockout per browser.
- Sessions expire after 8 hours (30 days with “remember me”), are checked on startup, and are refreshed across tabs.
- Navigation, route access and management actions are gated by role permissions. Forbidden routes show an access-denied screen.
- Restore validates backup structure before writing. Backup files exclude credentials.
- Financial writes use Dexie transactions: sales deduct stock once, cancellations restore stock once, purchases add/reverse stock by difference and block unsafe deletion.

## What is not protected

- **IndexedDB and localStorage are not encrypted.** Anyone with access to the browser profile, device, or developer tools can read the database. The login screen is a lock, not cryptographic protection of business data.
- Client-side JavaScript and role checks can be bypassed or modified by a determined user with developer access. They are not a security boundary against the device owner.
- There is no central server, remote wipe, audit-proof logging, two-factor authentication or per-action server authorization.
- Backups are unencrypted JSON files. Protect them like any business record.
- The app cannot protect against malware, keyloggers, browser extensions, shared OS accounts, or a compromised machine.
- Invoice uniqueness and stock checks are enforced within one browser database. Two devices/browsers can independently issue the same invoice number.

## Recommended operating practice

1. Use a dedicated device/OS account for the pharmacy.
2. Serve the production build over HTTPS (or keep it on a trusted localhost) and do not expose the dev server to untrusted networks.
3. Use a strong, unique administrator password and separate accounts for staff. Do not share the administrator login.
4. Set screen lock and full-disk encryption on the device.
5. Keep exported backups on a separate protected drive/cloud account.
6. Sign out when leaving a shared terminal.
7. Review active users periodically under Settings → Users & Roles.
8. Do not use PharmaCare as the only copy of legally required records; export/print and retain documents according to local regulations.

## Multi-user/network deployments

For multiple devices, remote staff, or stronger security, place authentication and authorization behind a trusted server-side service (for example a backend API with hashed credentials, sessions, TLS, role checks, audit logs and a shared database). The current local implementation would need to be replaced rather than merely exposed on a network.

## Reporting a security concern

Document the version, browser, steps to reproduce and impact. Do not include real customer data or passwords in reports.
