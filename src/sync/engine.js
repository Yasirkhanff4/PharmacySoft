import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import {
  firestore,
  isFirebaseConfigured,
  WORKSPACE_ID,
} from "../firebase/firebase";
import { db } from "../database/db";
import { saveSettings } from "../hooks/useSettings";
import { refreshQueueCounts, setLastSyncedAt, updateSync } from "./status";
import { setSyncRequestHandler } from "./scheduler";
import {
  BUSINESS_TABLES,
  hasPendingQueueEntry,
  markRemoteWrite,
  queueAllLocalRecords,
  startQueueObserver,
  withRemoteApply,
} from "./queue";

const CLIENT_ID_KEY = "pharmacyCloudClientId";
const BOOTSTRAP_KEY = `pharmacyCloudInitialised:${WORKSPACE_ID}`;

let initialized = false;
let currentUid = null;
let unsubscribeListeners = [];
let syncTimer = null;
let intervalTimer = null;
let runPromise = null;
let bootstrapPromise = null;

function getClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;

    const next =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch {
    return "client-unknown";
  }
}

const CLIENT_ID = getClientId();

function workspaceDoc(table, recordId) {
  return doc(firestore, "pharmacies", WORKSPACE_ID, table, recordId);
}

function workspaceCollection(table) {
  return collection(firestore, "pharmacies", WORKSPACE_ID, table);
}

// Firestore rejects `undefined` (including inside arrays and nested objects),
// while Dexie happily stores it. Normalize queue payloads before writing.
function toFirestoreData(value) {
  if (value === undefined || value === null) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "object") return value;

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.map((entry) => toFirestoreData(entry));
  }

  const result = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    result[key] = toFirestoreData(entry);
  }

  return result;
}

function normalizeInvoice(value) {
  return String(value || "").trim().toLowerCase();
}

function invoiceKey(value) {
  return encodeURIComponent(String(value || "").trim().toLowerCase()).slice(0, 1400);
}

function friendlyError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");

  if (code.includes("permission-denied") || message.includes("Missing or insufficient permissions")) {
    return "Firebase denied access. Confirm this device is enrolled in the pharmacy workspace and that the Firestore rules are published.";
  }

  if (code.includes("unavailable") || code.includes("network-request-failed")) {
    return "Cloud Firestore is unreachable. Confirm the Firestore database exists in Firebase Console and the Cloud Firestore API is enabled. Changes are kept locally and will retry automatically.";
  }

  if (code.includes("auth/")) {
    return message || "Firebase authentication failed.";
  }

  return message || "Cloud synchronization failed.";
}

function scheduleSync(reason = "auto", delay = 1200) {
  if (!isFirebaseConfigured) return;
  // currentUid is set only after Firebase authentication succeeds AND the
  // device is authorized for the workspace.
  if (!currentUid) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (syncTimer) return;

  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    syncNow({ manual: false, reason }).catch((error) => {
      console.error("Automatic sync failed:", error);
    });
  }, delay);
}

async function resetStuckQueue() {
  try {
    await db.syncQueue.where("status").equals("syncing").modify({ status: "pending" });
  } catch (error) {
    console.error("Could not reset interrupted sync entries:", error);
  }
}

async function acknowledgeEntry(entry) {
  await db.transaction("rw", db.syncQueue, async () => {
    const current = await db.syncQueue.get(entry.id);
    if (!current) return;

    const currentRevision = Number(current.revision || 0);
    const uploadedRevision = Number(entry.revision || 0);

    if (currentRevision === uploadedRevision) {
      await db.syncQueue.delete(entry.id);
    } else {
      await db.syncQueue.update(entry.id, { status: "pending" });
    }
  });
}

async function markFailure(entry, error) {
  const attempts = Number(entry.attempts || 0) + 1;
  const delay = Math.min(5 * 60 * 1000, 5000 * 2 ** Math.min(attempts, 6));
  const message = friendlyError(error);

  await db.syncQueue.update(entry.id, {
    status: "failed",
    attempts,
    lastError: message,
    nextRetryAt: new Date(Date.now() + delay).toISOString(),
  });

  updateSync({ lastError: message });
}

