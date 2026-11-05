import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LockKeyhole, Pill, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useUI } from "../context/UIContext";
import { useLogo, useSettings } from "../hooks/useSettings";
import { Field } from "../components/ui/primitives";

export default function AuthScreen({ mode = "login" }) {
  const { login, setupAdmin, needsSetup } = useAuth();
  const { toast } = useUI();
  const settings = useSettings();
  const logo = useLogo();
  const navigate = useNavigate();
  const location = useLocation();

  const isSetup = mode === "setup" || needsSetup;

  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    confirmPassword: "",
    remember: true,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = `${isSetup ? "Create Administrator" : "Sign In"} · ${
      settings.pharmacyName || "PharmaCare"
    }`;
  }, [isSetup, settings.pharmacyName]);

  function update(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (isSetup) {
      if (!form.name.trim()) return setError("Please enter the administrator's full name.");
      if (!form.username.trim()) return setError("Please choose a username.");
      if (form.password.length < 8) return setError("Password must be at least 8 characters.");
      if (!/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
        return setError("Password must contain at least one letter and one number.");
      }
      if (form.password !== form.confirmPassword) {
        return setError("Passwords do not match.");
      }
    } else if (!form.username.trim() || !form.password) {
      return setError("Enter your username and password.");
    }

    setSubmitting(true);

    try {
      if (isSetup) {
        await setupAdmin({
          name: form.name,
          username: form.username,
          password: form.password,
        });
        toast.success("Administrator account created. Welcome to PharmaCare.", "Setup complete");
      } else {
        await login({
          username: form.username,
          password: form.password,
          remember: form.remember,
        });
        toast.success("Welcome back.", "Signed in");
      }

      const target = location.state?.from || "/";
      navigate(target, { replace: true });
    } catch (loginError) {
      setError(loginError.message || "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <section className="auth-brand-panel">
        <div className="auth-brand-top">
          <div className="auth-logo">
            {logo ? <img src={logo} alt="" /> : <Pill size={26} />}
          </div>
          <div>
            <h1>{settings.pharmacyName || "PharmaCare"}</h1>
            <p>Professional Pharmacy Management</p>
          </div>
        </div>

        <div className="auth-brand-content">
          <span className="eyebrow">SECURE LOCAL ACCESS</span>
          <h2>Run your pharmacy with confidence.</h2>
          <p>
            Inventory, point of sale, purchasing, customers, expenses and financial
            reporting — all in one reliable workspace.
          </p>

          <div className="auth-feature-list">
            <div>
              <ShieldCheck size={18} />
              <span>Role-based access for administrators, pharmacists and cashiers</span>
            </div>
            <div>
              <LockKeyhole size={18} />
              <span>Passwords are stored as salted PBKDF2 hashes, never as plain text</span>
            </div>
            <div>
              <UserRound size={18} />
              <span>Offline-first data stored safely in your browser's IndexedDB</span>
            </div>
          </div>
        </div>

        <p className="auth-brand-foot">
          PharmaCare is a local-first application. Back up your database regularly from
          Settings → Data Protection.
        </p>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-card">
          <div className="auth-form-heading">
            <span className="eyebrow">{isSetup ? "FIRST-TIME SETUP" : "WELCOME BACK"}</span>
            <h2>{isSetup ? "Create your administrator account" : "Sign in to your workspace"}</h2>
            <p>
              {isSetup
                ? "This first account will have full administrative access. You can add staff accounts later."
                : "Enter your local PharmaCare credentials to continue."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {isSetup && (
              <Field label="Full Name" required>
                <input
                  type="text"
                  value={form.name}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="e.g. Dr. Ahmed Khan"
                  autoComplete="name"
                  autoFocus
                />
              </Field>
            )}

            <Field label="Username" required>
              <input
                type="text"
                value={form.username}
                onChange={(event) => update("username", event.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                autoFocus={!isSetup}
              />
            </Field>

            <Field label="Password" required>
              <div className="password-control">
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(event) => update("password", event.target.value)}
                  placeholder={isSetup ? "At least 8 characters" : "Enter password"}
                  autoComplete={isSetup ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="password-reveal"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </Field>

            {isSetup && (
              <Field label="Confirm Password" required>
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.confirmPassword}
                  onChange={(event) => update("confirmPassword", event.target.value)}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                />
              </Field>
            )}

            {!isSetup && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.remember}
                  onChange={(event) => update("remember", event.target.checked)}
                />
                <span>Keep me signed in on this device for 30 days</span>
              </label>
            )}

            {error && <div className="form-alert form-alert-error">{error}</div>}

            <button
              type="submit"
              className="btn btn-primary btn-block btn-lg"
              disabled={submitting}
            >
              {submitting
                ? "Please wait…"
                : isSetup
                  ? "Create Administrator Account"
                  : "Sign In"}
            </button>
          </form>

          <div className="auth-note">
            <LockKeyhole size={15} />
            <p>
              Local access control limits casual access to this browser profile. It does
              not encrypt IndexedDB. See the security notes in Settings for details.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
