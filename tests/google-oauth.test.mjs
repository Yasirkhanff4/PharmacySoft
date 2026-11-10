// Unit tests for the Google connection backend (no network required).
// Run with: npm run test:oauth

import test from "node:test";
import assert from "node:assert/strict";

process.env.OAUTH_SESSION_SECRET = "test-session-secret-that-is-long-enough-123456";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
process.env.APP_ORIGIN = "https://pharmacy.example.com";
process.env.FIREBASE_PROJECT_ID = "demo-pharmacy";

const session = await import("../api/_lib/session.js");
const oauth = await import("../api/_lib/oauth.js");
const auth = await import("../api/_lib/firebase-auth.js");
const management = await import("../api/_lib/firebase-management.js");
const validation = await import("../api/_lib/validation.js");
const { HttpError } = await import("../api/_lib/http.js");

const startHandler = (await import("../api/google/start.js")).default;
const callbackHandler = (await import("../api/google/callback.js")).default;
const sessionHandler = (await import("../api/google/session.js")).default;
const disconnectHandler = (await import("../api/google/disconnect.js")).default;
const projectsHandler = (await import("../api/google/projects.js")).default;

function mockReq({ method = "GET", url = "/", headers = {}, body } = {}) {
  const req = { method, url, headers, query: {} };
  if (body !== undefined) req.body = body;
  return req;
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writableEnded: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    end(chunk) {
      this.body = typeof chunk === "string" ? chunk : "";
      this.writableEnded = true;
    },
  };
}

async function call(handler, options) {
  const req = mockReq(options);
  const res = mockRes();
  await handler(req, res);
  let json;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    json = null;
  }
  return { res, json, setCookie: res.headers["set-cookie"] };
}

function cookieHeader(setCookie, name) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean);
  return values.find((value) => value.startsWith(`${name}=`)) || "";
}

/* ---------------------------- session sealing ---------------------------- */

test("session cookie round-trips and never exposes the refresh token in plain text", () => {
  const payload = session.createSession({
    email: "admin@example.com",
    sub: "123",
    scopes: ["openid", "email"],
    refreshToken: "1//refresh-token-value",
    accessToken: "ya29.access",
    accessExpiresAt: Date.now() + 60_000,
  });

  const token = session.seal(payload);
  assert.match(token, /^v1\./);
  assert.ok(!token.includes("refresh-token-value"));
  assert.ok(!token.includes("admin@example.com"));

  const restored = session.open(token);
  assert.equal(restored.email, "admin@example.com");
  assert.equal(restored.refreshToken, "1//refresh-token-value");
  assert.equal(restored.v, 1);
});

test("tampered session cookies are rejected", () => {
  const token = session.seal({ v: 1, email: "a@b.c", refreshToken: "r" });
  const parts = token.split(".");
  const ciphertext = Buffer.from(parts[3], "base64url");
  ciphertext[0] ^= 0xff;
  parts[3] = ciphertext.toString("base64url");

  assert.throws(
    () => session.open(parts.join(".")),
    (error) => error instanceof HttpError && error.status === 401 && error.code === "invalid_session"
  );
});

test("a cookie sealed with a different key is rejected", () => {
  const token = session.seal({ v: 1, email: "a@b.c", refreshToken: "r" });
  const original = process.env.OAUTH_SESSION_SECRET;
  process.env.OAUTH_SESSION_SECRET = "a-completely-different-secret-value-0987654321";
  try {
    assert.throws(() => session.open(token), /expired or was invalidated/);
  } finally {
    process.env.OAUTH_SESSION_SECRET = original;
  }
});

