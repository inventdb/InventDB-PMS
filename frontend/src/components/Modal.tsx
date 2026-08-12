import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function Modal({
  title,
  onClose,
  children,
  footer,
  narrow,
  hideTitle,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  narrow?: boolean;
  /**
   * Keep `title` as the dialog's accessible name but do not draw it.
   *
   * For a body that already leads with the same heading — and, in the workflow
   * console's case, with an *editable* version of it. Printing it twice invites
   * the question of which one is real.
   */
  hideTitle?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Rendered into <body> rather than in place. Pages are declared inside a
  // container that animates on route change, and a transformed ancestor
  // becomes the containing block for `position: fixed` — which would peg the
  // backdrop to the page box instead of the viewport for the length of the
  // entrance. The portal takes the dialog out of that subtree entirely, and
  // incidentally puts it above every stacking context on the page.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal ${narrow ? "narrow" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          {!hideTitle && <h3>{title}</h3>}
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      narrow
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, color: "var(--text-muted)" }}>{message}</p>
    </Modal>
  );
}
