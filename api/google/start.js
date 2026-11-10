// GET /api/google/start
// Begins the authorization-code + PKCE flow. The browser is redirected to
// Google with a random state; the matching verifier is kept in a short-lived
// HttpOnly cookie so this endpoint stays stateless.

import {
  HttpError,
  assertSameOrigin,
  enforceMethod,
  guarded,
  query,
  redirect,
  requireServerConfig,
  resolveAppOrigin,
} from "../_lib/http.js";
import { buildAuthorizationUrl, createPkcePair, createStateToken } from "../_lib/oauth.js";
import { createState, stateCookie } from "../_lib/session.js";

export default guarded(async (req, res) => {
  enforceMethod(req, ["GET"]);
  const config = requireServerConfig();
  assertSameOrigin(req, config.appOrigins);

  const origin = resolveAppOrigin(req, query(req, "origin"), config.appOrigins);
  const intent = query(req, "intent") === "write" ? "write" : "read";
  const returnTo = query(req, "returnTo", "/settings");
  const linkProjectId = query(req, "projectId", "");

  if (intent === "write" && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(linkProjectId || "")) {
    throw new HttpError(
      400,
      "project_required",
      "Creating a web app requires an explicit project selection first."
    );
  }

  const state = createStateToken();
  const { verifier, challenge } = createPkcePair();

  const authorizationUrl = buildAuthorizationUrl({
    clientId: config.clientId,
    origin,
    state,
    challenge,
    intent,
    loginHint: query(req, "loginHint", ""),
    projectId: linkProjectId,
  });

  const cookie = stateCookie(
    req,
    createState({ state, verifier, origin, intent, returnTo, linkProjectId }),
    origin
  );

  // `Vary: Cookie` keeps intermediaries from caching a stateful redirect.
  redirect(res, authorizationUrl, { "Set-Cookie": cookie, Vary: "Cookie" });
});
