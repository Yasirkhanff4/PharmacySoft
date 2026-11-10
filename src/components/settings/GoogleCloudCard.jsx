import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Cloud,
  Database,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCloud } from "../../context/CloudContext";
import { useUI } from "../../context/UIContext";
import { Badge, Field } from "../ui/primitives";
import Modal from "../ui/Modal";
import { toDisplayDateTime } from "../../lib/format";
import {
  CloudApiError,
  consumeGoogleOAuthResult,
  createFirebaseWebApp,
  disconnectGoogle,
  getGoogleSession,
  getProjectWebConfig,
  inspectFirebaseProject,
  listFirebaseProjects,
  startGoogleAuthorization,
} from "../../lib/googleCloudApi";
import {
  assessProjectSwitch,
  saveRuntimeConfig,
} from "../../firebase/runtimeConfig";

const CHECK_TONE = {
  ok: "ok",
  action_required: "warn",
  blocked: "error",
  unknown: "muted",
  error: "error",
};

function CheckIcon({ status }) {
  if (status === "ok") return <BadgeCheck size={16} className="check-ok" />;
  if (status === "blocked" || status === "error") {
    return <AlertTriangle size={16} className="check-error" />;
  }
  if (status === "action_required") return <AlertTriangle size={16} className="check-warn" />;
  return <Cloud size={16} className="check-muted" />;
}

