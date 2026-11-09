import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import {
  auth,
  authPersistenceReady,
  firebaseProjectId,
  firestore,
  isFirebaseConfigured,
  usingFirebaseEmulator,
  WORKSPACE_ID,
} from "../firebase/firebase";
import {
  initializeCloudSync,
  startCloudSession,
  stopCloudSession,
  syncNow as runCloudSync,
} from "../sync/engine";
import { updateSync, useSyncStatus } from "../sync/status";
import { useAuth } from "./AuthContext";

const CloudContext = createContext(null);

// Device enrollment codes are short-lived and single-use. 15 minutes is long
// enough to type the code on the second device, short enough that a leaked
// code is not useful for long.
const ENROLLMENT_TTL_MS = 15 * 60 * 1000;
const ENROLLMENT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ENROLLMENT_CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const MEMBERSHIP_READ_TIMEOUT_MS = 10000;

function generateEnrollmentCode() {
  const bytes = new Uint8Array(8);

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Only reached in browsers without Web Crypto; anonymous auth itself
    // requires a secure context, so this is effectively a fallback guard.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  const chars = Array.from(
    bytes,
    (byte) => ENROLLMENT_ALPHABET[byte % ENROLLMENT_ALPHABET.length]
  ).join("");

  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function normalizeEnrollmentCode(rawCode) {
  const compact = String(rawCode || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (compact.length !== 8) return compact;

  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function membershipDoc(uid) {
  return doc(firestore, "pharmacies", WORKSPACE_ID, "members", uid);
}

function enrollmentCodeDoc(code) {
  return doc(firestore, "pharmacies", WORKSPACE_ID, "enrollmentCodes", code);
}

// When the Firestore database does not exist (or the emulator/backend is
// unreachable), the client can keep retrying the Listen channel without ever
// settling the read. Bound the wait so the UI can report the problem instead
// of sitting on "Not authorized" forever.
async function getDocFromServerWithTimeout(reference, timeoutMs = MEMBERSHIP_READ_TIMEOUT_MS) {
  let timer;

  try {
    return await Promise.race([
      getDocFromServer(reference),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("Timed out while reading from Cloud Firestore.");
          error.code = "deadline-exceeded";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

let anonymousSignInPromise = null;

function ensureAnonymousSession() {
  if (!auth) return Promise.resolve(null);
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  if (!anonymousSignInPromise) {
    anonymousSignInPromise = authPersistenceReady
      .then(() => signInAnonymously(auth))
      .finally(() => {
        anonymousSignInPromise = null;
      });
  }

  return anonymousSignInPromise;
}

function friendlyAuthError(error) {
  const code = String(error?.code || "");

  if (code.includes("operation-not-allowed") || code.includes("admin-restricted-operation")) {
    return "Anonymous sign-in is disabled for this Firebase project. Enable it in Firebase Console > Authentication > Sign-in method > Anonymous.";
  }

  if (code.includes("configuration-not-found")) {
    return "Firebase Authentication is not available for this project. In Firebase Console, open Authentication and enable the Anonymous sign-in provider. If it is already enabled, confirm the Web app API key belongs to this project and is not restricted from Identity Toolkit.";
  }

  if (code.includes("network-request-failed")) {
    return "Cannot reach Firebase. Local login and local data keep working; cloud sync will retry when the connection returns.";
  }

  if (code.includes("too-many-requests")) {
    return "Firebase is rate limiting sign-in attempts. Cloud sync will retry shortly.";
  }

  return error?.message || "Firebase authentication failed.";
}

function friendlyEnrollmentError(error, uid = "") {
  const code = String(error?.code || "");
  const detail = String(error?.message || "");

  if (code.includes("permission-denied")) {
    const path = `pharmacies/${WORKSPACE_ID}/members/${uid || "{deviceId}"}`;

    return `Firestore rejected the device authorization read (permission-denied) for ${path}. The published security rules are not the ones in this project's firestore.rules, or they have not been published yet. Open Firebase Console → Firestore Database → Rules, paste the project's firestore.rules file, click Publish, then press Check Authorization. If the rules are already published, confirm App Check enforcement is not blocking this web app.`;
  }

  if (code.includes("failed-precondition")) {
    return "Cloud Firestore is not ready. In Firebase Console, open Firestore Database and create the database, then try again.";
  }

  if (
    code.includes("unavailable") ||
    code.includes("network-request-failed") ||
    code.includes("deadline-exceeded")
  ) {
    return "Cloud Firestore is unreachable. Confirm the Firestore database has been created in Firebase Console (Firestore Database → Create database) and the Cloud Firestore API is enabled. Offline changes stay queued locally.";
  }

  return detail || "Could not verify this device.";
}

function readMembership(snapshot, uid) {
  if (!snapshot.exists()) {
    return {
      status: "unauthorized",
      role: null,
      reason: "No member document exists for this device.",
    };
  }

  const data = snapshot.data();

  if (data.pharmacyId !== WORKSPACE_ID) {
    return {
      status: "unauthorized",
      role: null,
      reason: data.pharmacyId
        ? `This device is linked to the "${data.pharmacyId}" workspace, not "${WORKSPACE_ID}".`
        : `This device's member document is not linked to the "${WORKSPACE_ID}" workspace.`,
    };
  }

  if (data.uid && data.uid !== uid) {
    return {
      status: "unauthorized",
      role: null,
      reason: "The member document belongs to a different device.",
    };
  }

  if (data.active !== true) {
    return {
      status: "unauthorized",
      role: null,
      reason: "This device has been disabled by the administrator.",
    };
  }

  return {
    status: "authorized",
    role: data.role === "admin" ? "admin" : "staff",
    reason: "",
  };
}

// The Firebase SDK reports a missing Firestore database as "the client is
// offline" and cannot tell "Firestore was never set up" apart from "this
// device is not enrolled". Ask the Firestore REST API directly (same anonymous
// ID token) to surface project setup and security-rule problems accurately.
// Returns null when the Firestore read itself looks healthy.
async function diagnoseFirestoreSetup(uid) {
  const user = auth?.currentUser;

  // The production REST endpoint cannot validate an emulator-issued token, so
  // the SDK's own errors are already accurate in that setup.
  if (usingFirebaseEmulator) return null;

  if (!user || !firebaseProjectId || typeof fetch !== "function") return null;

  const path = [
    "projects",
    encodeURIComponent(firebaseProjectId),
    "databases",
    "(default)",
    "documents",
    "pharmacies",
    encodeURIComponent(WORKSPACE_ID),
    "members",
    encodeURIComponent(uid),
  ].join("/");

  try {
    const token = await user.getIdToken();
    const response = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) return null;

    const body = await response.json().catch(() => null);
    const message = String(body?.error?.message || "");
    const reason = String(body?.error?.details?.[0]?.reason || "");

    if (reason === "SERVICE_DISABLED" || /has not been used in project/i.test(message)) {
      return "Cloud Firestore is disabled for this Firebase project. In Firebase Console, open Firestore Database and create the database, then press Check Authorization.";
    }

    if (response.status === 404 && /database .*does not exist/i.test(message)) {
      return "Cloud Firestore has no database yet. In Firebase Console, open Firestore Database and click Create database, then press Check Authorization.";
    }

    if (response.status === 403 && /insufficient permissions/i.test(message)) {
      return `Firestore rejected the membership read (permission-denied) for pharmacies/${WORKSPACE_ID}/members/${uid}. The published security rules do not allow this device to read its own member document, or App Check is blocking the app. Open Firebase Console → Firestore Database → Rules, publish the firestore.rules file from this project, then press Check Authorization.`;
    }

    return null;
  } catch {
    // Diagnostics are best-effort: fall back to the normal offline handling.
    return null;
  }
}

function timestampToMillis(value) {
  if (!value) return 0;

  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();

  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : 0;
}

export function CloudProvider({ children }) {
  const { user: localUser } = useAuth();
  const sync = useSyncStatus();
  const [cloudUser, setCloudUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(isFirebaseConfigured));
  const [authError, setAuthError] = useState("");
  const [membership, setMembership] = useState({
    status: isFirebaseConfigured ? "unknown" : "unavailable",
    role: null,
    error: "",
    reason: "",
    code: "",
  });
  const [membershipNonce, setMembershipNonce] = useState(0);
  const [retryToken, setRetryToken] = useState(0);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  // Local saves are queued from the moment the app starts, before Firebase
  // authentication or device authorization completes.
  useEffect(() => {
    const cleanup = initializeCloudSync();
    return cleanup;
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      // Re-check device authorization when connectivity returns; the first
      // check may have failed while Firestore was unreachable.
      setMembershipNonce((value) => value + 1);
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        const nextUser = user
          ? { uid: user.uid, anonymous: Boolean(user.isAnonymous) }
          : null;

        setCloudUser(nextUser);
        setAuthLoading(false);
        updateSync({ cloudUser: nextUser, authLoading: false });
      },
      (error) => {
        setAuthError(friendlyAuthError(error));
        setAuthLoading(false);
        updateSync({ authLoading: false });
      }
    );

    return unsubscribe;
  }, []);

  // Automatic device authentication: a successful local login starts an
  // anonymous Firebase session. The user is never asked for Firebase
  // credentials. The session persists across restarts.
  useEffect(() => {
    if (!isFirebaseConfigured || !auth || !firestore || !localUser) {
      return undefined;
    }

    if (auth.currentUser) {
      return undefined;
    }

    let cancelled = false;

    // The helper collapses duplicate attempts (for example React StrictMode
    // re-running the effect) into a single anonymous account.
    ensureAnonymousSession().catch((error) => {
      if (cancelled) return;

      const message = friendlyAuthError(error);
      setAuthError(message);
      setAuthLoading(false);
      updateSync({ authLoading: false, lastError: message });
    });

    return () => {
      cancelled = true;
    };
  }, [localUser, retryToken]);

  // Verify that this device identity is enrolled in the pharmacy workspace.
  // Only an active member document bound to this workspace and this Firebase
  // UID authorizes the device.
  useEffect(() => {
    if (!isFirebaseConfigured || !firestore || !cloudUser) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        // Server-only read: a cached membership document must never be the
        // reason this device is treated as authorized.
        const snapshot = await getDocFromServerWithTimeout(membershipDoc(cloudUser.uid));

        if (cancelled) return;

        const next = readMembership(snapshot, cloudUser.uid);

        if (next.status === "unauthorized") {
          const setupIssue = await diagnoseFirestoreSetup(cloudUser.uid);

          if (cancelled) return;

          if (setupIssue) {
            setMembership({
              status: "error",
              role: null,
              error: setupIssue,
              reason: "",
              code: "permission-denied",
            });
            updateSync({ authorized: false, lastError: setupIssue });
            return;
          }
        }

        setMembership({
          status: next.status,
          role: next.role,
          reason: next.reason,
          error: "",
          code: "",
        });
        updateSync({ authorized: next.status === "authorized" });
      } catch (error) {
        if (cancelled) return;

        // "Client is offline" is also how the SDK reports a missing Firestore
        // database, and a rules denial can surface as a generic error, so
        // confirm the real cause before showing the fallback text.
        let setupIssue = null;

        if (typeof navigator === "undefined" || navigator.onLine) {
          setupIssue = await diagnoseFirestoreSetup(cloudUser.uid);

          if (cancelled) return;
        }

        const message = setupIssue || friendlyEnrollmentError(error, cloudUser.uid);

        setMembership({
          status: "error",
          role: null,
          error: message,
          reason: "",
          code: String(error?.code || ""),
        });
        updateSync({ authorized: false, lastError: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cloudUser, membershipNonce]);

  // Cloud synchronization only runs while a local user is signed in and the
  // device is an active member of the workspace. Local use is unaffected.
  useEffect(() => {
    if (!cloudUser || !localUser || membership.status !== "authorized") {
      stopCloudSession();
      return;
    }

    startCloudSession(cloudUser);
  }, [cloudUser, localUser, membership.status]);

  const refreshMembership = useCallback(() => {
    setMembershipNonce((value) => value + 1);
  }, []);

  const retryAuthentication = useCallback(() => {
    setAuthError("");
    updateSync({ lastError: "" });
    setRetryToken((value) => value + 1);
  }, []);

  const redeemEnrollmentCode = useCallback(
    async (rawCode) => {
      if (!isFirebaseConfigured || !firestore) {
        throw new Error("Firebase is not configured.");
      }

      if (!cloudUser) {
        throw new Error("Firebase authentication is not ready yet. Try again in a moment.");
      }

      const code = normalizeEnrollmentCode(rawCode);

      if (!ENROLLMENT_CODE_PATTERN.test(code)) {
        throw new Error("Enrollment codes look like ABCD-EFGH. Enter the full code shown by the administrator.");
      }

      const memberRef = membershipDoc(cloudUser.uid);
      const existingMember = await getDocFromServerWithTimeout(memberRef);

      if (existingMember.exists() && existingMember.data().active === true) {
        refreshMembership();
        return { alreadyEnrolled: true };
      }

      const codeRef = enrollmentCodeDoc(code);
      let snapshot;

      try {
        snapshot = await getDocFromServerWithTimeout(codeRef);
      } catch (error) {
        if (String(error?.code || "").includes("permission-denied")) {
          throw new Error(
            `Firestore denied reading enrollment code ${code}. Publish the firestore.rules file from this project in Firebase Console → Firestore Database → Rules, then try again.`,
            { cause: error }
          );
        }
        throw error;
      }

      if (!snapshot.exists()) {
        throw new Error("That enrollment code was not found. Check the code and try again.");
      }

      const data = snapshot.data();

      if (data.pharmacyId !== WORKSPACE_ID) {
        throw new Error("That enrollment code belongs to a different pharmacy workspace.");
      }

      if (data.usedBy && data.usedBy !== cloudUser.uid) {
        throw new Error("That enrollment code has already been used by another device.");
      }

      const expiresAt = timestampToMillis(data.expiresAt);

      if (!expiresAt) {
        throw new Error("That enrollment code is invalid because it has no expiration time.");
      }

      if (expiresAt <= Date.now()) {
        throw new Error("That enrollment code has expired. Ask an administrator for a new code.");
      }

      // Claim the code first. The rules make this write atomic across devices:
      // once usedBy is set, any other UID's update fails. The member document
      // rule then requires that this device is the one that claimed the code.
      if (!data.usedBy) {
        try {
          await updateDoc(codeRef, {
            usedBy: cloudUser.uid,
            usedAt: serverTimestamp(),
          });
        } catch (error) {
          const codeName = String(error?.code || "");

          if (codeName.includes("permission-denied")) {
            const reread = await getDocFromServerWithTimeout(codeRef).catch(() => null);
            const latest = reread?.exists() ? reread.data() : null;

            if (latest?.usedBy && latest.usedBy !== cloudUser.uid) {
              throw new Error("That enrollment code has already been used by another device.", {
                cause: error,
              });
            }

            if (latest && timestampToMillis(latest.expiresAt) <= Date.now()) {
              throw new Error("That enrollment code has expired. Ask an administrator for a new code.", {
                cause: error,
              });
            }

            throw new Error(
              "Firestore denied redeeming this enrollment code. Publish the current firestore.rules file in Firebase Console → Firestore Database → Rules, then try again.",
              { cause: error }
            );
          }

          throw error;
        }
      }

      try {
        await setDoc(memberRef, {
          uid: cloudUser.uid,
          pharmacyId: WORKSPACE_ID,
          active: true,
          role: "staff",
          enrollmentCode: code,
          enrolledAt: serverTimestamp(),
        });
      } catch (error) {
        if (String(error?.code || "").includes("permission-denied")) {
          throw new Error(
            "The code was claimed, but Firestore denied creating this device's member document. Publish the current firestore.rules file, then press Check Authorization.",
            { cause: error }
          );
        }
        throw error;
      }

      refreshMembership();

      return { alreadyEnrolled: false };
    },
    [cloudUser, refreshMembership]
  );

  const createEnrollmentCode = useCallback(async () => {
    if (!isFirebaseConfigured || !firestore) {
      throw new Error("Firebase is not configured.");
    }

    if (!cloudUser) {
      throw new Error("Firebase authentication is not ready yet. Try again in a moment.");
    }

    if (membership.status !== "authorized") {
      throw new Error("Authorize this device before creating enrollment codes.");
    }

    // Re-check against the server: the cached membership state must never be
    // enough to mint an enrollment code.
    const selfSnapshot = await getDocFromServerWithTimeout(membershipDoc(cloudUser.uid));

    if (!selfSnapshot.exists()) {
      throw new Error("This device's member document no longer exists.");
    }

    const self = selfSnapshot.data();

    if (self.active !== true || self.role !== "admin") {
      throw new Error("Only an active administrator device can create enrollment codes.");
    }

    const expiresAt = Timestamp.fromDate(new Date(Date.now() + ENROLLMENT_TTL_MS));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateEnrollmentCode();
      const reference = enrollmentCodeDoc(code);
      const existing = await getDocFromServerWithTimeout(reference).catch(() => null);

      if (existing?.exists()) continue;

      try {
        await setDoc(reference, {
          code,
          pharmacyId: WORKSPACE_ID,
          createdBy: cloudUser.uid,
          createdAt: serverTimestamp(),
          expiresAt,
          usedBy: null,
          usedAt: null,
        });
      } catch (error) {
        if (String(error?.code || "").includes("permission-denied")) {
          throw new Error(
            "Firestore denied creating the enrollment code. Confirm this device's member document has role \"admin\" and that the current firestore.rules file is published.",
            { cause: error }
          );
        }
        throw error;
      }

      return { code, expiresAt: expiresAt.toDate().toISOString() };
    }

    throw new Error("Could not generate a unique enrollment code. Try again.");
  }, [cloudUser, membership.status]);

  const listDevices = useCallback(async () => {
    if (!isFirebaseConfigured || !firestore) {
      throw new Error("Firebase is not configured.");
    }

    if (membership.status !== "authorized") {
      throw new Error("Authorize this device before listing enrolled devices.");
    }

    const snapshot = await getDocs(
      collection(firestore, "pharmacies", WORKSPACE_ID, "members")
    );

    return snapshot.docs.map((entry) => {
      const data = entry.data();
      const enrolledAt = data.enrolledAt;

      return {
        id: entry.id,
        uid: data.uid || entry.id,
        role: data.role || "staff",
        active: data.active === true,
        enrolledAt:
          typeof enrolledAt?.toDate === "function"
            ? enrolledAt.toDate().toISOString()
            : enrolledAt || null,
      };
    });
  }, [membership.status]);

  const syncNow = useCallback(
    async (options = {}) => {
      if (!cloudUser) {
        throw new Error("Firebase authentication is not ready yet. Check your connection.");
      }

      if (membership.status !== "authorized") {
        throw new Error("This device is not authorized for the pharmacy workspace.");
      }

      return runCloudSync(options);
    },
    [cloudUser, membership.status]
  );

  const value = useMemo(
    () => ({
      configured: isFirebaseConfigured,
      projectId: firebaseProjectId,
      workspaceId: WORKSPACE_ID,
      cloudUser,
      deviceId: cloudUser?.uid || "",
      localUserActive: Boolean(localUser),
      connecting:
        Boolean(isFirebaseConfigured) &&
        Boolean(localUser) &&
        !cloudUser &&
        !authError,
      authLoading,
      authError,
      membership,
      online,
      retryAuthentication,
      refreshMembership,
      redeemEnrollmentCode,
      createEnrollmentCode,
      listDevices,
      sync,
      syncNow,
    }),
    [
      cloudUser,
      localUser,
      authLoading,
      authError,
      membership,
      online,
      retryAuthentication,
      refreshMembership,
      redeemEnrollmentCode,
      createEnrollmentCode,
      listDevices,
      sync,
      syncNow,
    ]
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud() {
  const context = useContext(CloudContext);
  if (!context) throw new Error("useCloud must be used inside CloudProvider");
  return context;
}
