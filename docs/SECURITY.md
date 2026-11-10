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
- There is no central server for business records, remote wipe, audit-proof logging, two-factor authentication or per-action server authorization. Cloud synchronization adds a Firestore backend for records, but reads/writes are still authorized by client-supplied Firebase ID tokens and Firestore rules, not a per-action audit service.
- Backups are unencrypted JSON files. Protect them like any business record.
- The app cannot protect against malware, keyloggers, browser extensions, shared OS accounts, or a compromised machine.
- Invoice uniqueness and stock checks are enforced within one browser database. Two devices/browsers can independently issue the same invoice number.

## Cloud synchronization and Google authorization

Cloud synchronization uses Firebase Authentication (anonymous device accounts) and Cloud Firestore. The "Connect with Google" flow uses a small serverless backend in `api/` to read or create Firebase resources on the administrator's behalf.

### Token handling

- The Google authorization code is exchanged **on the server**. The browser never receives the client secret, an access token or a refresh token.
- The refresh token is sealed with AES-256-GCM and stored in an `HttpOnly`, `SameSite=Lax` cookie (`pharmacy_google_session`), marked `Secure` on HTTPS. The key derives from `OAUTH_SESSION_SECRET`, which exists only in the server environment.
- Access tokens are held in serverless function memory only, for the duration of a request (with a short-lived cached refresh path). They are never written to the browser or to a database.
- State and PKCE verifiers are sealed in a separate short-lived cookie (10 minutes). The callback rejects missing, expired or mismatched state, and rejects unexpected origins.
- Disconnecting calls Google's revocation endpoint, clears the cookie and touches nothing else: local Dexie data, the outbox and device authorization are unchanged.

### Permissions

- A normal connection requests only `openid email https://www.googleapis.com/auth/firebase.readonly`.
- `https://www.googleapis.com/auth/cloud-platform` is requested only when the administrator explicitly confirms **Create Firebase Web App**, with `include_granted_scopes=true`. Existing read-only grants continue to work.
- The backend never creates projects, databases or rules, never deletes resources and never writes business records. Creating a Web App is the only mutating action, and only after an explicit confirmation dialog.
- Firestore security rules are never modified or bypassed. The readiness report only reads the published ruleset and warns when it denies everything or does not match this app.

### Who may call the API

Every endpoint verifies the caller's Firebase ID token against Google's public JWKS (issuer, audience and expiry) and then reads the caller's own member document through Firestore REST **with that same token**, so the deployed rules decide. A device that is not an active administrator gets `403 device_not_authorized`. Requests also require a same-origin `Origin` header from the `APP_ORIGIN` allowlist.

### What is still not protected

- A compromised Google account (or a malicious project owner) can read or change the Firebase project itself. Use a dedicated pharmacy Google account with strong 2FA and minimal project membership.
- The public Firebase Web configuration is not a secret. It identifies the project; security depends on Firestore rules and enrolled member documents, not on hiding it.
- Business records in IndexedDB remain unencrypted on the device, as described above.
- Serverless logs must not contain tokens or personal data; the handlers avoid logging request bodies, cookies and Google responses.
- An XSS flaw in the app could issue requests as the signed-in device. No refresh token is exposed to JavaScript, but the device's Firebase ID token is available to the page by design.

## Recommended operating practice

1. Use a dedicated device/OS account for the pharmacy.
2. Serve the production build over HTTPS (or keep it on a trusted localhost) and do not expose the dev server to untrusted networks.
3. Use a strong, unique administrator password and separate accounts for staff. Do not share the administrator login.
4. Set screen lock and full-disk encryption on the device.
5. Keep exported backups on a separate protected drive/cloud account.
6. Sign out when leaving a shared terminal.
7. Review active users periodically under Settings → Users & Roles.
8. Do not use PharmaCare as the only copy of legally required records; export/print and retain documents according to local regulations.
9. Use a dedicated Google account for Connect with Google, enable two-step verification on it, and review third-party access periodically.

## Multi-user/network deployments

For multiple devices, remote staff, or stronger security, place authentication and authorization behind a trusted server-side service (for example a backend API with hashed credentials, sessions, TLS, role checks, audit logs and a shared database). The current local implementation would need to be replaced rather than merely exposed on a network.

## Reporting a security concern

Document the version, browser, steps to reproduce and impact. Do not include real customer data or passwords in reports.
