import { useEffect, useRef, type ReactNode } from "react";
import { usePresence } from "../hooks/usePresence";
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
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const present = usePresence(open);
  const lastChildren = useRef(children);
  if (open) lastChildren.current = children;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  if (!present) return null;

  return (
    <div className="eko-dialog__scrim" data-state={open ? "open" : "closing"} inert={!open} aria-hidden={!open || undefined} onClick={onClose}>
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
        <div className="eko-dialog__body">{open ? children : lastChildren.current}</div>
      </div>
    </div>
  );
}
