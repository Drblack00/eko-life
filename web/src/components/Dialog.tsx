import { useEffect, useRef, type ReactNode } from "react";
import "./Dialog.css";

/** Centered modal dialog with focus management. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="eko-dialog__scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="eko-dialog glass glass--strong"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="eko-dialog__close"
          onClick={onClose}
          aria-label="Close dialog"
          type="button"
        >
          ✕
        </button>
        {title && <h2 className="eko-dialog__title">{title}</h2>}
        <div className="eko-dialog__body">{children}</div>
      </div>
    </div>
  );
}
