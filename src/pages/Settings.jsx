import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  Cloud,
  Copy,
  Database,
  Download,
  HardDrive,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Store,
  Trash2,
  Upload,
  UserCog,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { db } from "../database/db";
import { useAuth } from "../context/AuthContext";
import { useCloud } from "../context/CloudContext";
import DeviceManagement from "../components/settings/DeviceManagement";
import GoogleCloudCard from "../components/settings/GoogleCloudCard";
import {
  useSettings,
  saveSettings as persistSettings,
  useLogo,
  saveLogo as persistLogo,
} from "../hooks/useSettings";
import { useUI } from "../context/UIContext";
import Modal from "../components/ui/Modal";
import {
  Badge,
  EmptyState,
  Field,
  PageHeader,
} from "../components/ui/primitives";
import {
  getLastBackup,
  getStorageEstimate,
  formatBytes,
  downloadBackup,
  validateBackup,
  restoreBackup,
} from "../lib/backup";
import {
  APP_NAME,
  APP_VERSION,
  CURRENCIES,
  DEFAULT_SETTINGS,
  ROLES,
} from "../lib/constants";
import {
  formatInteger,
  isValidEmail,
  isValidPhone,
  normalizeText,
  toDisplayDateTime,
} from "../lib/format";
import { storeGoogleOAuthResult } from "../lib/googleCloudApi";

const TABS = [
  { id: "general", label: "Pharmacy Profile", icon: Store, permission: "settings.view" },
  { id: "invoice", label: "Invoices & Alerts", icon: Save, permission: "settings.view" },
  { id: "security", label: "My Account", icon: LockKeyhole, permission: "settings.view" },
  { id: "users", label: "Users & Roles", icon: Users, permission: "users.manage" },
  { id: "data", label: "Data Protection", icon: Database, permission: "backup.manage" },
  { id: "firebase", label: "Firebase", icon: Cloud, permission: "settings.view" },
  { id: "about", label: "About", icon: ShieldCheck, permission: "settings.view" },
];

const EMPTY_USER = { name: "", username: "", password: "", confirm: "", role: "cashier", active: true };

