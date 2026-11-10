// GET /api/google/config?projectId=...&appId=...
// Returns only the public Firebase Web App configuration for a project.
// Nothing here is secret: these are the same values Firebase Console shows.

import { HttpError, assertSameOrigin, enforceMethod, guarded, query, requireServerConfig, sendJson } from "../_lib/http.js";
import { googleSession, requireAdmin } from "../_lib/guard.js";
import { getWebAppConfig, listWebApps } from "../_lib/firebase-management.js";
import { requireAppId, requireProjectId } from "../_lib/validation.js";

export default guarded(async (req, res) => {
  enforceMethod(req, ["GET"]);
  const config = requireServerConfig();
  assertSameOrigin(req, config.appOrigins);
  await requireAdmin(req);

  const projectId = requireProjectId(query(req, "projectId"));
  let appId = query(req, "appId");

  const { accessToken } = await googleSession(req, res);

  if (!appId) {
    const apps = await listWebApps(accessToken, projectId);
    if (!apps.length) {
      throw new HttpError(
        409,
        "web_app_missing",
        "This project has no Firebase Web App yet. Create one explicitly before connecting."
      );
    }
    if (apps.length > 1) {
      throw new HttpError(
        409,
        "web_app_ambiguous",
        "This project has more than one Firebase Web App. Choose which one the pharmacy should use."
      );
    }
    appId = apps[0].appId;
  }

  requireAppId(appId);
  const webConfig = await getWebAppConfig(accessToken, projectId, appId);

  sendJson(res, 200, {
    projectId,
    appId,
    webConfig,
    workspaceId: config.workspaceId,
    // Never return tokens: the response is public Firebase config only.
  });
});
