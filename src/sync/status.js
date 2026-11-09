import { useSyncExternalStore } from "react";
import { db } from "../database/db";
import { isFirebaseConfigured, WORKSPACE_ID } from "../firebase/firebase";

const LAST_SYNC_KEY = "pharmacySyncLastSuccess";

function readLastSync() {
  try {
    return localStorage.getItem(LAST_SYNC_KEY) || null;
  } catch {
    return null;
  }
}

let state = {
  configured: Boolean(isFirebaseConfigured),
  workspaceId: WORKSPACE_ID,
  cloudUser: null,
  authLoading: Boolean(isFirebaseConfigured),
  authorized: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  syncing: false,
  autoSync: Boolean(isFirebaseConfigured),
  pendingCount: 0,
  failedCount: 0,
  lastSyncedAt: readLastSync(),
  lastError: "",
};

const listeners = new Set();

export function getSyncState() {
  return state;
}

export function updateSync(patch) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
}

export function subscribeSync(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState);
}

export async function refreshQueueCounts() {
  try {
    const entries = await db.syncQueue.toArray();
    const active = entries.filter((entry) => entry.status !== "done");
    updateSync({
      pendingCount: active.length,
      failedCount: active.filter((entry) => entry.status === "failed").length,
    });
  } catch (error) {
    console.error("Could not count pending sync changes:", error);
  }
}

export function setLastSyncedAt(value = new Date().toISOString()) {
  try {
    localStorage.setItem(LAST_SYNC_KEY, value);
  } catch {
    // Storage may be unavailable; the in-memory value still updates.
  }
  updateSync({ lastSyncedAt: value });
}
