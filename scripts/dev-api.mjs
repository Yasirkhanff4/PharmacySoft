// Local development API server.
//
// Vercel serves api/**/*.js automatically in production. This script runs the
// very same handlers on http://127.0.0.1:8787 so `npm run dev` (Vite) can proxy
// /api to it, keeping cookies and redirects first-party while developing.

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

// `.env.local` first (git-ignored, developer machine), then `.env` for shared
// non-secret defaults. Server-only variables belong in `.env.local`.
loadEnvFile(join(root, ".env.local"));
loadEnvFile(join(root, ".env"));

const DEFAULT_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173";
if (!process.env.APP_ORIGIN) process.env.APP_ORIGIN = DEFAULT_ORIGINS;

const ROUTES = {
  "/api/google/start": "api/google/start.js",
  "/api/google/callback": "api/google/callback.js",
  "/api/google/session": "api/google/session.js",
  "/api/google/disconnect": "api/google/disconnect.js",
  "/api/google/projects": "api/google/projects.js",
  "/api/google/inspect": "api/google/inspect.js",
  "/api/google/config": "api/google/config.js",
  "/api/google/webapps": "api/google/webapps.js",
};

const PORT = Number(process.env.PORT || 8787);

function missingConfigHint() {
  const required = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "OAUTH_SESSION_SECRET",
    "FIREBASE_PROJECT_ID",
  ];
  const missing = required.filter((key) => !process.env[key]);
  return missing;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (pathname === "/api/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        missingServerConfig: missingConfigHint(),
        appOrigin: process.env.APP_ORIGIN,
      })
    );
    return;
  }

  const target = ROUTES[pathname];
  if (!target) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: { code: "not_found", message: "Unknown API route." } }));
    return;
  }

  try {
    const module = await import(pathToFileURL(join(root, target)).href);
    req.query = Object.fromEntries(url.searchParams);
    await module.default(req, res);
  } catch (error) {
    // Handlers already format their own errors; this is a last resort.
    console.error("[dev-api] unhandled:", error?.message || error);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { code: "internal_error", message: "Unexpected API error." } }));
    }
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dev-api] Google OAuth backend on http://127.0.0.1:${PORT}`);
  console.log(`[dev-api] allowed origins: ${process.env.APP_ORIGIN}`);
  const missing = missingConfigHint();
  if (missing.length) {
    console.log(`[dev-api] not configured yet, missing: ${missing.join(", ")}`);
    console.log("[dev-api] copy the server section of .env.example into .env.local");
  }
});