async function ensureInvoiceKey(entry) {
  const invoiceNumber = entry.payload?.invoiceNumber;
  if (!invoiceNumber) return;

  const key = invoiceKey(invoiceNumber);
  const reference = workspaceDoc("invoiceKeys", key);
  const snapshot = await getDoc(reference);

  if (snapshot.exists()) {
    const existing = snapshot.data();
    if (existing.recordId !== entry.recordId || existing.table !== entry.table) {
      throw new Error(
        `Invoice number "${invoiceNumber}" is already used by another ${
          entry.table === "sales" ? "sale" : "purchase"
        } on another device.`
      );
    }
    return;
  }

  try {
    await setDoc(reference, {
      recordId: entry.recordId,
      table: entry.table,
      invoiceNumber,
      _clientId: CLIENT_ID,
      _syncedAt: serverTimestamp(),
    });
  } catch (error) {
    const reread = await getDoc(reference);
    if (reread.exists()) {
      const existing = reread.data();
      if (existing.recordId === entry.recordId && existing.table === entry.table) {
        return;
      }
    }

    throw new Error(
      `Invoice number "${invoiceNumber}" is already used by another ${
        entry.table === "sales" ? "sale" : "purchase"
      } on another device.`,
      { cause: error }
    );
  }
}

async function uploadEntry(entry) {
  const payload = toFirestoreData(
    entry.payload && typeof entry.payload === "object" ? entry.payload : {}
  );

  if (entry.table === "settings") {
    await setDoc(workspaceDoc("settings", "main"), {
      ...payload,
      _clientId: CLIENT_ID,
      _syncedAt: serverTimestamp(),
    });
    return;
  }

  if (entry.operation === "delete") {
    await setDoc(workspaceDoc(entry.table, entry.recordId), {
      id: entry.recordId,
      _deleted: true,
      _deletedAt: new Date().toISOString(),
      _clientId: CLIENT_ID,
      _syncedAt: serverTimestamp(),
    });
    return;
  }

  if (entry.table === "sales" || entry.table === "purchases") {
    await ensureInvoiceKey(entry);
  }

  await setDoc(workspaceDoc(entry.table, entry.recordId), {
    ...payload,
    id: entry.recordId,
    _deleted: false,
    _clientId: CLIENT_ID,
    _syncedAt: serverTimestamp(),
  });
}

async function processQueue({ force = false } = {}) {
  const due = (await db.syncQueue.toArray())
    .filter((entry) => {
      if (entry.status === "done") return false;
      if (force) return true;
      if (!entry.nextRetryAt) return true;
      return new Date(entry.nextRetryAt).getTime() <= Date.now();
    })
    .sort((left, right) => Number(left.id) - Number(right.id))
    .slice(0, 100);

  let uploaded = 0;
  let failed = 0;

  for (const entry of due) {
    if (typeof navigator !== "undefined" && !navigator.onLine) break;

    await db.syncQueue.update(entry.id, { status: "syncing" });

    try {
      await uploadEntry(entry);
      await acknowledgeEntry(entry);
      uploaded += 1;
    } catch (error) {
      failed += 1;
      await markFailure(entry, error);
    }
  }

  return { uploaded, failed };
}

function stripCloudFields(data) {
  const record = {};

  for (const [key, value] of Object.entries(data || {})) {
    if (key.startsWith("_")) continue;
    record[key] = value;
  }

  return record;
}

async function hasDuplicateInvoice(tableName, record) {
  if (!record.invoiceNumber) return null;

  const target = normalizeInvoice(record.invoiceNumber);
  const records = await db[tableName].toArray();

  return (
    records.find(
      (item) =>
        item.id !== record.id &&
        normalizeInvoice(item.invoiceNumber) === target
    ) || null
  );
}

