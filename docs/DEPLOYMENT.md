# Deployment

## Production build

```powershell
npm install
npm run lint
npm run build
```

The static output is written to `dist/`. It contains `index.html`, hashed CSS/JS assets and any files from `public/`.

`npm run preview` serves the build locally for verification. Any static host can serve `dist/` (IIS, Apache, Nginx, GitHub Pages, Netlify, Cloudflare Pages, S3/CloudFront, or a local file server).

### SPA routing

The app uses React Router browser history. The host must rewrite unknown paths to `index.html`; otherwise refreshing `/medicines` returns 404.

Nginx example:

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

IIS `web.config` example:

```xml
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="SPA Routes" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>
      </rules>
    </system.webServer>
  </configuration>
</configuration>
```

### HTTPS and secure contexts

WebCrypto requires a secure context. Use HTTPS in production for the stronger PBKDF2 path. Plain HTTP on a LAN address falls back to the JavaScript PBKDF2 implementation; login still works, but treat the deployment as less secure and avoid exposing it beyond a trusted network.

### Origin stability

IndexedDB and `localStorage` are scoped to an origin (scheme + host + port). Changing the hostname, port, HTTP/HTTPS or serving path creates a different data store. Choose the final URL before entering production data, or export/restore a backup when moving origins.

## Recommended deployment steps

1. Build and test on the target machine (`npm run test`, `npm run build`, `npm run preview`).
2. Deploy `dist/` with SPA rewrites over the final HTTPS URL. To use Connect with Google, also deploy the `api/` functions and set the server variables described below.
3. Open the app and create the administrator account.
4. Configure pharmacy settings and create staff accounts.
5. Restore an existing backup if migrating, then verify record counts.
6. Download a fresh backup and store it off-device.
7. Record the URL, version and backup location for staff.

## Cloud synchronization and Connect with Google

PharmaCare can synchronize records between devices through Cloud Firestore. The Firebase Web configuration can come from build-time `VITE_FIREBASE_*` values or be loaded at runtime by an administrator through **Settings → Firebase Cloud → Connect with Google**.

The runtime flow needs a small server component, because a browser must never hold the Google client secret or a refresh token:

| Piece | Location | Purpose |
| --- | --- | --- |
| Static app | `dist/` (any host, or Vercel) | React UI, Dexie, Firebase SDK |
| Google endpoints | `api/google/*.js` (Vercel Functions) | OAuth code exchange, encrypted session cookie, Firebase Management API calls |
| Device identity | Firebase Authentication (anonymous) | Every API call carries the device's Firebase ID token |
| Authorization | Firestore rules + member documents | The deployed rules decide whether this device may read/write |

Endpoints:

- `GET /api/google/start` — starts the authorization-code flow (PKCE, state, minimal scopes).
- `GET /api/google/callback` — validates state and origin, exchanges the code, seals the session cookie.
- `GET /api/google/session` — connection status, granted scopes and connected account.
- `GET /api/google/projects` — Firebase projects visible to the connected account.
- `GET /api/google/inspect?projectId=` — read-only readiness report (Web App, Firestore database, published rules).
- `GET /api/google/config?projectId=&appId=` — public Web App configuration.
- `POST /api/google/webapps` — creates a Web App only after explicit confirmation.
- `POST /api/google/disconnect` — revokes the Google grant; local data and sync are untouched.

### One-time Google Cloud setup

1. Open Google Cloud Console with the account that owns (or can administer) the Firebase project.
2. Enable **Firebase Management API** and **Cloud Resource Manager API**. For the readiness checks, also enable **Cloud Firestore API** and **Firebase Rules API**.
3. Configure the OAuth consent screen (External, or Internal for a Workspace organization):
   - App name: PharmaCare (or the pharmacy name).
   - Support email and developer contact.
   - Scopes: `openid`, `email`, `https://www.googleapis.com/auth/firebase.readonly`.
   - While the app is in *Testing*, add every Google account that may connect as a test user.
4. Create an OAuth client of type **Web application** with authorized redirect URIs:
   - `http://localhost:5173/api/google/callback` (development).
   - `https://<production-domain>/api/google/callback`.
5. Copy the client ID and client secret into the server environment (never into a `VITE_` variable).

The write scope `https://www.googleapis.com/auth/cloud-platform` is requested only when an administrator explicitly chooses **Create Firebase Web App**, and only with `include_granted_scopes=true`. A normal connection stays read-only.

### Server environment variables (Vercel)