test("session cookies are HttpOnly, SameSite=Lax and Secure on https", () => {
  const req = mockReq({ headers: { host: "pharmacy.example.com", "x-forwarded-proto": "https" } });
  const value = session.sessionCookie(req, { v: 1, refreshToken: "r" }, "https://pharmacy.example.com");
  assert.match(value, /^pharmacy_google_session=/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Lax/);
  assert.match(value, /Secure/);
  assert.match(value, /Path=\//);
});

test("local http development does not set the Secure flag", () => {
  const req = mockReq({ headers: { host: "127.0.0.1:5173" } });
  const value = session.sessionCookie(req, { v: 1, refreshToken: "r" }, "http://127.0.0.1:5173");
  assert.doesNotMatch(value, /Secure/);
});

/* ------------------------------- OAuth flow ------------------------------ */

test("read-only intent never asks for broad Cloud Platform access", () => {
  const read = oauth.scopesFor("read");
  assert.ok(read.includes(oauth.SCOPE_FIREBASE_READONLY));
  assert.ok(!read.includes(oauth.SCOPE_FIREBASE_WRITE));
  assert.deepEqual(read.filter((scope) => scope === "openid"), ["openid"]);
});

test("write intent is the only way to request Cloud Platform scope", () => {
  const write = oauth.scopesFor("write");
  assert.ok(write.includes(oauth.SCOPE_FIREBASE_WRITE));
  assert.ok(oauth.canWriteFirebase(write));
  assert.ok(!oauth.canWriteFirebase(oauth.scopesFor("read")));
});

test("authorization URL carries state, PKCE S256, offline access and the right redirect", () => {
  const url = new URL(
    oauth.buildAuthorizationUrl({
      clientId: "client-1",
      origin: "https://pharmacy.example.com/",
      state: "state-abc",
      challenge: "challenge-xyz",
      intent: "read",
      loginHint: "admin@example.com",
    })
  );

  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(url.pathname, "/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-1");
  assert.equal(url.searchParams.get("state"), "state-abc");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-xyz");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  assert.match(url.searchParams.get("prompt"), /consent/);
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://pharmacy.example.com/api/google/callback"
  );
  assert.ok(url.searchParams.get("scope").includes("firebase.readonly"));
  assert.ok(!url.searchParams.get("scope").includes("cloud-platform"));
  assert.equal(url.searchParams.get("login_hint"), "admin@example.com");
  // No client secret may ever appear in a browser-visible URL.
  assert.ok(!url.toString().includes("test-client-secret"));
});

test("PKCE pairs are high entropy and the challenge is the S256 digest", async () => {
  const { verifier, challenge } = oauth.createPkcePair();
  assert.ok(verifier.length >= 43);
  const digest = await import("node:crypto").then((crypto) =>
    crypto.createHash("sha256").update(verifier).digest("base64url")
  );
  assert.equal(challenge, digest);
  assert.notEqual(oauth.createPkcePair().verifier, verifier);
});

test("state tokens are unique and sufficiently long", () => {
  const a = oauth.createStateToken();
  const b = oauth.createStateToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
});

/* --------------------------- Firebase ID tokens -------------------------- */

const claims = (overrides = {}) => ({
  aud: "demo-pharmacy",
  iss: "https://securetoken.google.com/demo-pharmacy",
  sub: "device-uid",
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000) - 10,
  auth_time: Math.floor(Date.now() / 1000) - 10,
  ...overrides,
});

test("valid Firebase claims are accepted", () => {
  assert.deepEqual(auth.validateFirebaseClaims(claims(), "demo-pharmacy"), []);
});

test("wrong audience (another project's token) is rejected", () => {
  const problems = auth.validateFirebaseClaims(claims({ aud: "someone-else" }), "demo-pharmacy");
  assert.ok(problems.includes("audience mismatch"));
});

test("expired and future-dated tokens are rejected", () => {
  const expired = auth.validateFirebaseClaims(
    claims({ exp: Math.floor(Date.now() / 1000) - 5 }),
    "demo-pharmacy"
  );
  assert.ok(expired.includes("token expired"));

  const future = auth.validateFirebaseClaims(
    claims({ iat: Math.floor(Date.now() / 1000) + 3600 }),
    "demo-pharmacy"
  );
  assert.ok(future.includes("issued in the future"));
});

