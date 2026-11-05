import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  XCircle,
} from "lucide-react";

const UIContext = createContext(null);

let toastSequence = 0;

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const confirmResolver = useRef(null);

  const dismissToast = useCallback((id) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback(
    (type, message, title) => {
      const id = ++toastSequence;
      const toast = {
        id,
        type,
        title: title || (type === "success" ? "Success" : type === "error" ? "Something went wrong" : "Notice"),
        message,
      };

      setToasts((previous) => [...previous, toast].slice(-4));
      window.setTimeout(() => dismissToast(id), type === "error" ? 6500 : 4200);
      return id;
    },
    [dismissToast]
  );

  const toast = useMemo(
    () => ({
      success: (message, title) => pushToast("success", message, title),
      error: (message, title) => pushToast("error", message, title),
      info: (message, title) => pushToast("info", message, title),
      warning: (message, title) => pushToast("warning", message, title),
    }),
    [pushToast]
  );

  const confirm = useCallback((options) => {
    if (confirmResolver.current) {
      confirmResolver.current(false);
      confirmResolver.current = null;
    }

    setConfirmState({
      title: "Please confirm",
      message: "Are you sure?",
      confirmLabel: "Confirm",
      cancelLabel: "Cancel",
      tone: "danger",
      ...options,
    });

    return new Promise((resolve) => {
      confirmResolver.current = resolve;
    });
  }, []);

  const closeConfirm = useCallback((result) => {
    setConfirmState(null);
    if (confirmResolver.current) {
      confirmResolver.current(result);
      confirmResolver.current = null;
    }
  }, []);

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <UIContext.Provider value={value}>
      {children}

      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((item) => {
          const Icon =
            item.type === "success"
              ? CheckCircle2
              : item.type === "error"
                ? XCircle
                : item.type === "warning"
                  ? AlertTriangle
                  : Info;

          return (
            <div className={`toast toast-${item.type}`} key={item.id} role="status">
              <Icon size={19} className="toast-icon" />
              <div className="toast-content">
                <strong>{item.title}</strong>
                <p>{item.message}</p>
              </div>
              <button
                type="button"
                className="toast-close"
                onClick={() => dismissToast(item.id)}
                aria-label="Dismiss notification"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>

      {confirmState && (
        <div
          className="modal-overlay confirm-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConfirm(false);
          }}
        >
          <div
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-message"
          >
            <div className={`confirm-icon confirm-icon-${confirmState.tone || "danger"}`}>
              <AlertTriangle size={22} />
            </div>

            <div className="confirm-copy">
              <h2 id="confirm-title">{confirmState.title}</h2>
              <p id="confirm-message">{confirmState.message}</p>
            </div>

            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => closeConfirm(false)}
              >
                {confirmState.cancelLabel}
              </button>
              <button
                type="button"
                className={`btn ${
                  confirmState.tone === "primary" ? "btn-primary" : "btn-danger"
                }`}
                onClick={() => closeConfirm(true)}
                autoFocus
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </UIContext.Provider>
  );
}

export function useUI() {
  const context = useContext(UIContext);
  if (!context) throw new Error("useUI must be used inside UIProvider");
  return context;
}
