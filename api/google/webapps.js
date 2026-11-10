// GET  /api/google/webapps?projectId=...   list registered web apps
// POST /api/google/webapps                  create a web app (explicit confirm)
//
// Creation is the only Firebase write the app performs, needs the broader
// `cloud-platform` scope, and is never automatic.

import {
  HttpError,
  assertSameOrigin,
  enforceMethod,
  guarded,
  query,
  readJson,
  requireServerConfig,
  requestUrl,
  sendJson,
} from "../_lib/http.js";
import { googleSession, requireAdmin } from "../_lib/guard.js";
import { canWriteFirebase } from "../_lib/oauth.js";
import { createWebApp, listWebApps } from "../_lib/firebase-management.js";
import { requireDisplayName, requireProjectId } from "../_lib/validation.js";

export default guarded(async (req, res) => {
  const method = enforceMethod(req, ["GET", "POST"]);
  const config = requireServerConfig();
  assertSameOrigin(req, config.appOrigins, { required: method === "POST" });
  await requireAdmin(req);

  const { accessToken, session } = await googleSession(req, res);

  if (method === "GET") {
    const projectId = requireProjectId(query(req, "projectId"));
    const apps = await listWebApps(accessToken, projectId);
    sendJson(res, 200, { projectId, apps });
    return;
  }

  const body = await readJson(req);
  const projectId = requireProjectId(body.projectId);
  const displayName = requireDisplayName(body.displayName || "Pharmacy Web");

  if (body.confirm !== true) {
    throw new HttpError(
      400,
      "confirmation_required",
      "Creating a Firebase Web App changes your Firebase project. Confirm the action first."
    );
  }

  if (!canWriteFirebase(session.scopes)) {
    const params = new URLSearchParams({
      origin: requestUrl(req).origin,
      intent: "write",
      projectId,
      returnTo: "/settings",
    });
    throw new HttpError(
      403,
      "write_scope_required",
      "Creating a Firebase Web App needs one additional Google permission. Approve it once, then retry.",
      { details: { authorizationUrl: `/api/google/start?${params.toString()}` } }
    );
  }

  // Reuse a matching existing app instead of creating duplicates.
  const existing = await listWebApps(accessToken, projectId);
  const match = existing.find((app) => app.displayName === displayName);
  if (match) {
    sendJson(res, 200, { created: false, app: match, message: "A web app with this name already exists; reusing it." });
    return;
  }

  const { app } = await createWebApp(accessToken, projectId, displayName);
  sendJson(res, 201, { created: true, app, message: `Created Firebase Web App "${displayName}".` });
});
