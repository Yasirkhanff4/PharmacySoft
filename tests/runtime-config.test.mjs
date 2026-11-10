// Unit tests for the runtime Firebase configuration store.
// Run with: npm run test:config

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

// Minimal localStorage so the browser-facing module can run under Node.
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
  removeItem(key) {
    this.map.delete(key);
  }
}

globalThis.window = { localStorage: new MemoryStorage() };

const runtime = await import("../src/firebase/runtimeConfig.js");

const CONFIG = {
  apiKey: "AIza-demo",
  authDomain: "demo-pharmacy.firebaseapp.com",
  projectId: "demo-pharmacy",
  storageBucket: "demo-pharmacy.firebasestorage.app",
  messagingSenderId: "54762328463",
  appId: "1:54762328463:web:abcdef",
};

beforeEach(() => {
  window.localStorage = new MemoryStorage();
  runtime.clearRuntimeConfig();
});

test("nothing is stored until a project is connected", () => {
  assert.equal(runtime.readRuntimeConfig(), null);
});

test("a complete public config round-trips with its metadata", () => {
  runtime.saveRuntimeConfig({
    config: CONFIG,
    workspaceId: "main",
    googleEmail: "admin@example.com",
  });

  const stored = runtime.readRuntimeConfig();
  assert.equal(stored.projectId, "demo-pharmacy");
  assert.equal(stored.appId, CONFIG.appId);
  assert.equal(stored.workspaceId, "main");
  assert.equal(stored.googleEmail, "admin@example.com");
  assert.equal(stored.config.apiKey, "AIza-demo");
  assert.ok(!("clientSecret" in stored));
  assert.ok(!("refreshToken" in stored));
});

test("extra Firebase fields are not persisted blindly", () => {
  runtime.saveRuntimeConfig({
    config: { ...CONFIG, databaseURL: "https://demo.firebaseio.com", measurementId: "G-123" },
  });
  const stored = runtime.readRuntimeConfig();
  assert.equal(stored.config.databaseURL, undefined);
  assert.equal(stored.config.measurementId, "G-123");
});

test("an incomplete config is refused instead of half-initializing Firebase", () => {
  assert.throws(
    () => runtime.saveRuntimeConfig({ config: { ...CONFIG, apiKey: "" } }),
    /incomplete/
  );
  assert.equal(runtime.readRuntimeConfig(), null);
});

test("whitespace-only values are treated as missing", () => {
  assert.equal(runtime.isCompleteFirebaseConfig({ ...CONFIG, appId: "   " }), false);
  assert.equal(runtime.isCompleteFirebaseConfig(CONFIG), true);
});

test("corrupted or foreign stored values are ignored", () => {
  window.localStorage.setItem("pharmacyFirebaseRuntimeConfig:v1", "{not json");
  assert.equal(runtime.readRuntimeConfig(), null);

  window.localStorage.setItem(
    "pharmacyFirebaseRuntimeConfig:v1",
    JSON.stringify({ v: 99, config: CONFIG })
  );
  assert.equal(runtime.readRuntimeConfig(), null);
});

test("clearing the runtime config falls back to env configuration", () => {
  runtime.saveRuntimeConfig({ config: CONFIG });
  runtime.clearRuntimeConfig();
  assert.equal(runtime.readRuntimeConfig(), null);
});

test("a storage failure surfaces as a clear error, not a broken app", () => {
  const original = window.localStorage;
  window.localStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  };
  try {
    assert.throws(() => runtime.saveRuntimeConfig({ config: CONFIG }), /QuotaExceededError/);
  } finally {
    window.localStorage = original;
  }
});

test("reconnecting the same project needs no confirmation", () => {
  const assessment = runtime.assessProjectSwitch({
    currentProjectId: "demo-pharmacy",
    nextProjectId: "demo-pharmacy",
    pendingCount: 4,
    failedCount: 1,
  });
  assert.equal(assessment.allowed, true);
  assert.equal(assessment.requiresConfirmation, false);
});

test("switching projects is blocked while local changes are pending", () => {
  const assessment = runtime.assessProjectSwitch({
    currentProjectId: "demo-pharmacy",
    nextProjectId: "other-pharmacy",
    pendingCount: 3,
    failedCount: 0,
  });
  assert.equal(assessment.allowed, false);
  assert.match(assessment.reason, /3 local changes/);
  assert.match(assessment.reason, /different project/);
});

test("a failed change also blocks a project switch", () => {
  const assessment = runtime.assessProjectSwitch({
    currentProjectId: "demo-pharmacy",
    nextProjectId: "other-pharmacy",
    pendingCount: 0,
    failedCount: 1,
  });
  assert.equal(assessment.allowed, false);
  assert.match(assessment.reason, /1 local change/);
});

test("a clean switch is allowed but requires explicit confirmation", () => {
  const assessment = runtime.assessProjectSwitch({
    currentProjectId: "demo-pharmacy",
    nextProjectId: "other-pharmacy",
    pendingCount: 0,
    failedCount: 0,
  });
  assert.equal(assessment.allowed, true);
  assert.equal(assessment.requiresConfirmation, true);
});

test("a missing selection is rejected", () => {
  const assessment = runtime.assessProjectSwitch({ currentProjectId: "demo-pharmacy" });
  assert.equal(assessment.allowed, false);
  assert.match(assessment.reason, /Select a Firebase project/);
});

test("config fingerprints distinguish projects and apps", () => {
  assert.equal(runtime.configFingerprint(CONFIG), `demo-pharmacy|${CONFIG.appId}`);
  assert.notEqual(
    runtime.configFingerprint(CONFIG),
    runtime.configFingerprint({ ...CONFIG, projectId: "another-project" })
  );
  assert.equal(runtime.configFingerprint(null), "");
});
