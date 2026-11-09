import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { CloudProvider } from "./context/CloudContext";
import { UIProvider } from "./context/UIContext";
import AppLayout from "./components/AppLayout";
import AuthScreen from "./pages/AuthScreen";
import Dashboard from "./pages/Dashboard";
import Medicines from "./pages/Medicines";
import POS from "./pages/POS";
import SalesHistory from "./pages/SalesHistory";
import Suppliers from "./pages/Suppliers";
import Purchases from "./pages/Purchases";
import Customers from "./pages/Customers";
import Expenses from "./pages/Expenses";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";

import "./App.css";

function AppLoading() {
  return (
    <div className="app-loading">
      <span className="spinner" />
      <p>Loading PharmaCare…</p>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="page">
      <div className="access-denied">
        <div className="access-denied-icon">
          <ShieldAlert size={30} />
        </div>
        <h1>Access restricted</h1>
        <p>
          Your role does not include permission for this module. Ask an administrator to review
          your account permissions in Settings → Users &amp; Roles.
        </p>
        <a className="btn btn-primary" href="/">
          Return to dashboard
        </a>
      </div>
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <AppLoading />;

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search || ""}` }}
      />
    );
  }

  return children;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <AppLoading />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function RequirePermission({ permission, children }) {
  const { can } = useAuth();
  if (!can(permission)) return <AccessDenied />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <AuthScreen mode="login" />
          </PublicOnly>
        }
      />
      <Route
        path="/setup"
        element={
          <PublicOnly>
            <AuthScreen mode="setup" />
          </PublicOnly>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route
          path="/"
          element={
            <RequirePermission permission="dashboard.view">
              <Dashboard />
            </RequirePermission>
          }
        />
        <Route
          path="/medicines"
          element={
            <RequirePermission permission="medicines.view">
              <Medicines />
            </RequirePermission>
          }
        />
        <Route
          path="/pos"
          element={
            <RequirePermission permission="pos.use">
              <POS />
            </RequirePermission>
          }
        />
        <Route
          path="/sales-history"
          element={
            <RequirePermission permission="sales.view">
              <SalesHistory />
            </RequirePermission>
          }
        />
        <Route
          path="/purchases"
          element={
            <RequirePermission permission="purchases.view">
              <Purchases />
            </RequirePermission>
          }
        />
        <Route
          path="/suppliers"
          element={
            <RequirePermission permission="suppliers.view">
              <Suppliers />
            </RequirePermission>
          }
        />
        <Route
          path="/customers"
          element={
            <RequirePermission permission="customers.view">
              <Customers />
            </RequirePermission>
          }
        />
        <Route
          path="/expenses"
          element={
            <RequirePermission permission="expenses.view">
              <Expenses />
            </RequirePermission>
          }
        />
        <Route
          path="/reports"
          element={
            <RequirePermission permission="reports.view">
              <Reports />
            </RequirePermission>
          }
        />
        <Route
          path="/settings"
          element={
            <RequirePermission permission="settings.view">
              <Settings />
            </RequirePermission>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CloudProvider>
        <UIProvider>
          <AppRoutes />
        </UIProvider>
      </CloudProvider>
    </AuthProvider>
  );
}
