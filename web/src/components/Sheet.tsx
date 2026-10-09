import { useEffect, useRef, type ReactNode } from "react";
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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="eko-sheet__scrim" onClick={onClose}>
      <div
        ref={panelRef}
        className="eko-sheet"
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
        <div className="eko-sheet__body">{children}</div>
      </div>
    </div>
  );
}
