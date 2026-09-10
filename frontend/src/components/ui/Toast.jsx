import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon.jsx";

// Transient confirmation for background work — "Balances synced", "Ledger
// updated". These used to be inline text that pushed the layout around; a
// toast reports the outcome without moving anything the user is reading.
//
// The region is aria-live="polite" so a screen reader hears the result too,
// after whatever it was already saying.

const ToastContext = createContext(null);

const ICONS = { success: "check", error: "alert", info: "info" };
let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (message, { tone = "info", duration = 4500 } = {}) => {
      const id = ++nextId;
      setToasts((list) => [...list, { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration)
      );
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-region" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.tone}`}>
              <Icon
                name={ICONS[t.tone]}
                size={16}
                className={
                  t.tone === "success"
                    ? "u-pos"
                    : t.tone === "error"
                    ? "u-neg"
                    : "u-muted"
                }
              />
              <span className="toast-body">{t.message}</span>
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
