// Shared HTTP helpers for the OAuth backend.
// These handlers are plain Node request/response functions so they run on
// Vercel Functions, on any Node server (see scripts/dev-api.mjs), and inside
// the test harness without extra adapters.

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.headers = extra.headers || {};
    this.details = extra.details;
  }
}

export function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null ? fallback : String(value).trim();
}

export function serverConfig() {
  const appOrigins = env("APP_ORIGIN")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return {
    clientId: env("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    sessionSecret: env("OAUTH_SESSION_SECRET"),
    appOrigins,
    firebaseProjectId: env("FIREBASE_PROJECT_ID"),
    workspaceId: env("FIREBASE_WORKSPACE_ID") || "main",
  };
}

export function missingServerConfig() {
  const config = serverConfig();
  const missing = [];
  if (!config.clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
  if (!config.clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!config.sessionSecret) missing.push("OAUTH_SESSION_SECRET");
  if (!config.firebaseProjectId) missing.push("FIREBASE_PROJECT_ID");
  if (!config.appOrigins.length) missing.push("APP_ORIGIN");
  return missing;
}

/** Fails fast with a clear, non-secret-bearing error when the host is misconfigured. */
export function requireServerConfig() {
  const missing = missingServerConfig();
  if (missing.length) {
    throw new HttpError(
      503,
      "server_not_configured",
      `The Google connection service is not configured on this deployment. Missing: ${missing.join(", ")}.`
    );
  }
  return serverConfig();
}

export function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.end(payload);
}

export function sendEmpty(res, status, headers = {}) {
  res.statusCode = status;
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.end();
}

export function redirect(res, location, headers = {}) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(headers)) {
    res.setHeader(name, value);
  }
  res.end();
}

export function header(req, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return "";
}

export function requestUrl(req) {
  const proto = (header(req, "x-forwarded-proto") || "http").split(",")[0].trim();
  const host = header(req, "x-forwarded-host") || header(req, "host") || "127.0.0.1";
  return new URL(req.url || "/", `${proto}://${host}`);
}

export function query(req, name, fallback = "") {
  if (req.query && typeof req.query[name] === "string") return req.query[name];
  const fromUrl = requestUrl(req).searchParams.get(name);
  return fromUrl === null ? fallback : fromUrl;
}

export function enforceMethod(req, allowed) {
  const method = String(req.method || "GET").toUpperCase();
  if (!allowed.includes(method)) {
    throw new HttpError(405, "method_not_allowed", `Use ${allowed.join(" or ")} for this endpoint.`, {
      headers: { Allow: allowed.join(", ") },
    });
  }
  return method;
}

export async function readJson(req, limit = 32 * 1024) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    if (req.body.length > limit) {
      throw new HttpError(413, "payload_too_large", "Request body is too large.");
    }
    try {
      return req.body.trim() ? JSON.parse(req.body) : {};
    } catch {
      throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new HttpError(413, "payload_too_large", "Request body is too large.");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

export function bearerToken(req) {
  const value = header(req, "authorization");
  const match = /^Bearer\s+(.+)$/i.exec(value || "");
  return match ? match[1].trim() : "";
}

/**
 * Rejects cross-site calls. Google's redirect back to us is a top-level
 * navigation without an Origin header, so only stateful/unsafe methods are
 * required to carry one.
 */
export function assertSameOrigin(req, allowedOrigins, { required = false } = {}) {
  const origin = (header(req, "origin") || "").replace(/\/+$/, "");
  if (!origin) {
    if (required) {
      throw new HttpError(403, "origin_required", "This request must come from the pharmacy application.");
    }
    return;
  }
  if (!allowedOrigins.includes(origin)) {
    throw new HttpError(403, "origin_not_allowed", "This request did not come from an authorized application origin.");
  }
}

/** Resolves and validates the origin we are allowed to send the browser back to. */
export function resolveAppOrigin(req, requested, allowedOrigins) {
  const clean = String(requested || "").replace(/\/+$/, "");
  if (clean) {
    if (!allowedOrigins.includes(clean)) {
      throw new HttpError(400, "origin_not_allowed", "The requested return origin is not in the allowed list.");
    }
    return clean;
  }
  const origin = (header(req, "origin") || "").replace(/\/+$/, "");
  if (origin && allowedOrigins.includes(origin)) return origin;
  if (allowedOrigins.length === 1) return allowedOrigins[0];
  throw new HttpError(400, "origin_required", "A return origin is required.");
}

/** Wraps a handler so thrown HttpErrors become clean JSON responses. */
export function guarded(handler) {
  return async function handlerWithErrors(req, res) {
    try {
      await handler(req, res);
    } catch (error) {
      if (res.writableEnded) return;
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "internal_error";
      const message =
        error instanceof HttpError
          ? error.message
          : "The Google connection service hit an unexpected error. Try again.";
      if (!(error instanceof HttpError)) {
        // Never log tokens or request headers; the message is enough to debug.
        console.error(`[google-oauth] ${code}: ${error?.name || "Error"}: ${error?.message || error}`);
      }
      sendJson(
        res,
        status,
        { error: { code, message, details: error instanceof HttpError ? error.details : undefined } },
        error instanceof HttpError ? error.headers : {}
      );
    }
  };
}
