// Runtime Firebase configuration.
//
// The Firebase Web config is public (it is the same object Firebase Console
// shows), so it can live in localStorage. Nothing secret is ever stored here:
// the Google refresh token and client secret stay in the encrypted HttpOnly
// cookie on the server.
//
// Environment variables remain a supported fallback, so existing deployments
// keep working exactly as before.

const STORAGE_KEY = "pharmacyFirebaseRuntimeConfig:v1";
const VERSION = 1;

const REQUIRED_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

export function isCompleteFirebaseConfig(config) {
  if (!config || typeof config !== "object") return false;
  return REQUIRED_KEYS.every(
    (key) => typeof config[key] === "string" && config[key].trim().length > 0
  );
}

export function normalizeFirebaseConfig(config) {
  if (!isCompleteFirebaseConfig(config)) return null;
  const normalized = {};
  for (const key of REQUIRED_KEYS) {
    normalized[key] = String(config[key]).trim();
  }
  if (config.measurementId) normalized.measurementId = String(config.measurementId).trim();
  return normalized;
}

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRecord() {
  const store = storage();
  if (!store) return null;
  let raw;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== VERSION) return null;
    const config = normalizeFirebaseConfig(parsed.config);
    if (!config) return null;
    return {
      v: VERSION,
      config,
      projectId: config.projectId,
      appId: config.appId,
      workspaceId: String(parsed.workspaceId || "main"),
      googleEmail: String(parsed.googleEmail || ""),
      connectedAt: parsed.connectedAt || "",
      updatedAt: parsed.updatedAt || "",
    };
  } catch {
    return null;
  }
}

/** Returns the runtime configuration, or null when the app uses env vars. */
export function readRuntimeConfig() {
  return readRecord();
}

/**
 * Persists only the public Firebase Web config plus display metadata.
 * Refuses to store an incomplete config rather than half-initializing Firebase.
 */
export function saveRuntimeConfig({ config, workspaceId = "main", googleEmail = "" }) {
  const normalized = normalizeFirebaseConfig(config);
  const store = storage();
  if (!store) {
    throw new Error("This browser blocked local storage, so the Firebase configuration cannot be saved.");
  }
  if (!normalized) {
    throw new Error("The Firebase configuration is incomplete. Nothing was saved.");
  }

  const now = new Date().toISOString();
  const record = {
    v: VERSION,
    config: normalized,
    projectId: normalized.projectId,
    appId: normalized.appId,
    workspaceId,
    googleEmail,
    connectedAt: now,
    updatedAt: now,
  };

  store.setItem(STORAGE_KEY, JSON.stringify(record));
  return record;
}

export function clearRuntimeConfig() {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else to do: the app falls back to env vars on the next load.
  }
}

export function configFingerprint(config) {
  if (!config) return "";
  return `${config.projectId || ""}|${config.appId || ""}`;
}

/**
 * Guards the one dangerous operation: pointing the app at a different Firebase
 * project. The local outbox is not project-tagged, so pending work must be
 * cleared first or it could be uploaded into the new project.
 */
export function assessProjectSwitch({
  currentProjectId = "",
  nextProjectId = "",
  pendingCount = 0,
  failedCount = 0,
} = {}) {
  if (!nextProjectId) {
    return { allowed: false, requiresConfirmation: false, reason: "Select a Firebase project first." };
  }
  if (nextProjectId === currentProjectId) {
    return { allowed: true, requiresConfirmation: false, reason: "" };
  }
  if (pendingCount > 0 || failedCount > 0) {
    const total = pendingCount + failedCount;
    return {
      allowed: false,
      requiresConfirmation: false,
      reason: `${total} local change${total === 1 ? "" : "s"} have not reached the current project yet. Run Sync Now (and resolve failed changes) before switching, so nothing is uploaded to a different project.`,
    };
  }
  return { allowed: true, requiresConfirmation: true, reason: "" };
}