test("tokens without a subject are rejected", () => {
  const problems = auth.validateFirebaseClaims(claims({ sub: "" }), "demo-pharmacy");
  assert.ok(problems.includes("subject missing"));
});

test("signed tokens with a bogus signature are rejected before any network trust", async () => {
  const fake = [
    Buffer.from(JSON.stringify({ alg: "RS256", kid: "not-a-real-key" })).toString("base64url"),
    Buffer.from(JSON.stringify(claims())).toString("base64url"),
    "signature",
  ].join(".");

  await assert.rejects(
    () => auth.verifyFirebaseIdToken(fake, "demo-pharmacy"),
    (error) => error instanceof HttpError && error.status === 401
  );
});

test("malformed tokens are rejected", async () => {
  await assert.rejects(
    () => auth.verifyFirebaseIdToken("not-a-jwt", "demo-pharmacy"),
    (error) => error instanceof HttpError && error.status === 401 && error.code === "invalid_token"
  );
});

test("member documents live at the workspace path the rules protect", () => {
  assert.equal(
    auth.memberDocUrl("demo-pharmacy", "main", "uid-1"),
    "https://firestore.googleapis.com/v1/projects/demo-pharmacy/databases/(default)/documents/pharmacies/main/members/uid-1"
  );
});

/* --------------------------- Management API ----------------------------- */

test("Firebase Management API URLs are built safely", () => {
  assert.match(management.projectsUrl(), /^https:\/\/firebase\.googleapis\.com\/v1beta1\/projects\?/);
  assert.equal(
    management.webAppsUrl("demo-pharmacy"),
    "https://firebase.googleapis.com/v1beta1/projects/demo-pharmacy/webApps?pageSize=100"
  );
  assert.equal(
    management.webAppConfigUrl("demo-pharmacy", "1:2:web:abc"),
    "https://firebase.googleapis.com/v1beta1/projects/demo-pharmacy/webApps/1%3A2%3Aweb%3Aabc/config"
  );
});

test("only public web configuration is returned", () => {
  const config = management.toPublicConfig({
    projectId: "demo-pharmacy",
    appId: "1:2:web:abc",
    apiKey: "AIza-demo",
    authDomain: "demo-pharmacy.firebaseapp.com",
    storageBucket: "demo-pharmacy.firebasestorage.app",
    messagingSenderId: "123",
    databaseURL: "https://demo.firebaseio.com",
  });

  assert.deepEqual(Object.keys(config).sort(), [
    "apiKey",
    "appId",
    "authDomain",
    "messagingSenderId",
    "projectId",
    "storageBucket",
  ]);
  assert.equal(config.apiKey, "AIza-demo");
  assert.ok(!("databaseURL" in config));
});

test("incomplete web configuration is rejected instead of half-initializing Firebase", () => {
  assert.throws(
    () => management.toPublicConfig({ projectId: "demo-pharmacy", apiKey: "AIza-demo" }),
    (error) => error instanceof HttpError && error.code === "incomplete_web_config"
  );
});

/* ------------------------------- validation ----------------------------- */

test("project, app and display name validation rejects hostile input", () => {
  assert.equal(validation.requireProjectId("pharmacysoft-ad19a"), "pharmacysoft-ad19a");
  assert.throws(() => validation.requireProjectId("../../etc/passwd"), /valid Firebase project/);
  assert.throws(() => validation.requireProjectId(""), /valid Firebase project/);

  assert.equal(validation.requireAppId("1:54762328463:web:abc123"), "1:54762328463:web:abc123");
  assert.throws(() => validation.requireAppId("../../x"), /valid Firebase Web App/);

  assert.equal(validation.requireDisplayName("  Pharmacy   Web  "), "Pharmacy Web");
  assert.throws(() => validation.requireDisplayName(""), /1-30 characters/);
});

/* ------------------------------ endpoints ------------------------------- */

