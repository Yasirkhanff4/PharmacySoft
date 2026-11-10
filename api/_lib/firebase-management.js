// Firebase Management API client (server-side only).
// Docs: https://firebase.google.com/docs/reference/rest

import { HttpError } from "./http.js";

const API_BASE = "https://firebase.googleapis.com/v1beta1";

async function apiFetch(url, accessToken, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (response.status === 401) {
    throw new HttpError(401, "google_token_expired", "Google authorization expired. Reconnect the Google account.");
  }

  if (response.status === 403) {
    const reason = payload?.error?.status || "PERMISSION_DENIED";
    throw new HttpError(
      403,
      "firebase_permission_denied",
      `The connected Google account cannot manage Firebase projects with this permission set (${reason}). Confirm the Firebase Management API is enabled and that the account has access to the project.`
    );
  }

  if (!response.ok) {
    const message = payload?.error?.message || `Firebase Management API error (HTTP ${response.status}).`;
    throw new HttpError(
      response.status === 404 ? 404 : 502,
      response.status === 404 ? "firebase_not_found" : "firebase_api_error",
      message
    );
  }

  return payload || {};
}

export function projectsUrl(pageToken = "") {
  const params = new URLSearchParams({ pageSize: "100" });
  if (pageToken) params.set("pageToken", pageToken);
  return `${API_BASE}/projects?${params.toString()}`;
}

