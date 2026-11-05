import { NavLink } from "react-router-dom";
import {
  ChartNoAxesCombined,
  History,
  LayoutDashboard,
  Package,
  Pill,
  Receipt,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  X,
  ShieldCheck,
  Database,
} from "lucide-react";
import { APP_NAME, APP_VERSION, NAV_SECTIONS } from "../lib/constants";
import { useAuth } from "../context/AuthContext";
import { useLogo, useSettings } from "../hooks/useSettings";

const ICONS = {
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  sales: History,
  purchases: Package,
  medicines: Pill,
  suppliers: Truck,
  customers: Users,
  expenses: Receipt,
  reports: ChartNoAxesCombined,
  settings: Settings,
};

export default function Sidebar({ open, onClose }) {
  const { can, user, roleLabel, logout } = useAuth();
  const settings = useSettings();
  const logo = useLogo();

  return (
    <>
      <div
        className={`sidebar-backdrop ${open ? "show" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            {logo ? <img src={logo} alt="" /> : <Pill size={22} />}
          </div>

          <div className="sidebar-brand-copy">
            <h1>{settings.pharmacyName || APP_NAME}</h1>
            <span>Pharmacy Management</span>
          </div>

          <button
            type="button"
            className="sidebar-close"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => can(item.permission));
            if (items.length === 0) return null;

            return (
              <div className="sidebar-group" key={section.label}>
                <span className="sidebar-group-label">{section.label}</span>

                {items.map((item) => {
                  const Icon = ICONS[item.icon] || LayoutDashboard;

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === "/"}
                      className={({ isActive }) =>
                        `sidebar-link ${isActive ? "active" : ""}`
                      }
                      onClick={onClose}
                    >
                      <Icon size={18} />
                      <span>{item.name}</span>
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <Database size={14} />
            <span>Local database</span>
            <i />
          </div>

          <div className="sidebar-user">
            <div className="sidebar-avatar">
              {(user?.name || "U").charAt(0).toUpperCase()}
            </div>
            <div className="sidebar-user-copy">
              <strong>{user?.name || "User"}</strong>
              <span>
                <ShieldCheck size={12} /> {roleLabel}
              </span>
            </div>
            <button
              type="button"
              className="sidebar-logout"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
            >
              <X size={16} />
            </button>
          </div>

          <small className="sidebar-version">PharmaCare v{APP_VERSION}</small>
        </div>
      </aside>
    </>
  );
}
