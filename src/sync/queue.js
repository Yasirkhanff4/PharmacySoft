import Dexie from "dexie";
import { db } from "../database/db";
import { SETTINGS_EVENT, loadSettings } from "../hooks/useSettings";
import { SETTINGS_KEY } from "../lib/constants";
import { refreshQueueCounts } from "./status";
import { requestSync } from "./scheduler";

export const BUSINESS_TABLES = [
  "medicines",
  "sales",
  "purchases",
  "suppliers",
  "customers",
  "expenses",
];

const BUSINESS_TABLE_SET = new Set(BUSINESS_TABLES);
const DB_PART_PREFIX = `idb://${db.name}/`;

let observerStarted = false;
let mutationListener = null;
let settingsListener = null;
let flushTimer = null;
let flushChain = Promise.resolve();
let pendingMutations = new Map();
let remoteDepth = 0;
const remoteWrites = new Map();

export function isApplyingRemote() {
  return remoteDepth > 0;
}

export async function withRemoteApply(callback) {
  remoteDepth += 1;
  try {
    return await callback();
  } finally {
    remoteDepth -= 1;
  }
}

export function markRemoteWrite(table, recordId) {
  remoteWrites.set(`${table}:${recordId}`, Date.now() + 2000);
}

function isRemoteSuppressed(table, recordId) {
  const key = `${table}:${recordId}`;
  const until = remoteWrites.get(key);

  if (!until) return false;
  if (until <= Date.now()) {
    remoteWrites.delete(key);
    return false;
  }

  return true;
}

function rememberMutation(table, key, full) {
  const entry = pendingMutations.get(table) || { keys: new Set(), full: false };

  if (full) {
    entry.full = true;
  } else if (key !== undefined) {
    entry.keys.add(key);
  }

  pendingMutations.set(table, entry);
}

// Dexie emits RangeSet instances for same-window mutations but plain objects
// (with the same tree shape) for mutations replayed from another tab. Walk the
// tree directly instead of relying on Symbol.iterator, which the serialized
// objects do not carry.
function visitRange(node, visit) {
  if (!node || typeof node !== "object") return;
  if (node.d === 0) return;

  if (node.from !== undefined && node.to !== undefined) {
    visit(node);
  }

  visitRange(node.l, visit);
  visitRange(node.r, visit);
}

function collectMutationParts(parts) {
  for (const part of Object.keys(parts || {})) {
    if (!part.startsWith(DB_PART_PREFIX)) continue;

    const rest = part.slice(DB_PART_PREFIX.length);
    const separator = rest.indexOf("/");
    if (separator < 0) continue;

    const table = rest.slice(0, separator);
    const index = rest.slice(separator + 1);

    if (!BUSINESS_TABLE_SET.has(table)) continue;
    if (index !== "" && index !== ":dels") continue;

    const rangeSet = parts[part];
    if (!rangeSet) continue;

    visitRange(rangeSet, (range) => {
      if (range.from === range.to) {
        rememberMutation(table, range.from, false);
      } else {
        rememberMutation(table, undefined, true);
      }
    });
  }
}

function scheduleFlush() {
  if (flushTimer) return;

  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushChain = flushChain
      .then(flushMutations)
      .catch((error) => console.error("Could not queue local changes:", error));
  }, 200);
}

async function findQueueEntry(table, recordId) {
  return db.syncQueue
    .where("recordId")
    .equals(recordId)
    .filter((entry) => entry.table === table)
    .first();
}

async function enqueueRecord(table, recordId, record, operation) {
  const now = new Date().toISOString();

  await db.transaction("rw", db.syncQueue, async () => {
    const existing = await findQueueEntry(table, recordId);

    if (existing) {
      const nextOperation =
        existing.operation === "delete"
          ? "update"
          : existing.operation === "create"
            ? "create"
            : operation || "update";

      await db.syncQueue.update(existing.id, {
        operation: nextOperation,
        status: "pending",
        payload: record,
        attempts: 0,
        lastError: "",
        nextRetryAt: null,
        updatedAt: now,
        revision: Number(existing.revision || 0) + 1,
      });
      return;
    }

    await db.syncQueue.add({
      table,
      recordId,
      operation: operation || "create",
      status: "pending",
      payload: record,
      attempts: 0,
      lastError: "",
      nextRetryAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    });
  });
}