function FirebasePanel({ onManageDevices }) {
  const {
    configured,
    configSource,
    projectId,
    workspaceId,
    cloudUser,
    deviceId,
    localUserActive,
    connecting,
    authLoading,
    authError,
    membership,
    online,
    retryAuthentication,
    refreshMembership,
    redeemEnrollmentCode,
    sync,
    syncNow,
  } = useCloud();
  const { user: localUser } = useAuth();
  const { toast } = useUI();
  const canManageDevices =
    membership.role === "admin" && localUser?.role === "admin";
  const [syncingNow, setSyncingNow] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [enrollError, setEnrollError] = useState("");
  const [enrolling, setEnrolling] = useState(false);

  const authorized = membership.status === "authorized";
  const canSync = configured && authorized && online && !sync.syncing;

  const authenticationLabel = !configured
    ? "Not configured"
    : connecting || authLoading
      ? "Connecting…"
      : cloudUser
        ? "Authenticated (anonymous device)"
        : authError
          ? "Failed"
          : localUserActive
            ? "Not connected"
            : "Waiting for local login";

  const authorizationLabel = !configured
    ? "—"
    : authorized
      ? `Authorized (${membership.role})`
      : !cloudUser
        ? "Waiting for authentication"
        : membership.status === "error"
          ? "Verification failed"
          : "Not authorized";

  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`, "Copied");
    } catch {
      toast.error("Could not copy to the clipboard.", "Copy failed");
    }
  }

  async function handleEnroll(event) {
    event.preventDefault();
    setEnrollError("");

    if (!codeInput.trim()) {
      setEnrollError("Enter the enrollment code given by the administrator.");
      return;
    }

    setEnrolling(true);

    try {
      await redeemEnrollmentCode(codeInput);
      setCodeInput("");
      toast.success("This device is now enrolled in the pharmacy workspace.", "Device authorized");
    } catch (error) {
      setEnrollError(error.message || "Could not authorize this device.");
    } finally {
      setEnrolling(false);
    }
  }

  async function handleSyncNow() {
    setSyncingNow(true);

    try {
      await syncNow({ manual: true });
      toast.success("Synchronization finished. Check the status above for details.", "Sync requested");
    } catch (error) {
      toast.error(error.message || "Could not synchronize with Firebase.", "Sync failed");
    } finally {
      setSyncingNow(false);
    }
  }

  return (
    <div className="settings-stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Firebase Cloud</h2>
            <p>Automatic device authentication and synchronization status.</p>
          </div>
          <div className="badge-stack">
            <Badge tone={configured ? "blue" : "neutral"} dot>
              {configured ? "Configured" : "Not configured"}
            </Badge>
            <Badge tone={online ? "green" : "amber"} dot>
              {online ? "Online" : "Offline"}
            </Badge>
            {configSource === "runtime" && <Badge tone="indigo">Runtime config</Badge>}
          </div>
        </div>

        {!configured && (
          <div className="form-alert form-alert-warning">
            Firebase is not configured. Add the six public VITE_FIREBASE_* values once (see
            .env.example) or connect a project with Google below, then reload this page.
          </div>
        )}

        <div className="detail-grid">
          <div>
            <span>Firebase project</span>
            <strong>{projectId || "Not configured"}</strong>
          </div>
          <div>
            <span>Workspace</span>
            <strong>{workspaceId || "main"}</strong>
          </div>
          <div>
            <span>Automatic authentication</span>
            <strong>{authenticationLabel}</strong>
          </div>
          <div>
            <span>Device authorization</span>
            <strong className={authorized ? "" : "text-danger"}>{authorizationLabel}</strong>
          </div>
          <div>
            <span>Automatic synchronization</span>
            <strong>{authorized && online ? "Active" : "Paused"}</strong>
          </div>
          <div>
            <span>Network status</span>
            <strong className="sync-inline-status">
              {online ? <Wifi size={15} /> : <WifiOff size={15} />}
              {online ? "Online" : "Offline — data stays on this device"}
            </strong>
          </div>
          <div>
            <span>Pending changes</span>
            <strong>{formatInteger(sync.pendingCount)}</strong>
          </div>
          <div>
            <span>Failed changes</span>
            <strong>{formatInteger(sync.failedCount)}</strong>
          </div>
          <div>
            <span>Last successful sync</span>
            <strong>{toDisplayDateTime(sync.lastSyncedAt)}</strong>
          </div>
          <div>
            <span>Device ID</span>
            <strong className="sync-uid">{deviceId || "Not assigned yet"}</strong>
          </div>
        </div>

        <div className="data-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSyncNow}
            disabled={!canSync || syncingNow}
          >
            <RefreshCw size={16} />
            {sync.syncing || syncingNow ? "Syncing…" : "Sync Now"}
          </button>
          <p className="data-note">
            Local saves always continue. Pending changes upload automatically after local login
            succeeds, Firebase authentication completes, and this device is authorized.
          </p>
        </div>

        {sync.lastError && (
          <div className="form-alert form-alert-error">
            <AlertTriangle size={16} />
            {sync.lastError}
          </div>
        )}
      </section>

      <GoogleCloudCard />

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Device Authorization</h2>
            <p>
              Anonymous Firebase authentication identifies this device. Pharmacy data is only
              available to devices enrolled in this workspace.
            </p>
          </div>
          <ShieldCheck size={18} />
        </div>

        {configured && !localUserActive && (
          <div className="form-alert form-alert-warning">
            Sign in with your local PharmaCare account. Firebase authentication starts
            automatically after the local login succeeds.
          </div>
        )}

        {configured && localUserActive && (connecting || authLoading) && !authError && (
          <p className="data-note">Authenticating this device with Firebase…</p>
        )}

        {configured && authError && (
          <>
            <div className="form-alert form-alert-error">
              <AlertTriangle size={16} />
              {authError}
            </div>
            <div className="data-actions">
              <button type="button" className="btn btn-secondary" onClick={retryAuthentication}>
                <RefreshCw size={16} />
                Retry Authentication
              </button>
            </div>
          </>
        )}

        {configured && authorized && (
          <>
            <div className="detail-grid">
              <div>
                <span>Authorization</span>
                <strong>Authorized for {workspaceId}</strong>
              </div>
              <div>
                <span>Workspace role</span>
                <strong>{membership.role}</strong>
              </div>
            </div>

            <div className="data-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => copyText(deviceId, "Device ID")}
              >
                <Copy size={16} />
                Copy Device ID
              </button>
              <button type="button" className="btn btn-secondary" onClick={refreshMembership}>
                <RefreshCw size={16} />
                Check Authorization
              </button>
            </div>

            {canManageDevices && (
              <div className="data-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onManageDevices?.()}
                >
                  <KeyRound size={16} />
                  Open Device Management
                </button>
                <p className="data-note">
                  Generate one-time enrollment codes and review enrolled devices under
                  Settings → Users &amp; Roles → Device Management.
                </p>
              </div>
            )}
          </>
        )}

        {configured && cloudUser && !authorized && membership.status !== "error" && (
          <>
            <div className="form-alert form-alert-warning">
              This device is authenticated but not enrolled.
              {membership.reason ? ` ${membership.reason}` : ""} Enter a one-time enrollment
              code from an administrator device, or ask the administrator to add the device ID
              shown above in Firebase Console.
            </div>

            <form onSubmit={handleEnroll} className="form-grid">
              <Field label="Enrollment Code" required>
                <input
                  type="text"
                  value={codeInput}
                  onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  autoComplete="one-time-code"
                  spellCheck="false"
                />
              </Field>

              <div className="field-span-2">
                <button type="submit" className="btn btn-primary" disabled={enrolling}>
                  <ShieldCheck size={16} />
                  {enrolling ? "Authorizing…" : "Authorize This Device"}
                </button>
              </div>

              {enrollError && (
                <div className="form-alert form-alert-error field-span-2">{enrollError}</div>
              )}
            </form>

            <div className="data-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => copyText(deviceId, "Device ID")}
              >
                <Copy size={16} />
                Copy Device ID
              </button>
              <button type="button" className="btn btn-secondary" onClick={refreshMembership}>
                <RefreshCw size={16} />
                Check Authorization
              </button>
            </div>
          </>
        )}

        {configured && membership.status === "error" && (
          <>
            <div className="form-alert form-alert-error">
              <AlertTriangle size={16} />
              {membership.error || "Could not verify device authorization."}
            </div>
            <div className="data-actions">
              <button type="button" className="btn btn-secondary" onClick={refreshMembership}>
                <RefreshCw size={16} />
                Check Authorization
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function Settings() {
  const currentSettings = useSettings();
  const currentLogo = useLogo();
  const {
    user,
    users,
    can,
    createUser,
    updateUser,
    resetUserPassword,
    changePassword,
    deleteUser,
  } = useAuth();
  const { toast, confirm } = useUI();
  const location = useLocation();

  const [tab, setTab] = useState(() => {
    const requested = location.state?.tab;
    if (TABS.some((entry) => entry.id === requested)) return requested;
    // Returning from a full-page Google redirect lands on the Firebase tab.
    if (new URLSearchParams(location.search).has("google")) return "firebase";
    return "general";
  });
  const [formDraft, setFormDraft] = useState(null);
  const form = formDraft ?? { ...DEFAULT_SETTINGS, ...currentSettings };
  const [logoDraft, setLogoDraft] = useState(null);
  const logoValue = logoDraft ?? currentLogo;
  const [savingSettings, setSavingSettings] = useState(false);

  const [storage, setStorage] = useState(null);
  const [counts, setCounts] = useState([]);
  const [lastBackup, setLastBackup] = useState(() => getLastBackup());
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [restoreMode, setRestoreMode] = useState("replace");
  const [restoreError, setRestoreError] = useState("");

  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [userModal, setUserModal] = useState(false);
  const [userForm, setUserForm] = useState(EMPTY_USER);
  const [editingUser, setEditingUser] = useState(null);
  const [userError, setUserError] = useState("");
  const [savingUser, setSavingUser] = useState(false);

  const [passwordTarget, setPasswordTarget] = useState(null);
  const [resetForm, setResetForm] = useState({ password: "", confirm: "" });
  const [resetError, setResetError] = useState("");
  const [resetting, setResetting] = useState(false);

  const tabs = useMemo(() => TABS.filter((entry) => can(entry.permission)), [can]);
  const activeTab = tabs.some((entry) => entry.id === tab)
    ? tab
    : tabs[0]?.id || "general";

  // The Google callback returns to /settings?google=... in this SPA. A popup
  // notifies its opener and closes; a full-page redirect stashes the outcome
  // and opens the Firebase tab so the card can show the result.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has("google")) return;

    const payload = {
      type: "pharmacy-google-oauth",
      status: params.get("google") === "connected" ? "connected" : "error",
      intent: params.get("intent") || "read",
      reason: params.get("reason") || "",
      message: params.get("message") || "",
    };

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(payload, window.location.origin);
      } catch {
        // The opener will refresh its own state when it regains focus.
      }
      window.setTimeout(() => window.close(), 60);
      return;
    }

    storeGoogleOAuthResult(payload);
    window.history.replaceState({}, "", location.pathname);
  }, [location.search, location.pathname]);

  useEffect(() => {
    let active = true;

    async function loadMeta() {
      try {
        const estimate = await getStorageEstimate();
        const tableCounts = await Promise.all(
          db.tables.map(async (table) => ({ name: table.name, count: await table.count() }))
        );

        if (!active) return;
        setStorage(estimate);
        setCounts(tableCounts);
      } catch (metaError) {
        console.error("Could not read storage metadata:", metaError);
      }
    }

    loadMeta();
    return () => {
      active = false;
    };
  }, [activeTab]);

  function updateForm(field, value) {
    setFormDraft((previous) => ({ ...(previous ?? form), [field]: value }));
  }

  async function saveProfile(event) {
    event.preventDefault();
    const name = normalizeText(form.pharmacyName);

    if (!name) {
      toast.error("Pharmacy name is required.", "Cannot save");
      return;
    }
    if (form.email && !isValidEmail(form.email)) {
      toast.error("Enter a valid pharmacy email address.", "Cannot save");
      return;
    }
    if (form.phone && !isValidPhone(form.phone)) {
      toast.error("Enter a valid phone number.", "Cannot save");
      return;
    }
    if (!Number.isInteger(Number(form.lowStockLimit)) || Number(form.lowStockLimit) < 0) {
      toast.error("Low stock limit must be a whole number of zero or more.", "Cannot save");
      return;
    }
    if (!Number.isInteger(Number(form.expiryWarningDays)) || Number(form.expiryWarningDays) < 0) {
      toast.error("Expiry warning days must be a whole number of zero or more.", "Cannot save");
      return;
    }

    setSavingSettings(true);

    try {
      persistSettings({
        ...form,
        pharmacyName: name,
        lowStockLimit: Number(form.lowStockLimit),
        expiryWarningDays: Number(form.expiryWarningDays),
        invoicePrefix: normalizeText(form.invoicePrefix) || "INV",
      });

      persistLogo(logoValue);
      setFormDraft(null);
      setLogoDraft(null);
      toast.success("Pharmacy settings were saved on this device.", "Settings saved");
    } catch (saveError) {
      console.error("Settings save failed:", saveError);
      toast.error(
        "Could not save settings. Browser storage may be full. Try removing the logo or old backups.",
        "Save failed"
      );
    } finally {
      setSavingSettings(false);
    }
  }

  function handleLogoFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file for the logo.", "Invalid file");
      return;
    }

    if (file.size > 1024 * 1024) {
      toast.error("Logo images must be smaller than 1 MB.", "File too large");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setLogoDraft(String(reader.result || ""));
      toast.info("Logo selected. Save settings to apply it.", "Logo ready");
    };
    reader.onerror = () => toast.error("Could not read the selected image.", "Logo error");
    reader.readAsDataURL(file);
  }

  async function handleBackup() {
    setBackingUp(true);
    try {
      const result = await downloadBackup();
      setLastBackup({ at: new Date().toISOString(), filename: result.filename });
      const total = Object.values(result.counts).reduce((sum, value) => sum + value, 0);
      toast.success(
        `${total} records exported to ${result.filename}.`,
        "Backup downloaded"
      );
    } catch (backupError) {
      console.error("Backup failed:", backupError);
      toast.error(backupError.message || "Could not create a backup.", "Backup failed");
    } finally {
      setBackingUp(false);
    }
  }

  async function handleRestoreFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setRestoreError("");

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const summary = validateBackup(payload);
      setPendingRestore({ payload, summary, filename: file.name });
      setRestoreMode("replace");
    } catch (parseError) {
      console.error("Backup file invalid:", parseError);
      setRestoreError(
        parseError.message?.includes("JSON")
          ? "This file is not valid JSON. Choose a PharmaCare backup file."
          : parseError.message || "This backup file could not be validated."
      );
    }
  }

  async function confirmRestore() {
    if (!pendingRestore) return;

    const accepted = await confirm({
      title:
        restoreMode === "replace"
          ? "Replace all current data?"
          : "Merge this backup into current data?",
      message:
        restoreMode === "replace"
          ? `All current tables will be cleared and replaced with ${pendingRestore.summary.totalRecords} records from this backup. Settings and logo will also be overwritten. This cannot be undone unless you have another backup.`
          : `${pendingRestore.summary.totalRecords} records will be added or updated. Existing records with the same IDs are overwritten. This cannot be undone.`,
      confirmLabel: restoreMode === "replace" ? "Replace data" : "Merge data",
      tone: "danger",
    });

    if (!accepted) return;

    setRestoring(true);

    try {
      await restoreBackup(pendingRestore.payload, restoreMode);
      toast.success("Restore complete. Reloading the application…", "Data restored");
      setPendingRestore(null);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (restoreFailure) {
      console.error("Restore failed:", restoreFailure);
      toast.error(
        restoreFailure.message || "Restore failed. Current data was not intentionally changed.",
        "Restore failed"
      );
    } finally {
      setRestoring(false);
    }
  }

  async function changeOwnPassword(event) {
    event.preventDefault();
    setPasswordError("");

    if (!passwordForm.current) return setPasswordError("Enter your current password.");
    if (passwordForm.next.length < 8) return setPasswordError("New password must be at least 8 characters.");
    if (!/[A-Za-z]/.test(passwordForm.next) || !/[0-9]/.test(passwordForm.next)) {
      return setPasswordError("New password must contain at least one letter and one number.");
    }
    if (passwordForm.next !== passwordForm.confirm) return setPasswordError("New passwords do not match.");

    setSavingPassword(true);

    try {
      await changePassword(passwordForm.current, passwordForm.next);
      setPasswordForm({ current: "", next: "", confirm: "" });
      toast.success("Your password was changed.", "Password updated");
    } catch (passwordFailure) {
      setPasswordError(passwordFailure.message || "Could not change password.");
    } finally {
      setSavingPassword(false);
    }
  }

  function openAddUser() {
    setEditingUser(null);
    setUserForm(EMPTY_USER);
    setUserError("");
    setUserModal(true);
  }

  function openEditUser(account) {
    setEditingUser(account);
    setUserForm({
      name: account.name || "",
      username: account.username || "",
      password: "",
      confirm: "",
      role: account.role || "cashier",
      active: account.active !== false,
    });
    setUserError("");
    setUserModal(true);
  }

  async function saveUser(event) {
    event.preventDefault();
    setUserError("");

    setSavingUser(true);

    try {
      if (editingUser) {
        await updateUser(editingUser.id, {
          name: userForm.name,
          role: userForm.role,
          active: userForm.active,
        });
        toast.success(`${normalizeText(userForm.name)} was updated.`, "User updated");
      } else {
        if (userForm.password !== userForm.confirm) {
          throw new Error("Passwords do not match.");
        }
        await createUser({
          name: userForm.name,
          username: userForm.username,
          password: userForm.password,
          role: userForm.role,
        });
        toast.success(`${normalizeText(userForm.name)} can now sign in.`, "User created");
      }

      setUserModal(false);
      setEditingUser(null);
      setUserForm(EMPTY_USER);
    } catch (userFailure) {
      setUserError(userFailure.message || "Could not save this user.");
    } finally {
      setSavingUser(false);
    }
  }

  function openResetPassword(account) {
    setPasswordTarget(account);
    setResetForm({ password: "", confirm: "" });
    setResetError("");
  }

  async function resetPassword(event) {
    event.preventDefault();
    setResetError("");

    if (resetForm.password !== resetForm.confirm) {
      setResetError("Passwords do not match.");
      return;
    }

    setResetting(true);

    try {
      await resetUserPassword(passwordTarget.id, resetForm.password);
      toast.success(`Password reset for ${passwordTarget.name}.`, "Password reset");
      setPasswordTarget(null);
    } catch (resetFailure) {
      setResetError(resetFailure.message || "Could not reset password.");
    } finally {
      setResetting(false);
    }
  }

  async function requestDeleteUser(account) {
    const accepted = await confirm({
      title: `Delete ${account.name}?`,
      message: "This removes the local login for this user. Existing sales and purchase records keep the stored name.",
      confirmLabel: "Delete user",
      tone: "danger",
    });

    if (!accepted) return;

    try {
      deleteUser(account.id);
      toast.success(`${account.name} was removed.`, "User deleted");
    } catch (deleteFailure) {
      toast.error(deleteFailure.message || "Could not delete this user.", "Delete failed");
    }
  }

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="SYSTEM"
        title="Settings"
        subtitle="Pharmacy profile, invoices, users, security and data protection."
      />

      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">
          {tabs.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                className={`settings-tab ${activeTab === entry.id ? "active" : ""}`}
                onClick={() => setTab(entry.id)}
              >
                <Icon size={17} />
                <span>{entry.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {(activeTab === "general" || activeTab === "invoice") && (
            <form onSubmit={saveProfile} className="settings-stack">
              {activeTab === "general" && (
                <section className="card">
                  <div className="card-head">
                    <div>
                      <h2>Pharmacy Information</h2>
                      <p>These details appear in the sidebar and on printed invoices.</p>
                    </div>
                    <Store size={18} />
                  </div>

                  <div className="settings-logo-row">
                    <div className="settings-logo-preview">
                      {logoValue ? <img src={logoValue} alt="Pharmacy logo" /> : <Store size={28} />}
                    </div>
                    <div className="settings-logo-actions">
                      <label className="btn btn-secondary btn-sm">
                        <Upload size={15} />
                        Upload Logo
                        <input type="file" accept="image/*" onChange={handleLogoFile} hidden />
                      </label>
                      {logoValue && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setLogoDraft("")}
                        >
                          Remove logo
                        </button>
                      )}
                      <small>PNG/JPG/SVG, maximum 1 MB. Stored in this browser only.</small>
                    </div>
                  </div>

                  <div className="form-grid">
                    <Field label="Pharmacy Name" required className="field-span-2">
                      <input
                        value={form.pharmacyName}
                        onChange={(event) => updateForm("pharmacyName", event.target.value)}
                        placeholder="PharmaCare"
                      />
                    </Field>

                    <Field label="Phone">
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(event) => updateForm("phone", event.target.value)}
                        placeholder="03XXXXXXXXX"
                      />
                    </Field>

                    <Field label="Email">
                      <input
                        type="email"
                        value={form.email}
                        onChange={(event) => updateForm("email", event.target.value)}
                        placeholder="pharmacy@example.com"
                      />
                    </Field>

                    <Field label="Address" className="field-span-2">
                      <textarea
                        rows="3"
                        value={form.address}
                        onChange={(event) => updateForm("address", event.target.value)}
                        placeholder="Street, city, postal code"
                      />
                    </Field>

                    <Field label="Currency" hint="Used for all money formatting.">
                      <select
                        value={form.currency}
                        onChange={(event) => updateForm("currency", event.target.value)}
                      >
                        {CURRENCIES.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </section>
              )}

              {activeTab === "invoice" && (
                <>
                  <section className="card">
                    <div className="card-head">
                      <div>
                        <h2>Invoice Settings</h2>
                        <p>Control the numbering and footer of sales receipts.</p>
                      </div>
                      <Save size={18} />
                    </div>

                    <div className="form-grid">
                      <Field label="Invoice Prefix" hint="Letters, numbers, dash and slash only.">
                        <input
                          value={form.invoicePrefix}
                          onChange={(event) => updateForm("invoicePrefix", event.target.value)}
                          placeholder="INV"
                        />
                      </Field>

                      <Field label="Invoice Footer">
                        <input
                          value={form.invoiceFooter}
                          onChange={(event) => updateForm("invoiceFooter", event.target.value)}
                          placeholder="Thank you for your visit!"
                        />
                      </Field>
                    </div>
                  </section>

                  <section className="card">
                    <div className="card-head">
                      <div>
                        <h2>Inventory Alerts</h2>
                        <p>Thresholds used across the dashboard, inventory and reports.</p>
                      </div>
                      <BadgeCheck size={18} />
                    </div>

                    <div className="form-grid">
                      <Field
                        label="Low Stock Alert Limit"
                        hint="Medicines at or below this quantity are marked low stock."
                      >
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={form.lowStockLimit}
                          onChange={(event) => updateForm("lowStockLimit", event.target.value)}
                        />
                      </Field>

                      <Field
                        label="Expiry Warning Days"
                        hint="Medicines expiring within this many days are flagged."
                      >
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={form.expiryWarningDays}
                          onChange={(event) => updateForm("expiryWarningDays", event.target.value)}
                        />
                      </Field>
                    </div>
                  </section>
                </>
              )}

              <div className="settings-save-row">
                <button type="submit" className="btn btn-primary" disabled={savingSettings}>
                  <Save size={16} />
                  {savingSettings ? "Saving…" : "Save Settings"}
                </button>
              </div>
            </form>
          )}

          {activeTab === "security" && (
            <div className="settings-stack">
              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>My Account</h2>
                    <p>Signed-in identity and session details.</p>
                  </div>
                  <UserCog size={18} />
                </div>

                <div className="detail-grid">
                  <div>
                    <span>Name</span>
                    <strong>{user?.name || "—"}</strong>
                  </div>
                  <div>
                    <span>Username</span>
                    <strong>{user?.username || "—"}</strong>
                  </div>
                  <div>
                    <span>Role</span>
                    <strong>{ROLES[user?.role]?.label || user?.role || "—"}</strong>
                  </div>
                  <div>
                    <span>Last sign-in</span>
                    <strong>{toDisplayDateTime(user?.lastLoginAt)}</strong>
                  </div>
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>Change Password</h2>
                    <p>Passwords are stored as salted PBKDF2 hashes, never as plain text.</p>
                  </div>
                  <KeyRound size={18} />
                </div>

                <form onSubmit={changeOwnPassword} className="form-grid">
                  <Field label="Current Password" required className="field-span-2">
                    <input
                      type="password"
                      value={passwordForm.current}
                      onChange={(event) =>
                        setPasswordForm((previous) => ({ ...previous, current: event.target.value }))
                      }
                      autoComplete="current-password"
                    />
                  </Field>

                  <Field label="New Password" required>
                    <input
                      type="password"
                      value={passwordForm.next}
                      onChange={(event) =>
                        setPasswordForm((previous) => ({ ...previous, next: event.target.value }))
                      }
                      autoComplete="new-password"
                    />
                  </Field>

                  <Field label="Confirm New Password" required>
                    <input
                      type="password"
                      value={passwordForm.confirm}
                      onChange={(event) =>
                        setPasswordForm((previous) => ({ ...previous, confirm: event.target.value }))
                      }
                      autoComplete="new-password"
                    />
                  </Field>

                  {passwordError && (
                    <div className="form-alert form-alert-error field-span-2">{passwordError}</div>
                  )}

                  <div className="field-span-2">
                    <button type="submit" className="btn btn-primary" disabled={savingPassword}>
                      <KeyRound size={16} />
                      {savingPassword ? "Updating…" : "Update Password"}
                    </button>
                  </div>
                </form>
              </section>

              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>Security Notes</h2>
                    <p>Understand what this local access control protects.</p>
                  </div>
                  <ShieldCheck size={18} />
                </div>

                <ul className="plain-list">
                  <li>Authentication is local to this browser profile and is not a server-side security boundary.</li>
                  <li>Passwords use salted PBKDF2-SHA256 hashes. They are never stored in plain text.</li>
                  <li>IndexedDB data is not encrypted; anyone with access to this browser profile or developer tools can read it.</li>
                  <li>Sessions expire after 8 hours, or 30 days when “keep me signed in” is selected.</li>
                  <li>Five failed sign-in attempts lock that username for 60 seconds.</li>
                  <li>For multi-user or networked use, deploy a trusted server-side authentication service.</li>
                </ul>
              </section>
            </div>
          )}

          {activeTab === "users" && (
            <div className="settings-stack">
              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>Users & Roles</h2>
                    <p>Local staff accounts and their permissions.</p>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={openAddUser}>
                    <Plus size={15} />
                    Add User
                  </button>
                </div>

                {users.length === 0 ? (
                  <EmptyState icon={Users} title="No users" message="Create a staff account to get started." />
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>User</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Last Sign-in</th>
                          <th className="actions-col">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((account) => (
                          <tr key={account.id}>
                            <td>
                              <div className="cell-with-avatar">
                                <span className="avatar-circle">
                                  {(account.name || "U").charAt(0).toUpperCase()}
                                </span>
                                <div className="cell-primary">
                                  <strong>
                                    {account.name}
                                    {account.id === user?.id ? " (you)" : ""}
                                  </strong>
                                  <span>@{account.username}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <Badge tone={account.role === "admin" ? "blue" : "neutral"}>
                                {ROLES[account.role]?.label || account.role}
                              </Badge>
                            </td>
                            <td>
                              <Badge tone={account.active === false ? "red" : "green"} dot>
                                {account.active === false ? "Disabled" : "Active"}
                              </Badge>
                            </td>
                            <td>{toDisplayDateTime(account.lastLoginAt)}</td>
                            <td>
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className="btn-icon"
                                  title="Edit user"
                                  onClick={() => openEditUser(account)}
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="btn-icon"
                                  title="Reset password"
                                  onClick={() => openResetPassword(account)}
                                >
                                  <KeyRound size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="btn-icon btn-icon-danger"
                                  title="Delete user"
                                  disabled={account.id === user?.id}
                                  onClick={() => requestDeleteUser(account)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <DeviceManagement />

              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>Role Permissions</h2>
                    <p>Roles control which modules and actions are available.</p>
                  </div>
                  <ShieldCheck size={18} />
                </div>

                <div className="role-grid">
                  {Object.entries(ROLES).map(([key, role]) => (
                    <div className="role-card" key={key}>
                      <strong>{role.label}</strong>
                      <p>{role.description}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === "data" && (
            <div className="settings-stack">
              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>Backup</h2>
                    <p>Download a complete JSON copy of all pharmacy records and settings.</p>
                  </div>
                  <Download size={18} />
                </div>

                <div className="data-actions">
                  <button type="button" className="btn btn-primary" onClick={handleBackup} disabled={backingUp}>
                    <Download size={16} />
                    {backingUp ? "Preparing backup…" : "Download Backup"}
                  </button>
                  {lastBackup?.at && (
                    <p className="data-note">
                      Last backup: {toDisplayDateTime(lastBackup.at)}
                      {lastBackup.filename ? ` · ${lastBackup.filename}` : ""}
                    </p>
                  )}
                </div>

                <div className="data-table-summary">
                  {counts.map((entry) => (
                    <div key={entry.name}>
                      <span>{entry.name}</span>
                      <strong>{formatInteger(entry.count)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>Restore</h2>
                    <p>Restore from a PharmaCare backup file. Always download a fresh backup first.</p>
                  </div>
                  <Upload size={18} />
                </div>

                <div className="data-actions">
                  <label className="btn btn-secondary">
                    <Upload size={16} />
                    Choose Backup File
                    <input type="file" accept="application/json,.json" onChange={handleRestoreFile} hidden />
                  </label>
                  <p className="data-note">
                    Restore validates the file before changing anything. Replacing clears tables
                    first; merging updates records with the same IDs.
                  </p>
                </div>

                {restoreError && <div className="form-alert form-alert-error">{restoreError}</div>}

                {pendingRestore && (
                  <div className="restore-preview">
                    <div className="restore-preview-head">
                      <div>
                        <strong>{pendingRestore.filename}</strong>
                        <span>
                          Exported {toDisplayDateTime(pendingRestore.summary.exportedAt)} · app
                          version {pendingRestore.summary.appVersion}
                        </span>
                      </div>
                      <Badge tone="amber">{pendingRestore.summary.totalRecords} records</Badge>
                    </div>

                    <div className="data-table-summary">
                      {pendingRestore.summary.tables.map((name) => (
                        <div key={name}>
                          <span>{name}</span>
                          <strong>{pendingRestore.payload.data[name].length}</strong>
                        </div>
                      ))}
                    </div>

                    <div className="form-grid">
                      <Field label="Restore mode" className="field-span-2">
                        <select value={restoreMode} onChange={(event) => setRestoreMode(event.target.value)}>
                          <option value="replace">Replace all current data (recommended for a clean restore)</option>
                          <option value="merge">Merge into current data</option>
                        </select>
                      </Field>
                    </div>

                    <div className="restore-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setPendingRestore(null)}
                        disabled={restoring}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={confirmRestore}
                        disabled={restoring}
                      >
                        {restoring ? "Restoring…" : "Restore This Backup"}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>Storage</h2>
                    <p>Browser storage used by the local IndexedDB database.</p>
                  </div>
                  <HardDrive size={18} />
                </div>

                {storage ? (
                  <div className="storage-block">
                    <div className="storage-bar">
                      <i
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(1, Math.round((storage.usage / Math.max(storage.quota, 1)) * 100))
                          )}%`,
                        }}
                      />
                    </div>
                    <p>
                      {formatBytes(storage.usage)} used of {formatBytes(storage.quota)} available
                      {storage.quota
                        ? ` (${((storage.usage / storage.quota) * 100).toFixed(1)}%)`
                        : ""}
                      .
                    </p>
                  </div>
                ) : (
                  <p className="data-note">Storage estimates are not available in this browser.</p>
                )}

                <p className="data-note">
                  Clearing browser site data will erase the local database. Keep regular exported
                  backups on a separate drive.
                </p>
              </section>
            </div>
          )}

          {activeTab === "firebase" && (
            <FirebasePanel onManageDevices={() => setTab("users")} />
          )}

          {activeTab === "about" && (
            <div className="settings-stack">
              <section className="card">
                <div className="card-head">
                  <div>
                    <h2>{APP_NAME} v{APP_VERSION}</h2>
                    <p>Professional Pharmacy Management & POS System.</p>
                  </div>
                  <ShieldCheck size={18} />
                </div>

                <div className="about-grid">
                  <div>
                    <span>Data storage</span>
                    <strong>Local IndexedDB (Dexie) + localStorage settings</strong>
                  </div>
                  <div>
                    <span>Authentication</span>
                    <strong>Local PBKDF2 password hashing with roles</strong>
                  </div>
                  <div>
                    <span>Stack</span>
                    <strong>React, Vite, Dexie, React Router, Lucide</strong>
                  </div>
                  <div>
                    <span>Offline</span>
                    <strong>Works without an internet connection</strong>
                  </div>
                </div>

                <ul className="plain-list">
                  <li>Dashboard metrics are calculated live from your records.</li>
                  <li>Stock deductions and purchase additions run inside database transactions.</li>
                  <li>Profit reporting uses cost captured at checkout; legacy sales without cost are excluded and disclosed.</li>
                  <li>Backups exclude login credentials by design.</li>
                  <li>For multi-user or network deployment, add a trusted server-side backend.</li>
                </ul>
              </section>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={userModal}
        onClose={() => {
          if (!savingUser) setUserModal(false);
        }}
        title={editingUser ? "Edit User" : "Add User"}
        subtitle={
          editingUser
            ? "Update name, role or active status."
            : "Create a local account with a hashed password."
        }
        size="md"
        closeDisabled={savingUser}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setUserModal(false)}
              disabled={savingUser}
            >
              Cancel
            </button>
            <button type="submit" form="user-form" className="btn btn-primary" disabled={savingUser}>
              {savingUser ? "Saving…" : editingUser ? "Update User" : "Create User"}
            </button>
          </>
        }
      >
        <form id="user-form" onSubmit={saveUser} className="form-grid">
          <Field label="Full Name" required className="field-span-2">
            <input
              value={userForm.name}
              onChange={(event) => setUserForm((previous) => ({ ...previous, name: event.target.value }))}
              placeholder="e.g. Sara Ahmed"
              autoFocus
            />
          </Field>

          {!editingUser && (
            <>
              <Field label="Username" required>
                <input
                  value={userForm.username}
                  onChange={(event) =>
                    setUserForm((previous) => ({ ...previous, username: event.target.value }))
                  }
                  placeholder="3–32 letters, numbers, . _ -"
                  autoComplete="username"
                />
              </Field>

              <Field label="Role" required>
                <select
                  value={userForm.role}
                  onChange={(event) =>
                    setUserForm((previous) => ({ ...previous, role: event.target.value }))
                  }
                >
                  {Object.entries(ROLES).map(([key, role]) => (
                    <option key={key} value={key}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Password" required hint="At least 8 characters with a letter and number.">
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(event) =>
                    setUserForm((previous) => ({ ...previous, password: event.target.value }))
                  }
                  autoComplete="new-password"
                />
              </Field>

              <Field label="Confirm Password" required>
                <input
                  type="password"
                  value={userForm.confirm}
                  onChange={(event) =>
                    setUserForm((previous) => ({ ...previous, confirm: event.target.value }))
                  }
                  autoComplete="new-password"
                />
              </Field>
            </>
          )}

          {editingUser && (
            <>
              <Field label="Role" required>
                <select
                  value={userForm.role}
                  onChange={(event) =>
                    setUserForm((previous) => ({ ...previous, role: event.target.value }))
                  }
                >
                  {Object.entries(ROLES).map(([key, role]) => (
                    <option key={key} value={key}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Status">
                <select
                  value={userForm.active ? "active" : "disabled"}
                  onChange={(event) =>
                    setUserForm((previous) => ({
                      ...previous,
                      active: event.target.value === "active",
                    }))
                  }
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </Field>
            </>
          )}

          {userError && <div className="form-alert form-alert-error field-span-2">{userError}</div>}
        </form>
      </Modal>

      <Modal
        open={Boolean(passwordTarget)}
        onClose={() => {
          if (!resetting) setPasswordTarget(null);
        }}
        title="Reset Password"
        subtitle={passwordTarget ? `${passwordTarget.name} · @${passwordTarget.username}` : ""}
        size="sm"
        closeDisabled={resetting}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setPasswordTarget(null)}
              disabled={resetting}
            >
              Cancel
            </button>
            <button type="submit" form="reset-password-form" className="btn btn-primary" disabled={resetting}>
              {resetting ? "Resetting…" : "Reset Password"}
            </button>
          </>
        }
      >
        <form id="reset-password-form" onSubmit={resetPassword} className="form-grid">
          <Field label="New Password" required className="field-span-2">
            <input
              type="password"
              value={resetForm.password}
              onChange={(event) =>
                setResetForm((previous) => ({ ...previous, password: event.target.value }))
              }
              autoComplete="new-password"
              autoFocus
            />
          </Field>

          <Field label="Confirm New Password" required className="field-span-2">
            <input
              type="password"
              value={resetForm.confirm}
              onChange={(event) =>
                setResetForm((previous) => ({ ...previous, confirm: event.target.value }))
              }
              autoComplete="new-password"
            />
          </Field>

          {resetError && <div className="form-alert form-alert-error field-span-2">{resetError}</div>}
        </form>
      </Modal>
    </div>
  );
}
