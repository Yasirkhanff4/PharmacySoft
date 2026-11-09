import { db } from "../database/db";
import { isFirebaseConfigured } from "../firebase/firebase";
import { queueAfterRestore } from "../sync/queue";
import { APP_NAME, APP_VERSION, BACKUP_META_KEY } from "./constants";
import { loadLogo, loadSettings, saveLogo, saveSettings } from "../hooks/useSettings";
import { downloadJSON, toLocalDateString } from "./format";

const BACKUP_EXCLUDED_TABLES = new Set(["syncQueue"]);

export function buildBackupPayload() {
  return (async () => {
    const data = {};
    const counts = {};

    for (const table of db.tables) {
      if (BACKUP_EXCLUDED_TABLES.has(table.name)) continue;

      const records = await table.toArray();
      data[table.name] = records;
      counts[table.name] = records.length;
    }

    return {
      app: APP_NAME,
      appVersion: APP_VERSION,
      schemaVersion: db.verno,
      exportedAt: new Date().toISOString(),
      counts,
      settings: loadSettings(),
      logo: loadLogo(),
      data,
    };
  })();
}

export async function downloadBackup() {
  const payload = await buildBackupPayload();
  const stamp = new Date();
  const filename = `PharmaCare-Backup-${toLocalDateString(stamp)}-${String(
    stamp.getHours()
  ).padStart(2, "0")}${String(stamp.getMinutes()).padStart(2, "0")}.json`;

  downloadJSON(filename, payload);
  localStorage.setItem(BACKUP_META_KEY, JSON.stringify({ at: payload.exportedAt, filename }));
  return { filename, counts: payload.counts };
}

export function validateBackup(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("The selected file is not a valid backup.");
  }

  if (!payload.data || typeof payload.data !== "object") {
    throw new Error("The backup file is missing its database section.");
  }

  const knownTables = new Set(
    db.tables
      .filter((table) => !BACKUP_EXCLUDED_TABLES.has(table.name))
      .map((table) => table.name)
  );
  const tables = Object.keys(payload.data);
  const validTables = tables.filter((name) => knownTables.has(name));

  if (validTables.length === 0) {
    throw new Error("The backup does not contain any recognised tables.");
  }

  for (const name of validTables) {
    if (!Array.isArray(payload.data[name])) {
      throw new Error(`Backup table "${name}" is malformed.`);
    }

    for (const record of payload.data[name]) {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error(`Backup table "${name}" contains an invalid record.`);
      }
    }
  }

  return {
    tables: validTables,
    totalRecords: validTables.reduce((sum, name) => sum + payload.data[name].length, 0),
    exportedAt: payload.exportedAt || null,
    appVersion: payload.appVersion || "unknown",
  };
}

export async function restoreBackup(payload, mode = "replace") {
  const summary = validateBackup(payload);
  const tableNames = summary.tables;
  const dexieTables = db.tables.filter((table) => tableNames.includes(table.name));
  const previousIds = {};

  if (mode === "replace") {
    for (const table of dexieTables) {
      previousIds[table.name] = (await table.toArray()).map((record) => record.id);
    }
  }

  await db.transaction("rw", ...dexieTables, async () => {
    for (const table of dexieTables) {
      const records = payload.data[table.name];

      if (mode === "replace") {
        await table.clear();
      }

      for (const record of records) {
        if (record.id !== undefined && record.id !== null) {
          await table.put(record);
        } else {
          await table.add(record);
        }
      }
    }
  });

  if (payload.settings && typeof payload.settings === "object") {
    saveSettings(payload.settings);
  }

  if (typeof payload.logo === "string") {
    saveLogo(payload.logo);
  }

  if (isFirebaseConfigured) {
    await queueAfterRestore(mode === "replace" ? previousIds : null);
  }

  return summary;
}

export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;

  try {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0,
    };
  } catch {
    return null;
  }
}

export function getLastBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
