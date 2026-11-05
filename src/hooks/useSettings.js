import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  LOGO_KEY,
  SETTINGS_KEY,
} from "../lib/constants";

export const SETTINGS_EVENT = "pharmacare:settings-updated";
export const LOGO_EVENT = "pharmacare:logo-updated";

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (error) {
    console.error("Could not load pharmacy settings:", error);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  window.dispatchEvent(new Event(SETTINGS_EVENT));
  return merged;
}

export function loadLogo() {
  try {
    return localStorage.getItem(LOGO_KEY) || "";
  } catch {
    return "";
  }
}

export function saveLogo(dataUrl) {
  if (dataUrl) {
    localStorage.setItem(LOGO_KEY, dataUrl);
  } else {
    localStorage.removeItem(LOGO_KEY);
  }
  window.dispatchEvent(new Event(LOGO_EVENT));
}

export function useSettings() {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    const refresh = () => setSettings(loadSettings());
    window.addEventListener(SETTINGS_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return settings;
}

export function useLogo() {
  const [logo, setLogo] = useState(loadLogo);

  useEffect(() => {
    const refresh = () => setLogo(loadLogo());
    window.addEventListener(LOGO_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LOGO_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return logo;
}
