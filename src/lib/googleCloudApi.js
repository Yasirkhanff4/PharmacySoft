// Frontend client for the Google connection backend (api/google/*).
//
// Every request is authenticated with the device's own Firebase ID token, so
// the server can verify that this device is an active workspace administrator
// using the same Firestore rules as the rest of the app.

import { auth } from "../firebase/firebase";

export class CloudApiError extends Error {
  constructor(message, { code = "request_failed", status = 0, details = null } = {}) {
    super(message);
    this.name = "CloudApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function deviceToken() {
  const user = auth?.currentUser;
  if (!user) {
    throw new CloudApiError(
      "This device is not signed in to Firebase yet. Wait for authentication to finish, then try again.",
      { code: "device_not_signed_in" }
    );
  }
  return user.getIdToken();
}

async function request(path, { method = "GET", body, query } = {}) {
  const token = await deviceToken();
  const url = query ? `${path}?${new URLSearchParams(query).toString()}` : path;

  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CloudApiError(
      "Could not reach the pharmacy cloud service. Check your connection and try again.",
      { code: "network_error" }
    );
  }

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = payload?.error || {};
    throw new CloudApiError(
      error.message || `The cloud service rejected the request (HTTP ${response.status}).`,
      {
        code: error.code || "request_failed",
        status: response.status,
        details: error.details || null,
      }
    );
  }

  return payload;
}

export function getGoogleSession() {
  return request("/api/google/session");
}

export function listFirebaseProjects() {
  return request("/api/google/projects");
}

export function inspectFirebaseProject(projectId) {
  return request("/api/google/inspect", { query: { projectId } });
}

export function getProjectWebConfig(projectId, appId) {
  return request("/api/google/config", {
    query: appId ? { projectId, appId } : { projectId },
  });
}

export function createFirebaseWebApp(projectId, displayName) {
  return request("/api/google/webapps", {
    method: "POST",
    body: { projectId, displayName, confirm: true },
  });
}

export function disconnectGoogle() {
  return request("/api/google/disconnect", { method: "POST", body: {} });
}

/**
 * Opens the Google consent popup. Falls back to a full-page redirect when the
 * browser blocks popups, so the flow never dead-ends.
 */
export function startGoogleAuthorization({
  intent = "read",
  projectId = "",
  loginHint = "",
  origin = typeof window === "undefined" ? "" : window.location.origin,
} = {}) {
  const params = new URLSearchParams({ origin, intent, returnTo: "/settings" });
  if (projectId) params.set("projectId", projectId);
  if (loginHint) params.set("loginHint", loginHint);

  const url = `/api/google/start?${params.toString()}`;
  const popup = window.open(
    url,
    "pharmacy-google-connect",
    "popup=yes,width=520,height=680,menubar=no,toolbar=no"
  );

  if (!popup) {
    window.location.assign(url);
    return { popup: null, redirected: true };
  }

  try {
    popup.focus();
  } catch {
    // Focus is best-effort; the popup still works.
  }
  return { popup, redirected: false };
}

/** Resolves the app origin used for the backend's allowlist check. */
export function appOrigin() {
  return typeof window === "undefined" ? "" : window.location.origin;
}

// The OAuth callback lands on /settings in this same SPA. A popup notifies its
// opener with postMessage; a full-page redirect (popup blocked) stashes the
// outcome here so the card can pick it up after it mounts.
export const GOOGLE_OAUTH_RESULT_KEY = "pharmacyGoogleOAuthResult:v1";

export function storeGoogleOAuthResult(payload) {
  try {
    window.sessionStorage.setItem(GOOGLE_OAUTH_RESULT_KEY, JSON.stringify(payload));
  } catch {
    // Storage may be blocked; the postMessage path still works.
  }
}

export function consumeGoogleOAuthResult() {
  try {
    const raw = window.sessionStorage.getItem(GOOGLE_OAUTH_RESULT_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(GOOGLE_OAUTH_RESULT_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
