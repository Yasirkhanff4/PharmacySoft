// Verifies the caller's Firebase ID token and proves the device is an active
// workspace administrator.
//
// No service account is required: the token is verified against Google's public
// signing keys, then used as-is to read the device's own member document, so
// the very same Firestore security rules that protect the app protect this
// check too.

import crypto from "node:crypto";
import { HttpError } from "./http.js";

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let jwksCache = { keys: new Map(), expiresAt: 0 };

function decodeSegment(segment) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function headerFrom(token) {
  return decodeSegment(String(token).split(".")[0] || "");
}

async function loadKey(kid, { force = false } = {}) {
  const now = Date.now();
  if (!force && jwksCache.expiresAt > now && jwksCache.keys.has(kid)) {
    return jwksCache.keys.get(kid);
  }

  const response = await fetch(JWKS_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new HttpError(503, "identity_keys_unavailable", "Could not verify the device identity right now. Try again.");
  }
  const payload = await response.json();
  const keys = new Map();
  for (const jwk of payload.keys || []) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
  }

  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(/max-age=(\d+)/.exec(cacheControl)?.[1] || 3600);
  jwksCache = { keys, expiresAt: now + Math.max(60, maxAge) * 1000 };

  if (!keys.has(kid)) {
    if (!force) return loadKey(kid, { force: true });
    throw new HttpError(401, "invalid_token", "The device identity token was signed with an unknown key.");
  }
  return keys.get(kid);
}

export function validateFirebaseClaims(payload, projectId, now = Date.now()) {
  const problems = [];
  if (!payload || typeof payload !== "object") problems.push("token payload missing");
  if (payload?.aud !== projectId) problems.push("audience mismatch");
  if (payload?.iss !== `https://securetoken.google.com/${projectId}`) problems.push("issuer mismatch");
  if (!payload?.sub) problems.push("subject missing");
  if (payload?.exp && Number(payload.exp) * 1000 <= now) problems.push("token expired");
  if (payload?.iat && Number(payload.iat) * 1000 > now + 5 * 60 * 1000) problems.push("issued in the future");
  if (payload?.auth_time && Number(payload.auth_time) * 1000 > now + 5 * 60 * 1000) {
    problems.push("auth_time in the future");
  }
  return problems;
}

export async function verifyFirebaseIdToken(token, projectId, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "invalid_token", "The device identity token is malformed.");
  }

  const header = headerFrom(token);
  if (!header || header.alg !== "RS256" || !header.kid) {
    throw new HttpError(401, "invalid_token", "The device identity token uses an unsupported signature.");
  }

  const key = await loadKey(header.kid);
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  const signature = Buffer.from(parts[2], "base64url");
  const valid = crypto.verify("RSA-SHA256", signed, key, signature);
  if (!valid) {
    throw new HttpError(401, "invalid_token", "The device identity token signature is not valid.");
  }

  const payload = decodeSegment(parts[1]);
  const problems = validateFirebaseClaims(payload, projectId, now);
  if (problems.length) {
    throw new HttpError(401, "invalid_token", `The device identity token is not usable (${problems.join(", ")}).`);
  }
  return payload;
}

export function memberDocUrl(projectId, workspaceId, uid) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/pharmacies/${encodeURIComponent(
    workspaceId
  )}/members/${encodeURIComponent(uid)}`;
}

function readString(fields, name) {
  const value = fields?.[name];
  if (!value) return "";
  return value.stringValue || "";
}

function readBoolean(fields, name) {
  return fields?.[name]?.booleanValue === true;
}

/**
 * Reads the device's member document with the device's own token, so Firestore
 * rules decide. Returns null when the document does not exist (not enrolled).
 */
export async function readMember({ projectId, workspaceId, uid, idToken }) {
  const response = await fetch(memberDocUrl(projectId, workspaceId, uid), {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (response.status === 404) return null;

  if (response.status === 403) {
    throw new HttpError(
      403,
      "membership_check_blocked",
      `Firestore denied the membership check for pharmacies/${workspaceId}/members/${uid}. Publish the project's firestore.rules, or confirm App Check is not blocking the app.`
    );
  }

  if (!response.ok) {
    throw new HttpError(502, "membership_check_failed", "Could not verify this device's workspace membership.");
  }

  const payload = await response.json();
  const fields = payload.fields || {};
  return {
    uid: readString(fields, "uid"),
    role: readString(fields, "role"),
    active: readBoolean(fields, "active"),
    pharmacyId: readString(fields, "pharmacyId"),
  };
}

export async function requireWorkspaceAdmin({ idToken, projectId, workspaceId }) {
  if (!idToken) {
    throw new HttpError(
      401,
      "missing_device_token",
      "Sign in on this device first, then try again."
    );
  }
  if (!projectId) {
    throw new HttpError(503, "server_not_configured", "FIREBASE_PROJECT_ID is missing on the server.");
  }

  const claims = await verifyFirebaseIdToken(idToken, projectId);
  const member = await readMember({ projectId, workspaceId, uid: claims.sub, idToken });

  if (!member) {
    throw new HttpError(
      403,
      "admin_required",
      `This device is not enrolled in pharmacies/${workspaceId}. Only an authorized administrator device can change the Firebase project.`
    );
  }
  if (!member.active || member.role !== "admin" || member.pharmacyId !== workspaceId) {
    throw new HttpError(
      403,
      "admin_required",
      "Only an active administrator device in this workspace can change the Firebase project."
    );
  }

  return { uid: claims.sub, projectId, workspaceId, email: claims.email || "" };
}

export function resetJwksCache() {
  jwksCache = { keys: new Map(), expiresAt: 0 };
}