test("start redirects to Google with a sealed state cookie", async () => {
  const { res, setCookie } = await call(startHandler, {
    url: "/api/google/start?origin=https://pharmacy.example.com",
    headers: { host: "pharmacy.example.com", "x-forwarded-proto": "https" },
  });

  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  assert.ok(!res.headers.location.includes("test-client-secret"));

  const stateCookie = cookieHeader(setCookie, session.STATE_COOKIE);
  assert.ok(stateCookie, "state cookie must be set");
  assert.match(stateCookie, /HttpOnly/);

  const sealed = decodeURIComponent(stateCookie.split(";")[0].split("=").slice(1).join("="));
  const stored = session.open(sealed);
  assert.equal(stored.origin, "https://pharmacy.example.com");
  assert.equal(stored.intent, "read");
  assert.ok(stored.verifier.length >= 43);

  const url = new URL(res.headers.location);
  assert.equal(url.searchParams.get("state"), stored.state);
});

test("start refuses to return to an origin that is not allowlisted", async () => {
  const { res, json } = await call(startHandler, {
    url: "/api/google/start?origin=https://evil.example.com",
    headers: { host: "pharmacy.example.com" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(json.error.code, "origin_not_allowed");
});

test("start refuses to request write scope without a target project", async () => {
  const { res, json } = await call(startHandler, {
    url: "/api/google/start?intent=write",
    headers: { host: "pharmacy.example.com", origin: "https://pharmacy.example.com" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(json.error.code, "project_required");
});

test("callback without a state cookie fails safely and clears state", async () => {
  const { res, setCookie } = await call(callbackHandler, {
    url: "/api/google/callback?code=abc&state=xyz",
    headers: { host: "pharmacy.example.com", "x-forwarded-proto": "https" },
  });

  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /^https:\/\/pharmacy\.example\.com\/settings\?google=error&reason=state/);
  assert.ok(!res.headers.location.includes("code="));
  assert.match(cookieHeader(setCookie, session.STATE_COOKIE), /Max-Age=0/);
});

test("a cancelled Google authorization is reported without touching the session", async () => {
  const { res } = await call(callbackHandler, {
    url: "/api/google/callback?error=access_denied",
    headers: { host: "pharmacy.example.com" },
  });

  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /google=error&reason=cancelled/);
});

test("endpoints reject devices without a Firebase identity", async () => {
  for (const [handler, options] of [
    [sessionHandler, { url: "/api/google/session" }],
    [projectsHandler, { url: "/api/google/projects" }],
    [disconnectHandler, { method: "POST", url: "/api/google/disconnect", body: {} }],
  ]) {
    const { res, json } = await call(handler, {
      ...options,
      headers: { host: "pharmacy.example.com", origin: "https://pharmacy.example.com" },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(json.error.code, "missing_device_token");
  }
});

test("disconnect requires a same-origin POST", async () => {
  const { res, json } = await call(disconnectHandler, {
    method: "POST",
    url: "/api/google/disconnect",
    headers: { host: "pharmacy.example.com", origin: "https://evil.example.com" },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(json.error.code, "origin_not_allowed");
});

test("wrong HTTP methods are rejected", async () => {
  const { res, json } = await call(startHandler, {
    method: "POST",
    url: "/api/google/start",
    headers: { host: "pharmacy.example.com" },
  });
  assert.equal(res.statusCode, 405);
  assert.equal(json.error.code, "method_not_allowed");
});

test("unconfigured deployments answer with a clear, secret-free 503", async () => {
  const saved = process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  try {
    const { res, json } = await call(startHandler, {
      url: "/api/google/start",
      headers: { host: "pharmacy.example.com" },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(json.error.code, "server_not_configured");
    assert.match(json.error.message, /GOOGLE_OAUTH_CLIENT_ID/);
    assert.ok(!json.error.message.includes("test-client-secret"));
  } finally {
    process.env.GOOGLE_OAUTH_CLIENT_ID = saved;
  }
});