async function enqueueDelete(table, recordId) {
  const now = new Date().toISOString();

  await db.transaction("rw", db.syncQueue, async () => {
    const existing = await findQueueEntry(table, recordId);

    if (existing) {
      await db.syncQueue.update(existing.id, {
        operation: "delete",
        status: "pending",
        payload: existing.payload || { id: recordId },
        attempts: 0,
        lastError: "",
        nextRetryAt: null,
        updatedAt: now,
        revision: Number(existing.revision || 0) + 1,
      });
      return;
    }

    await db.syncQueue.add({
      table,
      recordId,
      operation: "delete",
      status: "pending",
      payload: { id: recordId },
      attempts: 0,
      lastError: "",
      nextRetryAt: null,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    });
  });
}

async function flushMutations() {
  if (!pendingMutations.size) return;

  const batch = pendingMutations;
  pendingMutations = new Map();

  for (const [table, entry] of batch) {
    if (!BUSINESS_TABLE_SET.has(table)) continue;

    if (entry.full) {
      const records = await db[table].toArray();

      for (const record of records) {
        if (record.id === undefined || record.id === null) continue;
        if (isRemoteSuppressed(table, record.id)) continue;
        await enqueueRecord(table, record.id, record);
      }

      continue;
    }

    for (const recordId of entry.keys) {
      if (isRemoteSuppressed(table, recordId)) continue;

      const record = await db[table].get(recordId);

      if (record) {
        await enqueueRecord(table, recordId, record);
      } else {
        await enqueueDelete(table, recordId);
      }
    }
  }

  await refreshQueueCounts();
  requestSync("local-change");
}

export async function enqueueSettings() {
  if (!localStorage.getItem(SETTINGS_KEY)) return false;

  await enqueueRecord("settings", "main", loadSettings(), "update");
  return true;
}

export async function hasPendingQueueEntry(table, recordId) {
  const entries = await db.syncQueue.where("recordId").equals(recordId).toArray();
  return entries.some((entry) => entry.table === table);
}

export async function queueAllLocalRecords({ includeSettings = true } = {}) {
  for (const table of BUSINESS_TABLES) {
    const records = await db[table].toArray();

    for (const record of records) {
      if (record.id === undefined || record.id === null) continue;
      await enqueueRecord(table, record.id, record);
    }
  }

  if (includeSettings) {
    await enqueueSettings();
  }

  await refreshQueueCounts();
}

export async function queueAfterRestore(previousIds = null) {
  await db.syncQueue
    .where("table")
    .anyOf([...BUSINESS_TABLES, "settings"])
    .delete();

  for (const table of BUSINESS_TABLES) {
    const records = await db[table].toArray();
    const currentIds = new Set(records.map((record) => record.id));

    for (const record of records) {
      if (record.id === undefined || record.id === null) continue;
      await enqueueRecord(table, record.id, record);
    }

    if (previousIds) {
      for (const recordId of previousIds[table] || []) {
        if (!currentIds.has(recordId)) {
          await enqueueDelete(table, recordId);
        }
      }
    }
  }

  await enqueueSettings();
  await refreshQueueCounts();
}

export function startQueueObserver() {
  if (observerStarted) return () => {};

  observerStarted = true;

  mutationListener = (parts) => {
    if (isApplyingRemote()) return;

    collectMutationParts(parts);

    if (pendingMutations.size) {
      scheduleFlush();
    }
  };

  Dexie.on("storagemutated", mutationListener);

  settingsListener = () => {
    if (isApplyingRemote()) return;

    enqueueSettings()
      .then((queued) => {
        if (!queued) return;
        refreshQueueCounts();
        requestSync("settings-change");
      })
      .catch((error) => console.error("Could not queue settings change:", error));
  };

  window.addEventListener(SETTINGS_EVENT, settingsListener);

  return () => {
    Dexie.on("storagemutated").unsubscribe(mutationListener);
    window.removeEventListener(SETTINGS_EVENT, settingsListener);

    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }

    mutationListener = null;
    settingsListener = null;
    observerStarted = false;
  };
}
