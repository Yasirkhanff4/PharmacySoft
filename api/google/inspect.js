// GET /api/google/inspect?projectId=...
// Read-only readiness report for a project: web app, Firestore database and
// the actually published security rules (the cause of the earlier outage).

import { assertSameOrigin, enforceMethod, guarded, query, requireServerConfig, sendJson } from "../_lib/http.js";
import { googleSession, requireAdmin } from "../_lib/guard.js";
import { inspectProject } from "../_lib/firebase-management.js";
import { requireProjectId } from "../_lib/validation.js";

export default guarded(async (req, res) => {
  enforceMethod(req, ["GET"]);
  const config = requireServerConfig();
  assertSameOrigin(req, config.appOrigins);
  await requireAdmin(req);

  const projectId = requireProjectId(query(req, "projectId"));
  const { accessToken } = await googleSession(req, res);
  const report = await inspectProject(accessToken, projectId);

  sendJson(res, 200, {
    ...report,
    currentProjectId: config.firebaseProjectId,
    workspaceId: config.workspaceId,
    isCurrentProject: projectId === config.firebaseProjectId,
  });
});
