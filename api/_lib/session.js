// Encrypted, HttpOnly cookie sessions.
//
// The browser never sees a Google refresh token, access token or client secret:
// the cookie only carries an opaque-looking (AES-256-GCM sealed) blob, and the
// decryption key lives in the server environment. Refresh tokens are therefore
// encrypted at rest inside the cookie, with no external session store needed.

import crypto from "node:crypto";
import { HttpError, env, header } from "./http.js";

export const SESSION_COOKIE = "pharmacy_google_session";
export const STATE_COOKIE = "pharmacy_google_state";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const STATE_TTL_SECONDS = 60 * 10; // 10 minutes

function deriveKey() {
  const secret = env("OAUTH_SESSION_SECRET");
  if (!secret) {
    throw new HttpError(
      503,
      "server_not_configured",
      "The Google connection service is missing OAUTH_SESSION_SECRET."
    );
  }
  if (secret.length < 32) {
    throw new HttpError(
      503,
      "server_not_configured",
      "OAUTH_SESSION_SECRET must be at least 32 characters of random data."
    );
  }
  // Accept any high-entropy string and normalize it to a 32-byte AES key.
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

export function seal(value) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${base64url(iv)}.${base64url(tag)}.${base64url(ciphertext)}`;
}

export function open(token) {
  if (typeof token !== "string" || !token.startsWith("v1.")) {
    throw new HttpError(401, "invalid_session", "The Google session is not readable. Connect again.");
  }
  const [, ivPart, tagPart, dataPart] = token.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new HttpError(401, "invalid_session", "The Google session is not readable. Connect again.");
  }

  const key = deriveKey();
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivPart, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1) {
      throw new Error("unexpected session payload");
    }
    return parsed;
  } catch {
    // A tampered or rotated-key cookie is treated as "not connected".
    throw new HttpError(401, "invalid_session", "The Google session has expired or was invalidated. Connect again.");
  }
}

export function parseCookies(req) {
  const raw = header(req, "cookie");
  const jar = {};
  if (!raw) return jar;
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) jar[name] = decodeURIComponent(value);
  }
  return jar;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  return parts.join("; ");
}

export function isHttps(req, appOrigin = "") {
  const proto = (header(req, "x-forwarded-proto") || "").split(",")[0].trim();
  if (proto) return proto === "https";
  if (String(appOrigin).startsWith("https://")) return true;
  return Boolean(req.socket && req.socket.encrypted);
}

export function sessionCookie(req, session, appOrigin) {
  return serializeCookie(SESSION_COOKIE, seal(session), {
    maxAge: SESSION_TTL_SECONDS,
    secure: isHttps(req, appOrigin),
    sameSite: "Lax",
  });
}

export function clearedSessionCookie(req, appOrigin) {
  return serializeCookie(SESSION_COOKIE, "", {
    maxAge: 0,
    secure: isHttps(req, appOrigin),
    sameSite: "Lax",
  });
}

export function readSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = open(token);
  if (!session.refreshToken) {
    throw new HttpError(401, "invalid_session", "The Google session is incomplete. Connect again.");
  }
  return session;
}

export function createSession({ email, sub, scopes, refreshToken, accessToken, accessExpiresAt, projectId }) {
  return {
    v: 1,
    sid: crypto.randomBytes(16).toString("base64url"),
    email: email || "",
    sub: sub || "",
    scopes: Array.isArray(scopes) ? scopes : [],
    refreshToken,
    accessToken: accessToken || "",
    accessExpiresAt: Number(accessExpiresAt || 0),
    projectId: projectId || "",
    createdAt: Date.now(),
  };
}

/** Short-lived CSRF/PKCE envelope for one authorization attempt. */
export function createState({
  state,
  verifier,
  origin,
  intent,
  returnTo,
  linkProjectId,
}) {
  return {
    v: 1,
    state,
    verifier,
    origin,
    intent,
    returnTo: returnTo || "/settings",
    linkProjectId: linkProjectId || "",
    createdAt: Date.now(),
  };
}

export function stateCookie(req, payload, appOrigin) {
  return serializeCookie(STATE_COOKIE, seal(payload), {
    maxAge: STATE_TTL_SECONDS,
    secure: isHttps(req, appOrigin),
    sameSite: "Lax",
  });
}

export function clearedStateCookie(req, appOrigin) {
  return serializeCookie(STATE_COOKIE, "", {
    maxAge: 0,
    secure: isHttps(req, appOrigin),
    sameSite: "Lax",
  });
}

export function readState(req) {
  const token = parseCookies(req)[STATE_COOKIE];
  if (!token) {
    throw new HttpError(
      400,
      "missing_state",
      "The authorization attempt expired or the browser blocked its cookie. Start the Google connection again."
    );
  }
  const payload = open(token);
  if (Date.now() - Number(payload.createdAt || 0) > STATE_TTL_SECONDS * 1000) {
    throw new HttpError(400, "expired_state", "The authorization attempt expired. Start again.");
  }
  return payload;
}
