// Google Identity Services authorization-code flow with PKCE.
// Client secret and tokens never leave the server.

import crypto from "node:crypto";
import { HttpError, env, serverConfig } from "./http.js";

export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

export const SCOPE_IDENTITY = ["openid", "email"];
export const SCOPE_FIREBASE_READONLY = "https://www.googleapis.com/auth/firebase.readonly";
export const SCOPE_FIREBASE_WRITE = "https://www.googleapis.com/auth/cloud-platform";

/**
 * Least privilege: reading projects and web-app configuration needs only
 * `firebase.readonly`. Creating a web app is the one action that requires the
 * broader Cloud Platform scope, so it is requested separately and only after
 * an explicit admin confirmation.
 */
export function scopesFor(intent) {
  const scopes = [...SCOPE_IDENTITY, SCOPE_FIREBASE_READONLY];
  if (intent === "write") scopes.push(SCOPE_FIREBASE_WRITE);
  return scopes;
}

export function hasScope(scopes, scope) {
  return Array.isArray(scopes) && scopes.includes(scope);
}

export function canWriteFirebase(scopes) {
  return hasScope(scopes, SCOPE_FIREBASE_WRITE);
}

export function createPkcePair() {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createStateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function callbackUrl(origin) {
  return `${String(origin).replace(/\/+$/, "")}/api/google/callback`;
}

export function buildAuthorizationUrl({
  clientId,
  origin,
  state,
  challenge,
  intent,
  loginHint = "",
  projectId = "",
}) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(origin),
    response_type: "code",
    scope: scopesFor(intent).join(" "),
    state,
    access_type: "offline",
    // `consent` guarantees a refresh token on reconnect; `select_account` lets
    // the administrator pick which Google account is used.
    prompt: "consent select_account",
    include_granted_scopes: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (loginHint) params.set("login_hint", loginHint);
  if (projectId) params.set("project_id", projectId);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

function clientCredentials() {
  const { clientId, clientSecret } = serverConfig();
  if (!clientId || !clientSecret) {
    throw new HttpError(
      503,
      "server_not_configured",
      "Google OAuth client credentials are missing on the server."
    );
  }
  return { clientId, clientSecret };
}

async function tokenRequest(body) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const reason = payload?.error || `http_${response.status}`;
    const description = payload?.error_description || "";
    if (reason === "invalid_grant" || reason === "invalid_client") {
      throw new HttpError(
        401,
        "google_authorization_rejected",
        "Google rejected the authorization. The connection may have been revoked or the code expired. Connect again.",
        { details: { reason } }
      );
    }
    // Never echo the response body: it can contain token material.
    throw new HttpError(502, "google_token_error", `Google token exchange failed (${reason}). ${description}`.trim());
  }

  return payload || {};
}

export async function exchangeAuthorizationCode({ code, verifier, origin }) {
  const { clientId, clientSecret } = clientCredentials();
  const payload = await tokenRequest({
    code,
    code_verifier: verifier,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: callbackUrl(origin),
    grant_type: "authorization_code",
  });

  if (!payload.access_token) {
    throw new HttpError(502, "google_token_error", "Google did not return an access token.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || "",
    expiresIn: Number(payload.expires_in || 0),
    scope: String(payload.scope || ""),
    idToken: payload.id_token || "",
  };
}

export async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = clientCredentials();
  const payload = await tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  if (!payload.access_token) {
    throw new HttpError(401, "google_reconnect_required", "Google no longer allows this connection. Reconnect the Google account.");
  }

  return {
    accessToken: payload.access_token,
    expiresIn: Number(payload.expires_in || 0),
    scope: String(payload.scope || ""),
  };
}

/** Best-effort revocation so disconnecting really revokes server-side access. */
export async function revokeToken(token) {
  if (!token) return { revoked: false };
  try {
    const response = await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return { revoked: response.ok };
  } catch {
    return { revoked: false };
  }
}

export async function fetchUserInfo(accessToken) {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new HttpError(502, "google_userinfo_error", "Could not read the connected Google account.");
  }
  const payload = await response.json();
  return {
    email: String(payload.email || ""),
    sub: String(payload.sub || ""),
    emailVerified: Boolean(payload.email_verified),
  };
}

/** In-memory access-token cache; serverless instances are short-lived by design. */
const tokenCache = new Map();

export async function accessTokenFor(session) {
  const cached = tokenCache.get(session.sid);
  if (cached && cached.token && cached.expiresAt > Date.now() + 60_000) {
    return { accessToken: cached.token, session, refreshed: false };
  }

  const refreshed = await refreshAccessToken(session.refreshToken);
  const nextSession = {
    ...session,
    accessToken: refreshed.accessToken,
    accessExpiresAt: Date.now() + Math.max(60, refreshed.expiresIn - 60) * 1000,
    scopes: refreshed.scope ? refreshed.scope.split(" ") : session.scopes,
  };
  tokenCache.set(session.sid, {
    token: refreshed.accessToken,
    expiresAt: nextSession.accessExpiresAt,
  });
  // Keep the cache bounded even under abuse.
  if (tokenCache.size > 500) {
    const oldest = tokenCache.keys().next().value;
    tokenCache.delete(oldest);
  }
  return { accessToken: refreshed.accessToken, session: nextSession, refreshed: true };
}

export function resetTokenCache() {
  tokenCache.clear();
}

export function oauthDiagnostics() {
  return {
    clientConfigured: Boolean(env("GOOGLE_OAUTH_CLIENT_ID")),
    secretConfigured: Boolean(env("GOOGLE_OAUTH_CLIENT_SECRET")),
    sessionSecretConfigured: Boolean(env("OAUTH_SESSION_SECRET")),
  };
}