export function webAppsUrl(projectId) {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/webApps?pageSize=100`;
}

export function webAppConfigUrl(projectId, appId) {
  return `${API_BASE}/projects/${encodeURIComponent(projectId)}/webApps/${encodeURIComponent(appId)}/config`;
}

/**
 * Lists every Firebase project the authorized account can see. Projects the
 * account cannot read are skipped rather than failing the whole listing.
 */
export async function listProjects(accessToken, { maxPages = 5 } = {}) {
  const projects = [];
  let pageToken = "";
  let pages = 0;

  do {
    const payload = await apiFetch(projectsUrl(pageToken), accessToken);
    for (const project of payload.results || []) {
      if (!project?.projectId) continue;
      projects.push({
        projectId: project.projectId,
        displayName: project.displayName || project.projectId,
        projectNumber: project.projectNumber || "",
        state: project.state || "ACTIVE",
        locationId: project.resources?.locationId || "",
        hostingSite: project.resources?.hostingSite || "",
        storageBucket: project.resources?.storageBucket || "",
      });
    }
    pageToken = payload.nextPageToken || "";
    pages += 1;
  } while (pageToken && pages < maxPages);

  projects.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { projects, truncated: Boolean(pageToken) };
}

export async function listWebApps(accessToken, projectId) {
  const payload = await apiFetch(webAppsUrl(projectId), accessToken);
  return (payload.apps || []).map((app) => ({
    appId: app.appId,
    displayName: app.displayName || app.appId,
    projectId: app.projectId || projectId,
    appUrl: app.appUrls?.[0] || "",
    state: app.state || "ACTIVE",
  }));
}

export async function getWebAppConfig(accessToken, projectId, appId) {
  const payload = await apiFetch(webAppConfigUrl(projectId, appId), accessToken);
  return toPublicConfig(payload);
}

/**
 * Creates a Firebase Web App. This is the only call that needs the broader
 * `cloud-platform` scope, and it is only reachable after explicit confirmation.
 */
export async function createWebApp(accessToken, projectId, displayName) {
  const payload = await apiFetch(
    `${API_BASE}/projects/${encodeURIComponent(projectId)}/webApps`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({ displayName }),
    }
  );

  const appId = payload.appId;
  if (!appId) {
    throw new HttpError(502, "firebase_api_error", "Firebase created the app but did not return an app ID.");
  }

  // Firebase usually returns the config immediately; if not, fetch it once.
  if (payload.config) {
    return { app: { appId, displayName: payload.displayName || displayName }, config: toPublicConfig(payload.config) };
  }
  const config = await getWebAppConfig(accessToken, projectId, appId);
  return { app: { appId, displayName: payload.displayName || displayName }, config };
}

/**
 * Reduces a Management API config payload to exactly the public Firebase web
 * configuration the browser is allowed to have. No tokens, no service accounts.
 */
export function toPublicConfig(raw) {
  const config = {
    apiKey: String(raw?.apiKey || ""),
    authDomain: String(raw?.authDomain || ""),
    projectId: String(raw?.projectId || ""),
    storageBucket: String(raw?.storageBucket || ""),
    messagingSenderId: String(raw?.messagingSenderId || ""),
    appId: String(raw?.appId || ""),
  };
  if (raw?.measurementId) config.measurementId = String(raw.measurementId);

  const missing = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"].filter(
    (key) => !config[key]
  );
  if (missing.length) {
    throw new HttpError(
      502,
      "incomplete_web_config",
      `Firebase returned an incomplete web configuration (missing ${missing.join(", ")}).`
    );
  }
  return config;
}

export function isFirebaseWebConfig(value) {
  if (!value || typeof value !== "object") return false;
  return ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"].every(
    (key) => typeof value[key] === "string" && value[key].trim().length > 0
  );
}

/**
 * Read-only readiness probe so the UI can explain what a project still needs
 * before sync can work. Every check degrades gracefully when the connected
 * account lacks permission.
 */
export async function inspectProject(accessToken, projectId) {
  const checks = [];

  const webApps = await listWebApps(accessToken, projectId).catch((error) => {
    checks.push({ id: "web_app", status: "error", message: error.message });
    return null;
  });

  if (webApps) {
    checks.push({
      id: "web_app",
      status: webApps.length ? "ok" : "action_required",
      message: webApps.length
        ? `${webApps.length} web app${webApps.length === 1 ? "" : "s"} registered.`
        : "No Firebase Web App is registered in this project. One must be created before the app can connect.",
      apps: webApps,
    });
  }

  const databases = await fetch(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
    .then(async (response) => ({ ok: response.ok, status: response.status, body: await response.json().catch(() => null) }))
    .catch(() => ({ ok: false, status: 0, body: null }));

  if (databases.ok) {
    const names = (databases.body?.databases || []).map((db) => db.name || "");
    const hasDefault = names.some((name) => /\/databases\/\(default\)$/.test(name));
    checks.push({
      id: "firestore_database",
      status: hasDefault ? "ok" : "action_required",
      message: hasDefault
        ? "Cloud Firestore database (default) exists."
        : "Cloud Firestore is not set up in this project yet. Create the (default) database in Firebase Console.",
    });
  } else {
    checks.push({
      id: "firestore_database",
      status: "unknown",
      message:
        databases.status === 403
          ? "Could not inspect Cloud Firestore: the connected account or granted scopes do not allow it."
          : "Could not reach the Cloud Firestore API for this project.",
    });
  }

  const rules = await inspectRules(accessToken, projectId);
  checks.push(rules);

  return { projectId, checks, inspectedAt: new Date().toISOString() };
}

async function inspectRules(accessToken, projectId) {
  const base = `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`;
  try {
    const releaseResponse = await fetch(`${base}/releases/cloud.firestore`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (releaseResponse.status === 404) {
      return {
        id: "firestore_rules",
        status: "action_required",
        message: "No Firestore rules have been published. Publish the project's firestore.rules before syncing.",
      };
    }
    if (!releaseResponse.ok) {
      return {
        id: "firestore_rules",
        status: "unknown",
        message: "Could not read the published Firestore rules with the current permission set.",
      };
    }

    const release = await releaseResponse.json();
    const rulesetName = release.rulesetName || "";
    const rulesetResponse = await fetch(`https://firebaserules.googleapis.com/v1/${rulesetName}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!rulesetResponse.ok) {
      return {
        id: "firestore_rules",
        status: "ok",
        message: "Firestore rules are published (content not readable with the current permission set).",
      };
    }

    const ruleset = await rulesetResponse.json();
    const content = (ruleset.source?.files || []).map((file) => file.content || "").join("\n");
    const denyAll = /match\s*\/\{document=\*\*\}\s*\{\s*allow\s+read\s*,\s*write\s*:\s*if\s+false/.test(content);

    if (denyAll) {
      return {
        id: "firestore_rules",
        status: "blocked",
        message:
          "The published rules deny all reads and writes (blanket `if false`). Publish the project's firestore.rules or no device can sync.",
        updatedAt: release.updateTime || "",
      };
    }

    if (!/pharmacies/.test(content) || !/enrollmentCodes/.test(content) || !/isMember/.test(content)) {
      return {
        id: "firestore_rules",
        status: "action_required",
        message:
          "The published rules do not look like this application's pharmacy rules. Publish firestore.rules before syncing.",
        updatedAt: release.updateTime || "",
      };
    }

    return {
      id: "firestore_rules",
      status: "ok",
      message: "Published rules match the pharmacy workspace model.",
      updatedAt: release.updateTime || "",
    };
  } catch {
    return {
      id: "firestore_rules",
      status: "unknown",
      message: "Could not check the published Firestore rules.",
    };
  }
}
