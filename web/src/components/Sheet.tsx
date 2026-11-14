import { useEffect, useRef, type ReactNode } from "react";
import { usePresence } from "../hooks/usePresence";
import "./Sheet.css";

/** Bottom sheet — slides up on mobile, centered card on desktop. */
export function Sheet({
  open,
  onClose,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const present = usePresence(open);
  const lastChildren = useRef(children);
  if (open) lastChildren.current = children;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  if (!present) return null;

  return (
    <div className="eko-sheet__scrim" data-state={open ? "open" : "closing"} inert={!open} aria-hidden={!open || undefined} onClick={onClose}>
      <div
        ref={panelRef}
        className="eko-sheet glass glass--strong"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eko-sheet__grabber" aria-hidden="true" />
        <button
          className="eko-sheet__close"
          onClick={onClose}
          aria-label="Close"
          type="button"
        >
          ✕
        </button>
        <div className="eko-sheet__body">{open ? children : lastChildren.current}</div>
      </div>
    </div>
  );
}
