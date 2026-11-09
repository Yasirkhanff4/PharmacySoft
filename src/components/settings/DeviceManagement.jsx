import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useCloud } from "../../context/CloudContext";
import { useUI } from "../../context/UIContext";
import { Badge, Field } from "../ui/primitives";
import { toDisplayDateTime } from "../../lib/format";

export default function DeviceManagement() {
  const {
    configured,
    deviceId,
    workspaceId,
    cloudUser,
    membership,
    online,
    refreshMembership,
    redeemEnrollmentCode,
    createEnrollmentCode,
    listDevices,
  } = useCloud();
  const { user } = useAuth();
  const { toast } = useUI();

  const [codeInput, setCodeInput] = useState("");
  const [enrollError, setEnrollError] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [issuedCode, setIssuedCode] = useState(null);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [devices, setDevices] = useState([]);
  const [deviceError, setDeviceError] = useState("");
  const [loadingDevices, setLoadingDevices] = useState(false);

  const authorized = membership.status === "authorized";
  const isCloudAdmin = authorized && membership.role === "admin";
  const isLocalAdmin = user?.role === "admin";
  const canIssueCodes = configured && isCloudAdmin && isLocalAdmin;

  const loadDevices = useCallback(async () => {
    if (!isCloudAdmin) return;

    setLoadingDevices(true);
    setDeviceError("");

    try {
      setDevices(await listDevices());
    } catch (error) {
      setDeviceError(error.message || "Could not load enrolled devices.");
    } finally {
      setLoadingDevices(false);
    }
  }, [isCloudAdmin, listDevices]);

  useEffect(() => {
    let active = true;

    if (!isCloudAdmin) {
      return undefined;
    }

    (async () => {
      try {
        const list = await listDevices();

        if (active) {
          setDevices(list);
          setDeviceError("");
        }
      } catch (error) {
        if (active) {
          setDeviceError(error.message || "Could not load enrolled devices.");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [isCloudAdmin, listDevices]);

  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`, "Copied");
    } catch {
      toast.error("Could not copy to the clipboard.", "Copy failed");
    }
  }

  async function handleIssueCode() {
    setIssueError("");
    setIssuedCode(null);
    setIssuing(true);

    try {
      const result = await createEnrollmentCode();
      setIssuedCode(result);
      toast.success("One-time enrollment code created.", "Code generated");
    } catch (error) {
      setIssueError(error.message || "Could not create an enrollment code.");
    } finally {
      setIssuing(false);
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

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Device Management</h2>
          <p>
            Authorize pharmacy devices. Anonymous Firebase sign-in identifies a device, but
            only devices with an active member record in <code>pharmacies/{workspaceId}</code>{" "}
            can reach pharmacy data.
          </p>
        </div>
        <div className="badge-stack">
          <Badge tone={authorized ? "green" : "amber"} dot>
            {authorized ? "Device authorized" : "Device not authorized"}
          </Badge>
          <Badge tone={online ? "green" : "neutral"} dot>
            {online ? "Online" : "Offline"}
          </Badge>
        </div>
      </div>

      {!configured && (
        <div className="form-alert form-alert-warning">
          Firebase is not configured, so device management is unavailable.
        </div>
      )}

      <div className="detail-grid">
        <div>
          <span>This device ID</span>
          <strong className="sync-uid">{deviceId || "Not assigned yet"}</strong>
        </div>
        <div>
          <span>Authorization</span>
          <strong className={authorized ? "" : "text-danger"}>
            {authorized ? `Authorized (${membership.role})` : "Not authorized"}
          </strong>
        </div>
        <div>
          <span>Workspace</span>
          <strong>{workspaceId || "main"}</strong>
        </div>
        <div>
          <span>Enrolled devices</span>
          <strong>{isCloudAdmin ? devices.length : "Admin only"}</strong>
        </div>
      </div>

      <div className="data-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => copyText(deviceId, "Device ID")}
          disabled={!deviceId}
        >
          <Copy size={16} />
          Copy Device ID
        </button>
        <button type="button" className="btn btn-secondary" onClick={refreshMembership}>
          <RefreshCw size={16} />
          Check Authorization
        </button>
      </div>

      {membership.status === "error" && (
        <div className="form-alert form-alert-error">
          <AlertTriangle size={16} />
          {membership.error || "Could not verify this device's authorization."}
        </div>
      )}

      {configured && cloudUser && !authorized && membership.status !== "error" && (
        <div className="settings-stack">
          <div className="form-alert form-alert-warning">
            This device is not enrolled.
            {membership.reason ? ` ${membership.reason}` : ""} Enter a one-time code
            generated on an administrator device, or ask an administrator to add the device ID
            above to <code>pharmacies/{workspaceId}/members</code> in Firebase Console.
          </div>

          <form onSubmit={handleEnroll} className="form-grid">
            <Field label="Enrollment Code" required>
              <input
                type="text"
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                placeholder="ABCD-EFGH"
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
        </div>
      )}

      {canIssueCodes && (
        <div className="settings-stack">
          <div className="card-head">
            <div>
              <h3>Enrollment Codes</h3>
              <p>
                Codes are single-use, unique, and expire after 15 minutes. Give the code to the
                person setting up the new device.
              </p>
            </div>
            <KeyRound size={18} />
          </div>

          <div className="data-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleIssueCode}
              disabled={issuing}
            >
              <KeyRound size={16} />
              {issuing ? "Generating…" : "Generate Enrollment Code"}
            </button>
          </div>

          {issueError && (
            <div className="form-alert form-alert-error">
              <AlertTriangle size={16} />
              {issueError}
            </div>
          )}

          {issuedCode && (
            <div className="form-alert">
              <div className="sync-inline-status">
                <strong className="sync-uid">{issuedCode.code}</strong>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => copyText(issuedCode.code, "Enrollment code")}
                >
                  <Copy size={15} />
                  Copy Code
                </button>
              </div>
              <p className="data-note">
                Expires {toDisplayDateTime(issuedCode.expiresAt)} (15 minutes). It can be used
                once and is not shown again after you leave this page.
              </p>
            </div>
          )}

          <div className="detail-grid">
            <div>
              <span>Enrolled devices</span>
              <strong>{devices.length}</strong>
            </div>
            <div>
              <span>Enrollment role</span>
              <strong>staff</strong>
            </div>
          </div>

          <div className="data-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={loadDevices}
              disabled={loadingDevices}
            >
              <RefreshCw size={15} />
              {loadingDevices ? "Refreshing…" : "Refresh Devices"}
            </button>
          </div>

          {deviceError && (
            <div className="form-alert form-alert-error">
              <AlertTriangle size={16} />
              {deviceError}
            </div>
          )}

          {devices.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Enrolled</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id}>
                      <td>
                        <div className="cell-with-avatar">
                          <span className="avatar-circle">
                            <Smartphone size={15} />
                          </span>
                          <div className="cell-primary">
                            <strong className="sync-uid">{device.uid}</strong>
                            <span>{device.id === deviceId ? "This device" : "Enrolled device"}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge tone={device.role === "admin" ? "blue" : "neutral"}>
                          {device.role}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={device.active ? "green" : "red"} dot>
                          {device.active ? "Active" : "Disabled"}
                        </Badge>
                      </td>
                      <td>{toDisplayDateTime(device.enrolledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {devices.length === 0 && !loadingDevices && (
            <p className="data-note">
              <Users size={15} /> No member documents were returned for this workspace.
            </p>
          )}
        </div>
      )}

      {authorized && !canIssueCodes && (
        <p className="data-note">
          Only an administrator device can generate enrollment codes. Ask an administrator to
          create a code, or add the device ID in Firebase Console.
        </p>
      )}
    </section>
  );
}