| Variable | Required | Notes |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Yes | OAuth Web client ID. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Yes | OAuth Web client secret; server only. |
| `OAUTH_SESSION_SECRET` | Yes | 32+ random characters; seals the HttpOnly cookie. Rotating it disconnects every Google session (local data and sync are unaffected). |
| `APP_ORIGIN` | Yes | Comma-separated allowlist, e.g. `https://pharmacy.example.com`. |
| `FIREBASE_PROJECT_ID` | Yes | Project used to verify that the calling device is an active workspace administrator. |
| `FIREBASE_WORKSPACE_ID` | No | Defaults to `main`. |

Add them in Vercel under **Project → Settings → Environment Variables** for Production (and Preview/Development if used), then redeploy. Vercel detects `api/**/*.js` automatically; no `vercel.json` is required.

`GOOGLE_OAUTH_CLIENT_SECRET` must also be present locally in `.env.local` for `npm run dev:api`; keep that file out of version control.

### Using Connect with Google

1. Sign in locally and wait until **Firebase Cloud** shows *Authenticated* and *Authorized* for this device.
2. Open **Settings → Firebase Cloud → Connect with Google** and approve read-only access in the popup.
3. Select one of the account's Firebase projects. The readiness report checks for a Web App, the `(default)` Firestore database and the published security rules.
4. Choose **Connect this project**. The app stores only the public Web App configuration in `localStorage` and reloads.

Only the public configuration is retained: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` and `appId`. No Google token, client secret, service-account key or refresh token is written to the browser.

### Project switching

- Switching to another project requires explicit confirmation.
- The switch is refused while the outbox has pending or failed changes, because the queue is not project-tagged and must not be uploaded into a different project. Run **Sync Now** first.
- Local Dexie data is never moved or deleted by a switch. The device receives a new anonymous Firebase ID in the new project and stays unauthorized until an administrator enrolls it there.
- Runtime configuration wins over build-time environment variables, so switching back needs no rebuild.

### First device in a brand-new project

Anonymous Firebase IDs are per project, so a new project has no member documents. After connecting a fresh project, create the first administrator document once in Firebase Console (or with the Firebase CLI):

1. **Firestore Database → Start collection** `pharmacies`, document `main`.
2. Under it, create `members/<uid>`, where `<uid>` is the new **Device ID** shown in Settings, with fields `uid` (string), `pharmacyId` (`"main"`), `role` (`"admin"`) and `active` (boolean `true`).
3. Publish this repository's `firestore.rules` to the new project, then reload the app.

After that, the usual enrollment codes authorize additional devices. This manual step is required only for the first device of a new project.

### Local development

```powershell
npm run dev       # Vite on http://127.0.0.1:5173
npm run dev:api   # OAuth backend on http://127.0.0.1:8787 (reads .env.local)
```

Vite proxies `/api` to `127.0.0.1:8787`, so cookies and redirects stay first-party. Run the two commands in separate terminals; Vite keeps working for the UI when the API is stopped.

### Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `503 server_not_configured` | A server variable is missing, or `OAUTH_SESSION_SECRET` is shorter than 32 characters. |
| `403 origin_not_allowed` | The browser origin is not in `APP_ORIGIN`, or a proxy changed it. Add the exact scheme + host + port. |
| `401 missing_device_token` | The device has not finished anonymous Firebase sign-in. Wait for *Authenticated* and retry. |
| `403 device_not_authorized` | This device has no active member document. Enroll it under **Settings → Users & Roles** first. |
| `401 google_reconnect_required` | The Google grant expired or was revoked. The card shows a reconnect banner; connect again. |
| Empty project list | The account has no Firebase projects, or Firebase Management API is disabled. |
| "No Firebase Web App" | Create one explicitly from the card (asks for the write scope), or add one in Firebase Console. |
| Rules check fails | Publish this repository's `firestore.rules` (blanket `if false` rules block every device). |

## Local desktop use

For a single computer, the simplest setup is to serve the built app from a local static server on localhost and keep a browser shortcut. Do not develop against `npm run dev` for real data; use the production build and a stable origin.

## Caching and updates

Static assets are content-hashed. After deploying a new build, users may need to reload once to pick up the new `index.html`. Keep backups before upgrades. Service workers are not included, so the app requires the host to be reachable when opened (unless the static files are served locally).

## Bundle size

The production JavaScript bundle is approximately 1.23 MB minified / 360 kB gzip in a single chunk, mostly the Firebase SDK. This is acceptable for a local business app. If needed, route-level `React.lazy`/dynamic imports and Firebase modular imports can split report, settings and POS code.

## Environment limitations

- The core app works with no backend. Connect with Google and cloud synchronization require the `api/` functions, a Firebase project and (for runtime configuration) a Google OAuth client.
- Without Firebase configuration, the app stays local-only; runtime configuration is stored per browser profile/origin.
- Data is per browser profile/origin; use backups to move it.
- Printing requires browser permission to open pop-up windows and access the print dialog.
- CSV export uses browser downloads; the download directory must be writable.
