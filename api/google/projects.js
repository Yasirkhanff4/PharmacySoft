// GET /api/google/projects
// Lists Firebase projects the connected Google account can access.
// Requires an active administrator device in the current workspace.

import { assertSameOrigin, enforceMethod, guarded, requireServerConfig, sendJson } from "../_lib/http.js";
import { googleSession, requireAdmin } from "../_lib/guard.js";
import { listProjects } from "../_lib/firebase-management.js";

export default guarded(async (req, res) => {
  enforceMethod(req, ["GET"]);
  const config = requireServerConfig();
  assertSameOrigin(req, config.appOrigins);
  const admin = await requireAdmin(req);
  const { accessToken, session } = await googleSession(req, res);

  const { projects, truncated } = await listProjects(accessToken);

  sendJson(res, 200, {
    email: session.email,
    currentProjectId: config.firebaseProjectId,
    workspaceId: admin.workspaceId,
    projects,
    truncated,
  });
});
