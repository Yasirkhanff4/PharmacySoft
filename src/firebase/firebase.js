import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { readRuntimeConfig } from "./runtimeConfig.js";

const env = import.meta.env;

function readEnv(name) {
  return String(env[name] || "").trim();
}

const envConfig = {
  apiKey: readEnv("VITE_FIREBASE_API_KEY"),
  authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: readEnv("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: readEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: readEnv("VITE_FIREBASE_APP_ID"),
};

function isComplete(config) {
  return [
    config.apiKey,
    config.authDomain,
    config.projectId,
    config.storageBucket,
    config.messagingSenderId,
    config.appId,
  ].every(Boolean);
}

// A runtime configuration saved by "Connect with Google" wins over the build
// time env vars, so an administrator can point the app at another project
// without rebuilding or editing .env.local.
const runtime = readRuntimeConfig();

export const runtimeConfigMeta = runtime;

export const configSource = runtime ? "runtime" : isComplete(envConfig) ? "env" : "none";

export const firebaseConfig = runtime ? runtime.config : envConfig;

export const isFirebaseConfigured = isComplete(firebaseConfig);

export const firebaseProjectId = firebaseConfig.projectId;

export const WORKSPACE_ID =
  runtime?.workspaceId || readEnv("VITE_FIREBASE_PHARMACY_ID") || "main";

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;

export const auth = app ? getAuth(app) : null;

export const firestore = app ? getFirestore(app) : null;

// Development-only emulator wiring. Never active in a production build, and
// only when explicitly requested, so a normal `npm run dev` still talks to the
// real Firebase project.
const useEmulator =
  import.meta.env.DEV && readEnv("VITE_USE_FIREBASE_EMULATOR") === "1";

// Exposed so diagnostics never probe the production REST endpoint while the
// app is talking to the local emulators.
export const usingFirebaseEmulator = Boolean(useEmulator);

if (useEmulator && auth && firestore) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
}

// Keep the cloud session across reloads. Local login remains the offline gate.
export const authPersistenceReady =
  auth && typeof window !== "undefined"
    ? setPersistence(auth, browserLocalPersistence).catch((error) => {
        console.error("Could not enable persistent Firebase auth:", error);
      })
    : Promise.resolve();

export const CLOUD_COLLECTIONS = {
  medicines: "medicines",
  sales: "sales",
  purchases: "purchases",
  suppliers: "suppliers",
  customers: "customers",
  expenses: "expenses",
  settings: "settings",
};