export default function GoogleCloudCard() {
  const {
    configured,
    configSource,
    projectId: currentProjectId,
    workspaceId,
    deviceId,
    cloudUser,
    sync,
  } = useCloud();
  const { toast, confirm } = useUI();

  const [session, setSession] = useState({
    status: "loading",
    email: "",
    canWriteFirebase: false,
    connectedAt: null,
    reconnectRequired: false,
  });
  const [projects, setProjects] = useState({ status: "idle", items: [], error: "" });
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [inspection, setInspection] = useState({ status: "idle", data: null, error: "" });
  const [selectedAppId, setSelectedAppId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [appName, setAppName] = useState("Pharmacy Web");
  const [switchOpen, setSwitchOpen] = useState(false);

  const pendingCreate = useRef(false);
  const createAction = useRef(null);

  const pendingChanges = Number(sync.pendingCount || 0) + Number(sync.failedCount || 0);
  const connected = session.status === "connected";
  const authReady = Boolean(cloudUser?.uid);

  const refreshSession = useCallback(async () => {
    try {
      const data = await getGoogleSession();
      if (data.connected) {
        setSession({
          status: "connected",
          email: data.email,
          canWriteFirebase: Boolean(data.canWriteFirebase),
          connectedAt: data.connectedAt,
          reconnectRequired: false,
        });
        setError("");
        return true;
      }
      setSession({
        status: "disconnected",
        email: data.email || "",
        canWriteFirebase: false,
        connectedAt: null,
        reconnectRequired: Boolean(data.reconnectRequired),
      });
      setError("");
      return false;
    } catch (sessionError) {
      setSession({
        status: "error",
        email: "",
        canWriteFirebase: false,
        connectedAt: null,
        reconnectRequired: false,
      });
      setError(sessionError.message || "Could not read the Google connection status.");
      return false;
    }
  }, []);

  const loadProjects = useCallback(async () => {
    setProjects({ status: "loading", items: [], error: "" });
    try {
      const data = await listFirebaseProjects();
      setProjects({ status: "ready", items: data.projects || [], error: "" });
      setSelectedProjectId((current) => current || data.currentProjectId || "");
      return data;
    } catch (projectsError) {
      setProjects({
        status: "error",
        items: [],
        error: projectsError.message || "Could not list Firebase projects.",
      });
      return null;
    }
  }, []);

  const runInspection = useCallback(async (projectId) => {
    if (!projectId) return;
    setInspection({ status: "loading", data: null, error: "" });
    try {
      const data = await inspectFirebaseProject(projectId);
      setInspection({ status: "ready", data, error: "" });
      const webApps = data.checks?.find((check) => check.id === "web_app")?.apps || [];
      setSelectedAppId((current) => {
        if (current && webApps.some((app) => app.appId === current)) return current;
        return webApps.length === 1 ? webApps[0].appId : "";
      });
    } catch (inspectionError) {
      setInspection({
        status: "error",
        data: null,
        error: inspectionError.message || "Could not inspect this project.",
      });
    }
  }, []);

  useEffect(() => {
    if (!authReady) return undefined;
    let cancelled = false;
    (async () => {
      const connectedNow = await refreshSession();
      if (connectedNow && !cancelled) await loadProjects();
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, refreshSession, loadProjects]);

  useEffect(() => {
    if (!connected || !selectedProjectId) return undefined;
    // Defer so the inspection's loading state is not set synchronously inside
    // the effect body (which would cause an extra render pass).
    const timer = window.setTimeout(() => runInspection(selectedProjectId), 0);
    return () => window.clearTimeout(timer);
  }, [connected, selectedProjectId, runInspection]);

  const doConnect = useCallback(async () => {
    setBusy("connect");
    setError("");
    setNotice("");
    try {
      const result = await getProjectWebConfig(selectedProjectId, selectedAppId || undefined);
      saveRuntimeConfig({
        config: result.webConfig,
        workspaceId: result.workspaceId || workspaceId,
        googleEmail: session.email,
      });
      toast.success(
        "Public Firebase configuration saved. Reloading with the selected project…",
        "Project connected"
      );
      window.setTimeout(() => window.location.reload(), 700);
    } catch (connectError) {
      setError(connectError.message || "Could not read this project's web configuration.");
      setBusy("");
    }
  }, [selectedProjectId, selectedAppId, workspaceId, session.email, toast]);

  const handleConnectProject = useCallback(async () => {
    setError("");
    const assessment = assessProjectSwitch({
      currentProjectId,
      nextProjectId: selectedProjectId,
      pendingCount: sync.pendingCount,
      failedCount: sync.failedCount,
    });

    if (!assessment.allowed) {
      setError(assessment.reason);
      return;
    }
    if (assessment.requiresConfirmation) {
      setSwitchOpen(true);
      return;
    }
    await doConnect();
  }, [currentProjectId, selectedProjectId, sync.pendingCount, sync.failedCount, doConnect]);

  const handleCreateApp = useCallback(async () => {
    if (!selectedProjectId) return;
    setBusy("create");
    setError("");
    try {
      const result = await createFirebaseWebApp(
        selectedProjectId,
        (appName || "Pharmacy Web").trim()
      );
      toast.success(result.message, result.created ? "Web app created" : "Web app reused");
      setCreateOpen(false);
      await runInspection(selectedProjectId);
    } catch (createError) {
      if (createError instanceof CloudApiError && createError.code === "write_scope_required") {
        pendingCreate.current = true;
        setCreateOpen(false);
        setNotice(
          "Creating a Firebase Web App needs one extra Google permission. Approve it in the popup, then retry."
        );
        const { redirected } = startGoogleAuthorization({
          intent: "write",
          projectId: selectedProjectId,
          loginHint: session.email,
        });
        if (redirected) {
          // The page navigates away; the retry happens after Google returns.
          pendingCreate.current = true;
        }
      } else {
        setError(createError.message || "Could not create the Firebase Web App.");
      }
    } finally {
      setBusy("");
    }
  }, [selectedProjectId, appName, session.email, toast, runInspection]);

  useEffect(() => {
    createAction.current = handleCreateApp;
  }, [handleCreateApp]);

  const handleOAuthMessage = useCallback(
    async (payload) => {
      if (payload?.status === "connected") {
        setNotice("");
        const connectedNow = await refreshSession();
        if (connectedNow) {
          await loadProjects();
          if (payload.intent === "write" && pendingCreate.current) {
            pendingCreate.current = false;
            await createAction.current?.();
          }
        }
        return;
      }

      pendingCreate.current = false;
      setError(payload?.message || "Google authorization did not complete. Try again.");
    },
    [refreshSession, loadProjects]
  );

  useEffect(() => {
    function onMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "pharmacy-google-oauth") return;
      handleOAuthMessage(event.data);
    }
    function onLocalResult(event) {
      handleOAuthMessage(event.detail);
    }

    window.addEventListener("message", onMessage);
    window.addEventListener("pharmacy:google-oauth", onLocalResult);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pharmacy:google-oauth", onLocalResult);
    };
  }, [handleOAuthMessage]);

  function handleConnectGoogle() {
    setError("");
    setNotice("");
    const { redirected } = startGoogleAuthorization({
      intent: "read",
      loginHint: session.email || "",
    });
    if (!redirected) {
      setNotice("Complete the Google consent step in the popup window.");
    }
  }

  async function handleDisconnect() {
    const approved = await confirm({
      title: "Disconnect Google account?",
      message:
        "This revokes the pharmacy app's Google access. Local pharmacy data, pending changes and this device's authorization are not affected, and synchronization keeps working. You can reconnect at any time.",
      confirmLabel: "Disconnect",
      tone: "danger",
    });
    if (!approved) return;

    setBusy("disconnect");
    setError("");
    setNotice("");
    try {
      await disconnectGoogle();
      setSession({
        status: "disconnected",
        email: "",
        canWriteFirebase: false,
        connectedAt: null,
        reconnectRequired: false,
      });
      setProjects({ status: "idle", items: [], error: "" });
      setInspection({ status: "idle", data: null, error: "" });
      setSelectedProjectId("");
      toast.success("The Google account was disconnected. Local data is unchanged.", "Disconnected");
    } catch (disconnectError) {
      setError(disconnectError.message || "Could not disconnect the Google account.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    // Defer past the parent Settings effect, which stores the redirect result
    // after this child effect would otherwise run.
    const timer = window.setTimeout(() => {
      const stored = consumeGoogleOAuthResult();
      if (stored) handleOAuthMessage(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [handleOAuthMessage]);

  const webAppCheck = inspection.data?.checks?.find((check) => check.id === "web_app");
  const webApps = webAppCheck?.apps || [];
  const projectOptions = projects.items;
  const targetIsCurrent = Boolean(selectedProjectId) && selectedProjectId === currentProjectId;

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Connect with Google</h2>
          <p>
            Authorize a Google account, pick an existing Firebase project, and load its public
            web configuration without editing environment files.
          </p>
        </div>
        <div className="badge-stack">
          <Badge tone={connected ? "green" : "neutral"} dot>
            {session.status === "loading"
              ? "Checking…"
              : connected
                ? "Google connected"
                : "Google not connected"}
          </Badge>
          {connected && (
            <Badge tone={session.canWriteFirebase ? "blue" : "neutral"}>
              {session.canWriteFirebase ? "Read + create" : "Read only"}
            </Badge>
          )}
          {configSource === "runtime" && <Badge tone="indigo">Runtime config</Badge>}
        </div>
      </div>

      {error && (
        <div className="form-alert form-alert-error">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {notice && !error && <div className="form-alert form-alert-warning">{notice}</div>}

      {!configured && (
        <div className="form-alert form-alert-warning">
          This build has no Firebase configuration yet, so the server cannot verify an
          administrator device. Add the six public values once (see .env.example) or restore a
          saved runtime configuration, then connect Google.
        </div>
      )}

      {session.status === "loading" && <p className="data-note">Checking the Google connection…</p>}

      {configured && !authReady && (
        <p className="data-note">Waiting for this device to finish Firebase authentication…</p>
      )}

      {session.status === "error" && (
        <div className="data-actions">
          <button type="button" className="btn btn-secondary" onClick={refreshSession}>
            <RefreshCw size={16} />
            Retry connection check
          </button>
        </div>
      )}

      {session.status !== "connected" && session.status !== "loading" && configured && authReady && (
        <>
          {session.reconnectRequired && (
            <div className="form-alert form-alert-warning">
              <AlertTriangle size={16} />
              Google authorization for {session.email || "the connected account"} expired or was
              revoked. Reconnect to manage the Firebase project — synchronization is not affected.
            </div>
          )}
          <div className="data-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConnectGoogle}
              disabled={Boolean(busy)}
            >
              <ShieldCheck size={16} />
              Connect with Google
            </button>
            <p className="data-note">
              Read-only Firebase access is requested first. Google never asks this app for your
              password, and the authorization code is exchanged on the server.
            </p>
          </div>
          <p className="data-note">
            Only an active administrator device can change the project. If this device is not
            authorized yet, enroll it under Users &amp; Roles first.
          </p>
        </>
      )}

      {connected && (
        <>
          <div className="detail-grid">
            <div>
              <span>Google account</span>
              <strong>{session.email}</strong>
            </div>
            <div>
              <span>Granted permissions</span>
              <strong>
                {session.canWriteFirebase
                  ? "Firebase read + create web apps"
                  : "Firebase read-only"}
              </strong>
            </div>
            <div>
              <span>Connected since</span>
              <strong>{toDisplayDateTime(session.connectedAt) || "—"}</strong>
            </div>
            <div>
              <span>Current project</span>
              <strong>{currentProjectId || "Not configured"}</strong>
            </div>
          </div>

          <div className="data-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                refreshSession();
                loadProjects();
              }}
              disabled={Boolean(busy)}
            >
              <RefreshCw size={16} />
              Refresh connection
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDisconnect}
              disabled={busy === "disconnect"}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect Google account"}
            </button>
          </div>
          <p className="data-note">
            Disconnecting revokes the Google grant only. Local data, pending changes and device
            authorization stay exactly as they are, and synchronization keeps running.
          </p>

          <hr className="google-divider" />

          <div className="google-project-row">
            <Field label="Firebase project" hint="Projects the connected account can access.">
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                disabled={projects.status === "loading"}
              >
                <option value="">
                  {projects.status === "loading" ? "Loading projects…" : "Select a project…"}
                </option>
                {projectOptions.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.displayName} ({project.projectId})
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              className="btn btn-secondary google-project-refresh"
              onClick={loadProjects}
              disabled={projects.status === "loading"}
            >
              <RefreshCw size={16} />
              Reload
            </button>
          </div>

          {projects.status === "error" && (
            <div className="form-alert form-alert-error">
              <AlertTriangle size={16} />
              {projects.error}
            </div>
          )}

          {projects.status === "ready" && !projectOptions.length && (
            <div className="form-alert form-alert-warning">
              This Google account cannot see any Firebase projects. Confirm the Firebase
              Management API is enabled and that the account has access to the project.
            </div>
          )}

          {selectedProjectId && (
            <>
              <div className="google-checks">
                {inspection.status === "loading" && (
                  <p className="data-note">Inspecting the selected project…</p>
                )}

                {inspection.status === "error" && (
                  <div className="form-alert form-alert-error">
                    <AlertTriangle size={16} />
                    {inspection.error}
                  </div>
                )}

                {inspection.status === "ready" && (
                  <>
                    <ul className="check-list">
                      {(inspection.data.checks || []).map((check) => (
                        <li key={check.id} className={`check-item check-${CHECK_TONE[check.status] || "muted"}`}>
                          <CheckIcon status={check.status} />
                          <div>
                            <strong>
                              {check.id === "web_app"
                                ? "Firebase Web App"
                                : check.id === "firestore_database"
                                  ? "Cloud Firestore"
                                  : check.id === "firestore_rules"
                                    ? "Published security rules"
                                    : check.id}
                            </strong>
                            <span>{check.message}</span>
                          </div>
                        </li>
                      ))}
                    </ul>

                    {webApps.length > 1 && (
                      <Field
                        label="Firebase Web App"
                        hint="This project has more than one web app. Choose the one the pharmacy should use."
                      >
                        <select
                          value={selectedAppId}
                          onChange={(event) => setSelectedAppId(event.target.value)}
                        >
                          <option value="">Select a web app…</option>
                          {webApps.map((app) => (
                            <option key={app.appId} value={app.appId}>
                              {app.displayName} ({app.appId})
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}

                    {webApps.length === 1 && (
                      <p className="data-note">
                        Web app: <strong>{webApps[0].displayName}</strong> ({webApps[0].appId})
                      </p>
                    )}

                    {webApps.length === 0 && (
                      <div className="form-alert form-alert-warning">
                        <KeyRound size={16} />
                        This project has no Firebase Web App. Creating one is an explicit action
                        and adds a resource to your Firebase project.
                      </div>
                    )}

                    {inspection.data.isCurrentProject && configSource !== "runtime" && (
                      <p className="data-note">
                        This project is already the build-time configuration. Connecting it stores
                        the same public config locally, so future deployments do not depend on
                        environment variables.
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="data-actions">
                {webApps.length === 0 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setError("");
                      setCreateOpen(true);
                    }}
                    disabled={Boolean(busy)}
                  >
                    <KeyRound size={16} />
                    Create Firebase Web App…
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleConnectProject}
                    disabled={
                      Boolean(busy) ||
                      webApps.length === 0 ||
                      (webApps.length > 1 && !selectedAppId) ||
                      (targetIsCurrent && configSource === "runtime" && !pendingChanges)
                    }
                  >
                    <Database size={16} />
                    {busy === "connect"
                      ? "Connecting…"
                      : targetIsCurrent
                        ? "Save this project configuration"
                        : "Connect this project"}
                  </button>
                )}

                {pendingChanges > 0 && !targetIsCurrent && (
                  <p className="data-note text-amber">
                    {pendingChanges} local change{pendingChanges === 1 ? "" : "s"} not uploaded yet.
                    Sync Now before switching so nothing lands in a different project.
                  </p>
                )}
              </div>

              {!targetIsCurrent && webApps.length > 0 && (
                <p className="data-note">
                  Switching projects changes the Firebase identity of this device: it gets a new
                  anonymous ID in the new project and must be enrolled there before data can sync.
                  Local data is never uploaded to the new project automatically.
                </p>
              )}
            </>
          )}

          <div className="detail-grid google-identity">
            <div>
              <span>Device ID (this project)</span>
              <strong className="sync-uid">{deviceId || "Not assigned yet"}</strong>
            </div>
            <div>
              <span>Workspace</span>
              <strong>{workspaceId}</strong>
            </div>
          </div>
        </>
      )}

      <div className="google-security-note">
        <LockKeyhole size={16} />
        <p>
          Google refresh tokens are stored only in an encrypted HttpOnly cookie on the server.
          The browser receives nothing but the public Firebase web configuration, and no Google
          password is ever requested.
        </p>
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a Firebase Web App?"
        subtitle={`Project: ${selectedProjectId}`}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreateApp}
              disabled={busy === "create"}
            >
              {busy === "create" ? "Creating…" : "Create web app"}
            </button>
          </>
        }
      >
        <p className="data-note">
          This registers a new Web App in your Firebase project. Nothing else is created or
          deleted. If the connected account granted read-only access, Google will ask for one
          additional permission first.
        </p>
        <Field label="Web app name" hint="1-30 characters, shown in Firebase Console.">
          <input
            type="text"
            value={appName}
            maxLength={30}
            onChange={(event) => setAppName(event.target.value)}
          />
        </Field>
      </Modal>

      <Modal
        open={switchOpen}
        onClose={() => setSwitchOpen(false)}
        title="Switch this device to another Firebase project?"
        subtitle={`${currentProjectId || "not configured"} → ${selectedProjectId}`}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setSwitchOpen(false)}>
              Keep current project
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSwitchOpen(false);
                doConnect();
              }}
              disabled={busy === "connect"}
            >
              Connect project
            </button>
          </>
        }
      >
        <ul className="plain-list">
          <li>Local medicines, sales and other records stay on this device and are not moved.</li>
          <li>This device gets a new anonymous Firebase ID in the new project.</li>
          <li>
            Data synchronization stays paused until an administrator enrolls this device in the
            new project.
          </li>
          <li>Existing pending changes were confirmed as cleared before this switch.</li>
        </ul>
      </Modal>
    </section>
  );
}
