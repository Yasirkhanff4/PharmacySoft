import { useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { CalendarDays, LogOut, Menu, Plus } from "lucide-react";
import Sidebar from "./Sidebar";
import { NAV_SECTIONS } from "../lib/constants";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
import { useUI } from "../context/UIContext";

function findPageTitle(pathname) {
  if (pathname === "/") return "Dashboard";

  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.path === pathname) return item.name;
    }
  }

  return "PharmaCare";
}

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, roleLabel, logout, can } = useAuth();
  const settings = useSettings();
  const { toast, confirm } = useUI();

  const title = useMemo(() => findPageTitle(location.pathname), [location.pathname]);

  useEffect(() => {
    document.title = `${title} · ${settings.pharmacyName || "PharmaCare"}`;
  }, [title, settings.pharmacyName]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  const todayLabel = new Date().toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  async function handleLogout() {
    const accepted = await confirm({
      title: "Sign out?",
      message: "You will need your password to sign back in.",
      confirmLabel: "Sign out",
      tone: "danger",
    });

    if (accepted) {
      logout();
      toast.info("You have been signed out.", "Signed out");
    }
  }

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="topbar-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>

            <div className="topbar-title">
              <span className="topbar-eyebrow">Workspace</span>
              <h2>{title}</h2>
            </div>
          </div>

          <div className="topbar-right">
            <span className="topbar-date">
              <CalendarDays size={15} />
              {todayLabel}
            </span>

            {can("pos.use") && location.pathname !== "/pos" && (
              <button
                type="button"
                className="btn btn-primary btn-sm topbar-new-sale"
                onClick={() => navigate("/pos")}
              >
                <Plus size={15} />
                New Sale
              </button>
            )}

            <div className="topbar-user">
              <div className="topbar-avatar">
                {(user?.name || "U").charAt(0).toUpperCase()}
              </div>
              <div className="topbar-user-copy">
                <strong>{user?.name || "User"}</strong>
                <span>{roleLabel}</span>
              </div>
              <button
                type="button"
                className="btn-icon topbar-logout"
                title="Sign out"
                aria-label="Sign out"
                onClick={handleLogout}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>

        <main
          className={`app-content${location.pathname === "/" ? " app-content-dashboard" : ""}`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
