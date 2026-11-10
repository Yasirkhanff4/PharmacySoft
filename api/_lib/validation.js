// Input validation shared by the Google endpoints.

import { HttpError } from "./http.js";

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const APP_ID = /^[0-9]{1,20}:[0-9]{1,20}:(web|android|ios):[A-Za-z0-9_-]{4,200}$/;

export function requireProjectId(value) {
  const projectId = String(value || "").trim();
  if (!PROJECT_ID.test(projectId)) {
    throw new HttpError(400, "invalid_project_id", "Select a valid Firebase project ID.");
  }
  return projectId;
}

export function requireAppId(value) {
  const appId = String(value || "").trim();
  if (!APP_ID.test(appId)) {
    throw new HttpError(400, "invalid_app_id", "Select a valid Firebase Web App.");
  }
  return appId;
}

export function requireDisplayName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 30) {
    throw new HttpError(400, "invalid_display_name", "The web app name must be 1-30 characters.");
  }
  return name;
}
