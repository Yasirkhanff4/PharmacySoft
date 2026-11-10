// Endpoint guards: device identity + workspace role + encrypted Google session.

import { HttpError, bearerToken, serverConfig, requestUrl } from "./http.js";
import { readSession, sessionCookie } from "./session.js";
import { requireWorkspaceAdmin, verifyFirebaseIdToken, readMember } from "./firebase-auth.js";
import { accessTokenFor } from "./oauth.js";

/** Any enrolled member of the workspace (admin or staff). */
export async function requireDevice(req) {
  const { firebaseProjectId, workspaceId } = serverConfig();
  const idToken = bearerToken(req);
  if (!idToken) {
    throw new HttpError(401, "missing_device_token", "Sign in on this device first, then try again.");
  }

  const claims = await verifyFirebaseIdToken(idToken, firebaseProjectId);
  const member = await readMember({ projectId: firebaseProjectId, workspaceId, uid: claims.sub, idToken });

  if (!member || !member.active || member.pharmacyId !== workspaceId) {
    throw new HttpError(
      403,
      "device_not_authorized",
      `This device is not enrolled in pharmacies/${workspaceId}. Authorize it before managing the cloud connection.`
    );
  }

  return { uid: claims.sub, role: member.role, projectId: firebaseProjectId, workspaceId, idToken };
}

/** Active administrator device. Required for anything that can change the project. */
export async function requireAdmin(req) {
  const { firebaseProjectId, workspaceId } = serverConfig();
  return requireWorkspaceAdmin({
    idToken: bearerToken(req),
    projectId: firebaseProjectId,
    workspaceId,
  });
}

/** Reads the encrypted session cookie and returns a fresh Google access token. */
export async function googleSession(req, res) {
  const session = readSession(req);
  if (!session) {
    throw new HttpError(
      401,
      "google_not_connected",
      "No Google account is connected. Use Connect with Google first."
    );
  }

  const { accessToken, session: nextSession, refreshed } = await accessTokenFor(session);
  if (refreshed) {
    res.setHeader("Set-Cookie", sessionCookie(req, nextSession, requestUrl(req).origin));
  }
  return { session: nextSession, accessToken };
}

export function requireGoogleConnected(session) {
  if (!session?.refreshToken) {
    throw new HttpError(401, "google_not_connected", "Connect a Google account first.");
  }
  return session;
}
