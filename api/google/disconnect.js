// POST /api/google/disconnect
// Revokes the Google grant and clears the encrypted session cookie.
// Local Dexie data, the outbox and the current project selection are untouched.

import { assertSameOrigin, enforceMethod, guarded, requestUrl, requireServerConfig, sendJson } from "../_lib/http.js";
import { requireAdmin } from "../_lib/guard.js";
import { revokeToken } from "../_lib/oauth.js";
import { clearedSessionCookie, readSession, clearedStateCookie } from "../_lib/session.js";

export default guarded(async (req, res) => {
  enforceMethod(req, ["POST"]);
  const config = requireServerConfig();
  assertSameOrigin(req, config.appOrigins, { required: true });
  await requireAdmin(req);

  const origin = requestUrl(req).origin;
  const session = readSession(req);
  let revoked = false;

  if (session) {
    const access = await revokeToken(session.accessToken);
    const refresh = await revokeToken(session.refreshToken);
    revoked = access.revoked || refresh.revoked;
  }

  res.setHeader("Set-Cookie", [clearedSessionCookie(req, origin), clearedStateCookie(req, origin)]);
  sendJson(res, 200, {
    disconnected: true,
    revoked,
    message: revoked
      ? "Google access was revoked. Local pharmacy data is unchanged."
      : "The Google session was cleared locally. Revoke the app in your Google account if you want to remove the grant entirely.",
  });
});