async function applyRemoteDoc(tableName, recordId, data, removed = false) {
  if (!BUSINESS_TABLES.includes(tableName)) return;

  const pending = await hasPendingQueueEntry(tableName, recordId);
  if (pending) return;

  markRemoteWrite(tableName, recordId);

  if (removed || data?._deleted) {
    await db[tableName].delete(recordId);
    return;
  }

  const record = stripCloudFields(data);
  record.id = recordId;

  if (tableName === "sales" || tableName === "purchases") {
    const duplicate = await hasDuplicateInvoice(tableName, record);
    if (duplicate) {
      updateSync({
        lastError: `Cloud ${tableName === "sales" ? "sale" : "purchase"} ${
          record.invoiceNumber
        } conflicts with a local record. It was not imported.`,
      });
      return;
    }
  }

  await db[tableName].put(record);
}

async function applySnapshot(tableName, snapshot) {
  await withRemoteApply(async () => {
    for (const change of snapshot.docChanges()) {
      if (change.doc.metadata.hasPendingWrites) continue;

      await applyRemoteDoc(
        tableName,
        change.doc.id,
        change.doc.data(),
        change.type === "removed"
      );
    }
  });
}

async function applySettingsSnapshot(snapshot) {
  if (!snapshot.exists()) return;

  const data = snapshot.data();
  if (data?._deleted) return;

  const pending = await hasPendingQueueEntry("settings", "main");
  if (pending) return;

  await withRemoteApply(async () => {
    saveSettings(stripCloudFields(data));
  });
}

function handleListenerError(error) {
  const message = friendlyError(error);
  updateSync({ lastError: message });

  if (String(error?.code || "").includes("permission-denied")) {
    stopRealtimeListeners();
  }
}

async function pullAll() {
  for (const table of BUSINESS_TABLES) {
    const snapshot = await getDocs(workspaceCollection(table));

    await withRemoteApply(async () => {
      for (const record of snapshot.docs) {
        await applyRemoteDoc(table, record.id, record.data(), false);
      }
    });
  }

  const settingsSnapshot = await getDoc(workspaceDoc("settings", "main"));
  if (settingsSnapshot.exists()) {
    await applySettingsSnapshot(settingsSnapshot);
  }
}

function startRealtimeListeners() {
  stopRealtimeListeners();

  for (const table of BUSINESS_TABLES) {
    const unsubscribe = onSnapshot(
      workspaceCollection(table),
      (snapshot) => {
        applySnapshot(table, snapshot).catch((error) => {
          console.error(`Could not apply cloud ${table} changes:`, error);
          updateSync({ lastError: friendlyError(error) });
        });
      },
      handleListenerError
    );

    unsubscribeListeners.push(unsubscribe);
  }

  const settingsUnsubscribe = onSnapshot(
    workspaceDoc("settings", "main"),
    (snapshot) => {
      applySettingsSnapshot(snapshot).catch((error) => {
        console.error("Could not apply cloud settings:", error);
        updateSync({ lastError: friendlyError(error) });
      });
    },
    handleListenerError
  );

  unsubscribeListeners.push(settingsUnsubscribe);
}

function stopRealtimeListeners() {
  for (const unsubscribe of unsubscribeListeners) {
    try {
      unsubscribe();
    } catch {
      // Listener was already detached.
    }
  }

  unsubscribeListeners = [];
}

async function bootstrapLocalData() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      if (localStorage.getItem(BOOTSTRAP_KEY)) return;

      const settingsSnapshot = await getDoc(workspaceDoc("settings", "main"));

      await queueAllLocalRecords({
        includeSettings: !settingsSnapshot.exists(),
      });

      localStorage.setItem(BOOTSTRAP_KEY, new Date().toISOString());
    })().finally(() => {
      bootstrapPromise = null;
    });
  }

  return bootstrapPromise;
}

export function startCloudSession(user) {
  if (!isFirebaseConfigured || !user?.uid) return Promise.resolve();
  if (currentUid === user.uid && unsubscribeListeners.length > 0) {
    return Promise.resolve();
  }

  currentUid = user.uid;
  updateSync({
    cloudUser: { uid: user.uid, anonymous: true },
    authLoading: false,
    lastError: "",
  });

  return (async () => {
    await resetStuckQueue();
    await bootstrapLocalData();
    scheduleSync("cloud-session", 100);
  })().catch((error) => {
    updateSync({ lastError: friendlyError(error) });
    console.error("Could not start cloud session:", error);
  });
}

