// GET /api/google/session
// Returns what the connected Google account is allowed to do. Never returns
// tokens, client secrets or raw Google responses.

import { HttpError, assertSameOrigin, enforceMethod, guarded, requestUrl, requireServerConfig, sendJson } from "../_lib/http.js";
import { googleSession, requireAdmin } from "../_lib/guard.js";
import { canWriteFirebase } from "../_lib/oauth.js";
import { readSession } from "../_lib/session.js";

export default guarded(async (req, res) => {
  enforceMethod(req, ["GET"]);
  const config = requireServerConfig();
  assertSameOrigin(req, config.appOrigins);
  await requireAdmin(req);

  let session;
  try {
    ({ session } = await googleSession(req, res));
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      // The cookie may still be readable while the Google grant is gone. Tell
      // the UI which account needs reconnecting instead of silently hiding it.
      const email = (() => {
        try {
          return readSession(req)?.email || "";
        } catch {
          return "";
        }
      })();
      sendJson(res, 200, {
        connected: false,
        reason: error.code,
        reconnectRequired: Boolean(email),
        email,
      });
      return;
    }
    throw error;
  }

  sendJson(res, 200, {
    connected: true,
    email: session.email,
    scopes: session.scopes,
    canWriteFirebase: canWriteFirebase(session.scopes),
    linkedProjectId: session.projectId || "",
    connectedAt: session.createdAt ? new Date(session.createdAt).toISOString() : null,
    origin: requestUrl(req).origin,
  });
});
