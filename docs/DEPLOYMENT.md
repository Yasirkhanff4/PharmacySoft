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

1. Build and test on the target machine (`npm run build`, `npm run preview`).
2. Serve `dist/` over the final HTTPS URL with SPA rewrites.
3. Open the app and create the administrator account.
4. Configure pharmacy settings and create staff accounts.
5. Restore an existing backup if migrating, then verify record counts.
6. Download a fresh backup and store it off-device.
7. Record the URL, version and backup location for staff.

## Local desktop use

For a single computer, the simplest setup is to serve the built app from a local static server on localhost and keep a browser shortcut. Do not develop against `npm run dev` for real data; use the production build and a stable origin.

## Caching and updates

Static assets are content-hashed. After deploying a new build, users may need to reload once to pick up the new `index.html`. Keep backups before upgrades. Service workers are not included, so the app requires the host to be reachable when opened (unless the static files are served locally).

## Bundle size

The production JavaScript bundle is approximately 581 kB minified / 167 kB gzip (single chunk). This is acceptable for a local business app. If needed, route-level `React.lazy`/dynamic imports can split report, settings and POS code.

## Environment limitations

- No backend, database server, email or payment gateway is required or configured.
- Firebase is not configured or used.
- Data is per browser profile/origin; use backups to move it.
- Printing requires browser permission to open pop-up windows and access the print dialog.
- CSV export uses browser downloads; the download directory must be writable.
