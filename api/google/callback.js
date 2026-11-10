// GET /api/google/callback
// Google redirects here with `code` + `state`. We verify state against the
// HttpOnly cookie, exchange the code server-side, and store only an encrypted
// refresh-token session cookie. The browser is then sent back to the app.

import {
  HttpError,
  enforceMethod,
  guarded,
  query,
  redirect,
  requestUrl,
  requireServerConfig,
} from "../_lib/http.js";
import { exchangeAuthorizationCode, fetchUserInfo } from "../_lib/oauth.js";
import { clearedStateCookie, createSession, readState, sessionCookie } from "../_lib/session.js";

export default guarded(async (req, res) => {
  enforceMethod(req, ["GET"]);
  const config = requireServerConfig();
  const fallbackOrigin = config.appOrigins[0] || requestUrl(req).origin;

  // The state cookie tells us which app origin started this attempt, so a
  // cancelled or failed flow still returns to the right place.
  let stored;
  try {
    stored = readState(req);
  } catch {
    stored = null;
  }
  const origin = stored?.origin || fallbackOrigin;
  const clearState = clearedStateCookie(req, origin);

  const googleError = query(req, "error", "");
  if (googleError) {
    const reason = googleError === "access_denied" ? "cancelled" : "google_error";
    const message =
      googleError === "access_denied"
        ? "Google authorization was cancelled. Nothing was changed."
        : `Google returned an authorization error (${googleError}).`;
    redirect(res, `${origin}/settings?google=error&reason=${reason}&message=${encodeURIComponent(message)}`, {
      "Set-Cookie": clearState,
    });
    return;
  }

  const code = query(req, "code", "");
  const state = query(req, "state", "");
  if (!code || !state) {
    redirect(
      res,
      `${origin}/settings?google=error&reason=missing_code&message=${encodeURIComponent(
        "Google did not return an authorization code."
      )}`,
      { "Set-Cookie": clearState }
    );
    return;
  }

  // CSRF: the state must match the cookie set by /api/google/start, and the
  // PKCE verifier must belong to the same attempt.
  if (!stored) {
    redirect(
      res,
      `${origin}/settings?google=error&reason=state&message=${encodeURIComponent(
        "The authorization attempt expired or its cookie was blocked. Start again."
      )}`,
      { "Set-Cookie": clearState }
    );
    return;
  }
  if (stored.state !== state || !stored.verifier) {
    redirect(
      res,
      `${origin}/settings?google=error&reason=state&message=${encodeURIComponent(
        "The authorization response did not match this browser session. Start again."
      )}`,
      { "Set-Cookie": clearState }
    );
    return;
  }

  let tokens;
  let profile;
  try {
    tokens = await exchangeAuthorizationCode({
      code,
      verifier: stored.verifier,
      origin: stored.origin || origin,
    });
    if (!tokens.refreshToken) {
      throw new HttpError(
        400,
        "no_refresh_token",
        "Google did not return a refresh token. Remove this app from your Google account permissions and connect again."
      );
    }
    profile = await fetchUserInfo(tokens.accessToken);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "The Google authorization could not be completed.";
    const reason = error instanceof HttpError ? error.code : "exchange_failed";
    redirect(
      res,
      `${origin}/settings?google=error&reason=${encodeURIComponent(reason)}&message=${encodeURIComponent(message)}`,
      { "Set-Cookie": clearState }
    );
    return;
  }

  const session = createSession({
    email: profile.email,
    sub: profile.sub,
    scopes: tokens.scope ? tokens.scope.split(" ").filter(Boolean) : [],
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessExpiresAt: Date.now() + Math.max(60, tokens.expiresIn - 60) * 1000,
    projectId: stored.linkProjectId || "",
  });

  redirect(
    res,
    `${origin}${stored.returnTo || "/settings"}?google=connected&intent=${encodeURIComponent(stored.intent || "read")}`,
    {
      // Replace the session and drop the one-time state cookie.
      "Set-Cookie": [sessionCookie(req, session, origin), clearedStateCookie(req, origin)],
      Vary: "Cookie",
    }
  );
});