export function stopCloudSession() {
  currentUid = null;

  if (syncTimer) {
    window.clearTimeout(syncTimer);
    syncTimer = null;
  }

  stopRealtimeListeners();
  updateSync({ cloudUser: null, syncing: false });
}

export async function syncNow({ manual = false, reason = "manual" } = {}) {
  if (!isFirebaseConfigured) {
    if (manual) updateSync({ lastError: "Firebase is not configured. Add the VITE_FIREBASE_* values to .env.local." });
    return;
  }

  if (!currentUid) {
    if (manual) {
      updateSync({
        lastError:
          "This device is not authorized for cloud sync yet. Complete Firebase authentication and device enrollment.",
      });
    }
    return;
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    if (manual) {
      updateSync({
        lastError: "You are offline. Changes are saved locally and will sync when the connection returns.",
      });
    }
    return;
  }

  if (runPromise) return runPromise;

  runPromise = (async () => {
    updateSync({ syncing: true, lastError: "" });

    try {
      await resetStuckQueue();
      await bootstrapLocalData();

      // Upload local changes before starting the initial cloud snapshot so an
      // older snapshot cannot overwrite a newer local record.
      const result = await processQueue({ force: manual });

      if (!unsubscribeListeners.length) {
        startRealtimeListeners();
      }

      if (manual) {
        await pullAll();
      }

      await refreshQueueCounts();

      if (result.failed === 0 && (result.uploaded > 0 || manual)) {
        setLastSyncedAt();
      }

      if (result.failed > 0) {
        updateSync({ lastError: "Some changes could not be uploaded. They remain queued and will retry." });
      }

      return result;
    } catch (error) {
      updateSync({ lastError: friendlyError(error) });
      console.error(`Cloud sync failed (${reason}):`, error);
      return { uploaded: 0, failed: 1 };
    } finally {
      updateSync({ syncing: false });

      const pending = await db.syncQueue
        .where("status")
        .anyOf("pending", "syncing")
        .count()
        .catch(() => 0);

      if (pending > 0 && navigator.onLine && currentUid) {
        scheduleSync("follow-up", 1500);
      }
    }
  })();

  try {
    return await runPromise;
  } finally {
    runPromise = null;
  }
}

export function initializeCloudSync() {
  if (initialized) return () => {};

  initialized = true;

  updateSync({
    configured: isFirebaseConfigured,
    workspaceId: WORKSPACE_ID,
    authLoading: Boolean(isFirebaseConfigured),
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    autoSync: Boolean(isFirebaseConfigured),
  });

  if (!isFirebaseConfigured) {
    return () => {
      initialized = false;
    };
  }

  const stopQueueObserver = startQueueObserver();

  setSyncRequestHandler((requestReason) => {
    scheduleSync(requestReason);
  });

  const handleOnline = () => {
    updateSync({ online: true });
    scheduleSync("online", 200);
  };

  const handleOffline = () => {
    updateSync({ online: false });
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible") {
      scheduleSync("focus", 400);
    }
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  document.addEventListener("visibilitychange", handleVisibility);

  intervalTimer = window.setInterval(() => {
    if (navigator.onLine && currentUid) {
      scheduleSync("interval", 0);
    }
  }, 60000);

  resetStuckQueue().catch(() => {});
  refreshQueueCounts();

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    document.removeEventListener("visibilitychange", handleVisibility);

    if (intervalTimer) window.clearInterval(intervalTimer);
    if (syncTimer) window.clearTimeout(syncTimer);

    intervalTimer = null;
    syncTimer = null;
    runPromise = null;
    currentUid = null;
    stopRealtimeListeners();
    setSyncRequestHandler(null);
    stopQueueObserver();
    initialized = false;
  };
}
