import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import Button from "./Button.jsx";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog — the replacement for the inline forms that used to expand in
 * the middle of a list and push everything below them down the page. Editing
 * an account is a distinct task, so it gets a distinct surface.
 *
 * Handles the four things a dialog owes the user: focus moves in on open and
 * back to the trigger on close, Tab is trapped inside, Escape dismisses, and
 * the page behind it stops scrolling.
 */
export default function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  wide = false,
  children,
}) {
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);
  const titleId = useId();
  const descId = useId();

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Focus the first control rather than the panel, so keyboard users land
    // on something they can type into.
    const target =
      panelRef.current?.querySelector(FOCUSABLE) ?? panelRef.current;
    target?.focus?.();

    return () => {
      document.body.style.overflow = overflow;
      returnFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        // Only a click that both starts and ends on the backdrop dismisses —
        // a drag that began inside the form shouldn't throw the form away.
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={`modal ${wide ? "modal--wide" : ""}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        ref={panelRef}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id={titleId}>
              {title}
            </h2>
            {description && (
              <p className="modal-desc" id={descId}>
                {description}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            onClick={onClose}
            aria-label="Close dialog"
          />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/**
 * Confirm dialog for destructive actions. Replaces window.confirm(), which
 * can't say *what* is being deleted and looks like a browser warning rather
 * than part of the product.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
  busy = false,
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger-solid" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="u-secondary">{children}</p>
    </Modal>
  );
}
