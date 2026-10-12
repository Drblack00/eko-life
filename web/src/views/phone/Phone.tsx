import { useEffect, useRef, type ReactNode } from "react";
import "./Phone.css";

export interface PhoneApp {
  id: string;
  label: string;
  icon: string;
}

/** The seven apps inside the Phone slide-over. Order is the grid order. */
export const PHONE_APPS: PhoneApp[] = [
  { id: "jobs", label: "Jobs", icon: "💼" },
  { id: "daily", label: "Daily", icon: "🎯" },
  { id: "market", label: "Market", icon: "💰" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "friends", label: "Friends", icon: "🤝" },
  { id: "style", label: "Style", icon: "✨" },
  { id: "me", label: "Me", icon: "🧑" },
];

export interface PhoneProps {
  /** Slide-over visible. */
  open: boolean;
  onClose: () => void;
  /** Currently open app id, or null for the app grid. */
  activeApp: string | null;
  onSelectApp: (id: string | null) => void;
  /** Provided by the parent — returns the open app's content. */
  renderApp: (id: string) => ReactNode;
}

/**
 * Phone — dark-glass slide-over panel holding the secondary sections as apps.
 *
 * Right-side panel on wide screens, bottom-sheet on narrow phones. Pure
 * overlay: the world behind stays mounted. The parent owns app state and
 * supplies each app's content via renderApp; this component is never given
 * the actual view components.
 */
export function Phone({ open, onClose, activeApp, onSelectApp, renderApp }: PhoneProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock body scroll while the phone is open; restore on close.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const known = activeApp ? PHONE_APPS.find((a) => a.id === activeApp) : undefined;
  const isAppOpen = activeApp !== null;
  const appLabel = known?.label ?? activeApp ?? "";
  const appIcon = known?.icon ?? "📱";

  return (
    <div className="eko-phone__scrim" onClick={onClose}>
      <section
        className={`eko-phone__panel${activeApp === "style" ? " eko-phone__panel--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={isAppOpen ? `${appLabel} — Phone` : "Phone"}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="eko-phone__header">
          {isAppOpen ? (
            <button
              type="button"
              className="eko-phone__back glass glass--tint-dark"
              onClick={() => onSelectApp(null)}
              aria-label="Back to apps"
            >
              <span aria-hidden="true">‹</span>
            </button>
          ) : null}
          <div className="eko-phone__titles">
            <h2 className="eko-phone__title">
              {isAppOpen ? appLabel : "Phone"}
            </h2>
            <p className="eko-phone__subtitle">
              {isAppOpen ? "Èkó Life" : "What do you want to do?"}
            </p>
          </div>
          {isAppOpen ? (
            <span className="eko-phone__app-icon" aria-hidden="true">
              {appIcon}
            </span>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            className="eko-phone__close glass glass--tint-dark"
            onClick={onClose}
            aria-label="Close phone"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        {isAppOpen && activeApp ? (
          <div className="eko-phone__app" key={activeApp}>
            {renderApp(activeApp)}
          </div>
        ) : (
          <nav className="eko-phone__grid" aria-label="Phone apps">
            {PHONE_APPS.map((app) => (
              <button
                key={app.id}
                type="button"
                className={`eko-phone__tile glass glass--tint-dark eko-phone__tile--${app.id}`}
                onClick={() => onSelectApp(app.id)}
              >
                <span className="eko-phone__tile-icon" aria-hidden="true">
                  {app.icon}
                </span>
                <span className="eko-phone__tile-label">{app.label}</span>
              </button>
            ))}
          </nav>
        )}

        <div className="eko-phone__homebar" aria-hidden="true" />
      </section>
    </div>
  );
}
