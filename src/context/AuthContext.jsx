/*
 * Local access control.
 *
 * IMPORTANT: This is an application-level lock for a single-browser, offline
 * desktop installation. It prevents casual access and enforces role-based UI
 * permissions, but it cannot protect IndexedDB from someone with direct access
 * to the browser profile or developer tools. For multi-user or networked
 * deployments, a trusted server-side authentication service is required.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { hasPermission, ROLES } from "../lib/constants";
import { normalizeKey, normalizeText } from "../lib/format";

const USERS_KEY = "pharmacyUsers";
const SESSION_KEY = "pharmacySession";
const LOCK_KEY = "pharmacyAuthLock";

const AuthContext = createContext(null);

function readUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Could not read local users:", error);
    return [];
  }
}

function writeUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function readSession() {
  try {
    const raw =
      sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(session, remember) {
  clearSessionStorage();
  const raw = JSON.stringify(session);

  if (remember) {
    localStorage.setItem(SESSION_KEY, raw);
    sessionStorage.removeItem(SESSION_KEY);
  } else {
    sessionStorage.setItem(SESSION_KEY, raw);
    localStorage.removeItem(SESSION_KEY);
  }
}

function clearSessionStorage() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

function readLock() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLock(value) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(value));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function validatePassword(password) {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return "";
}

function validateUsername(username) {
  if (!username) return "Username is required.";
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
    return "Username must be 3–32 characters and may use letters, numbers, dot, dash or underscore.";
  }
  return "";
}

function resolveSessionUser(session) {
  if (!session) return null;

  if (!session.expiresAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    clearSessionStorage();
    return null;
  }

  const matchingUser = readUsers().find((item) => item.id === session.userId);

  if (!matchingUser || matchingUser.active === false) {
    clearSessionStorage();
    return null;
  }

  return publicUser(matchingUser);
}

export function AuthProvider({ children }) {
  const [users, setUsers] = useState(() => readUsers());
  const [user, setUser] = useState(() => resolveSessionUser(readSession()));
  const [loading] = useState(false);
  const expiryTimer = useRef(null);

  const applySession = useCallback((session) => {
    const nextUser = resolveSessionUser(session);
    setUser(nextUser);
    return Boolean(nextUser);
  }, []);

  const scheduleExpiry = useCallback((session) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    if (!session?.expiresAt) return;

    const remaining = new Date(session.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      clearSessionStorage();
      expiryTimer.current = setTimeout(() => setUser(null), 0);
      return;
    }

    expiryTimer.current = setTimeout(() => {
      clearSessionStorage();
      setUser(null);
    }, Math.min(remaining, 2147483647));
  }, []);

  useEffect(() => {
    scheduleExpiry(readSession());

    const onStorage = (event) => {
      if (event.key === USERS_KEY || event.key === SESSION_KEY) {
        setUsers(readUsers());
        if (event.key === SESSION_KEY) applySession(readSession());
      }
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [applySession, scheduleExpiry]);

  const startSession = useCallback(
    (account, remember) => {
      const hours = remember ? 24 * 30 : 8;
      const session = {
        userId: account.id,
        role: account.role,
        name: account.name,
        username: account.username,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
        remember: Boolean(remember),
      };

      writeSession(session, remember);
      scheduleExpiry(session);
      setUser(publicUser(account));
      return session;
    },
    [scheduleExpiry]
  );

  const setupAdmin = useCallback(
    async ({ name, username, password }) => {
      if (readUsers().length > 0) {
        throw new Error("An administrator account already exists.");
      }

      const cleanName = normalizeText(name);
      const cleanUsername = normalizeText(username).toLowerCase();
      const nameError = !cleanName ? "Full name is required." : "";
      const usernameError = validateUsername(cleanUsername);
      const passwordError = validatePassword(password);

      if (nameError) throw new Error(nameError);
      if (usernameError) throw new Error(usernameError);
      if (passwordError) throw new Error(passwordError);

      const credential = await hashPassword(password);
      const now = new Date().toISOString();
      const account = {
        id: crypto.randomUUID(),
        name: cleanName,
        username: cleanUsername,
        role: "admin",
        active: true,
        ...credential,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      };

      const nextUsers = [account];
      writeUsers(nextUsers);
      setUsers(nextUsers);
      const session = startSession(account, true);
      return session;
    },
    [startSession]
  );

  const login = useCallback(
    async ({ username, password, remember = false }) => {
      const cleanUsername = normalizeText(username).toLowerCase();
      const lock = readLock();
      const lockEntry = lock[cleanUsername];

      if (lockEntry?.lockedUntil && new Date(lockEntry.lockedUntil).getTime() > Date.now()) {
        const seconds = Math.ceil(
          (new Date(lockEntry.lockedUntil).getTime() - Date.now()) / 1000
        );
        throw new Error(`Too many failed attempts. Try again in ${seconds} seconds.`);
      }

      const allUsers = readUsers();
      const account = allUsers.find(
        (item) => normalizeKey(item.username) === cleanUsername && item.active !== false
      );

      const verified =
        account && (await verifyPassword(password, account));

      if (!verified) {
        const attempts = (lockEntry?.attempts || 0) + 1;
        const nextLock = { ...lock };

        if (attempts >= 5) {
          nextLock[cleanUsername] = {
            attempts: 0,
            lockedUntil: new Date(Date.now() + 60 * 1000).toISOString(),
          };
        } else {
          nextLock[cleanUsername] = { attempts, lockedUntil: null };
        }

        writeLock(nextLock);
        throw new Error("Invalid username or password.");
      }

      const nextLock = { ...lock };
      delete nextLock[cleanUsername];
      writeLock(nextLock);

      const now = new Date().toISOString();
      const updatedUsers = allUsers.map((item) =>
        item.id === account.id ? { ...item, lastLoginAt: now } : item
      );
      writeUsers(updatedUsers);
      setUsers(updatedUsers);

      const session = startSession({ ...account, lastLoginAt: now }, remember);
      return session;
    },
    [startSession]
  );

  const logout = useCallback(() => {
    clearSessionStorage();
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    setUser(null);
  }, []);

  const refreshUsers = useCallback(() => {
    const next = readUsers();
    setUsers(next);
    return next;
  }, []);

  const createUser = useCallback(
    async ({ name, username, password, role }) => {
      const cleanName = normalizeText(name);
      const cleanUsername = normalizeText(username).toLowerCase();

      if (!cleanName) throw new Error("Full name is required.");
      if (!ROLES[role]) throw new Error("Please select a valid role.");

      const usernameError = validateUsername(cleanUsername);
      if (usernameError) throw new Error(usernameError);

      const passwordError = validatePassword(password);
      if (passwordError) throw new Error(passwordError);

      const allUsers = readUsers();

      if (allUsers.some((item) => normalizeKey(item.username) === cleanUsername)) {
        throw new Error("That username is already in use.");
      }

      const credential = await hashPassword(password);
      const now = new Date().toISOString();
      const account = {
        id: crypto.randomUUID(),
        name: cleanName,
        username: cleanUsername,
        role,
        active: true,
        ...credential,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      };

      const next = [...allUsers, account];
      writeUsers(next);
      setUsers(next);
      return publicUser(account);
    },
    []
  );

  const updateUser = useCallback(
    async (userId, updates) => {
      const allUsers = readUsers();
      const target = allUsers.find((item) => item.id === userId);

      if (!target) throw new Error("User not found.");

      const next = allUsers.map((item) => {
        if (item.id !== userId) return item;

        const updated = {
          ...item,
          name: updates.name !== undefined ? normalizeText(updates.name) : item.name,
          role: updates.role !== undefined ? updates.role : item.role,
          active: updates.active !== undefined ? Boolean(updates.active) : item.active,
          updatedAt: new Date().toISOString(),
        };

        if (!updated.name) throw new Error("Full name is required.");
        if (!ROLES[updated.role]) throw new Error("Invalid role.");

        return updated;
      });

      const admins = next.filter((item) => item.role === "admin" && item.active !== false);

      if (admins.length === 0) {
        throw new Error("At least one active administrator must remain.");
      }

      writeUsers(next);
      setUsers(next);
      refreshUsers();
      return publicUser(next.find((item) => item.id === userId));
    },
    [refreshUsers]
  );

  const resetUserPassword = useCallback(async (userId, password) => {
    const passwordError = validatePassword(password);
    if (passwordError) throw new Error(passwordError);

    const allUsers = readUsers();
    const credential = await hashPassword(password);
    const next = allUsers.map((item) =>
      item.id === userId
        ? {
            ...item,
            ...credential,
            updatedAt: new Date().toISOString(),
          }
        : item
    );

    writeUsers(next);
    setUsers(next);
    return true;
  }, []);

  const changePassword = useCallback(
    async (currentPassword, newPassword) => {
      if (!user) throw new Error("You are not signed in.");

      const allUsers = readUsers();
      const account = allUsers.find((item) => item.id === user.id);

      if (!account) throw new Error("Account not found.");

      const valid = await verifyPassword(currentPassword, account);
      if (!valid) throw new Error("Current password is incorrect.");

      const passwordError = validatePassword(newPassword);
      if (passwordError) throw new Error(passwordError);

      const credential = await hashPassword(newPassword);
      const next = allUsers.map((item) =>
        item.id === user.id
          ? { ...item, ...credential, updatedAt: new Date().toISOString() }
          : item
      );

      writeUsers(next);
      setUsers(next);
      return true;
    },
    [user]
  );

  const deleteUser = useCallback(
    (userId) => {
      if (userId === user?.id) {
        throw new Error("You cannot delete the account you are signed in with.");
      }

      const allUsers = readUsers();
      const next = allUsers.filter((item) => item.id !== userId);
      const admins = next.filter((item) => item.role === "admin" && item.active !== false);

      if (admins.length === 0) {
        throw new Error("At least one active administrator must remain.");
      }

      writeUsers(next);
      setUsers(next);
      return true;
    },
    [user]
  );

  const can = useCallback(
    (permission) => hasPermission(user?.role, permission),
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      users: users.map(publicUser),
      loading,
      needsSetup: !loading && readUsers().length === 0,
      role: user?.role || null,
      roleLabel: user?.role ? ROLES[user.role]?.label || user.role : "",
      permissions: user?.role ? ROLES[user.role] : [],
      can,
      hasPermission: can,
      setupAdmin,
      login,
      logout,
      createUser,
      updateUser,
      resetUserPassword,
      changePassword,
      deleteUser,
      refreshUsers,
    }),
    [
      user,
      users,
      loading,
      can,
      setupAdmin,
      login,
      logout,
      createUser,
      updateUser,
      resetUserPassword,
      changePassword,
      deleteUser,
      refreshUsers,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
