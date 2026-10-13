import { useEffect, useRef, useState, type ReactNode } from "react";
import "./Phone.css";
import { useGemHunt, GemDialog, gemCountdown } from "../home/GemHunt";
import { naira } from "../../game/types";
import { blip } from "../../lib/sound";

export interface PhoneApp {
  id: string;
  label: string;
  icon: string;
}

/** The twelve apps inside the Phone. Order is the grid order. */
export const PHONE_APPS: PhoneApp[] = [
  { id: "jobs", label: "Jobs", icon: "💼" },
  { id: "daily", label: "Daily", icon: "🎯" },
  { id: "market", label: "Market", icon: "💰" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "friends", label: "Friends", icon: "🤝" },
  { id: "gist", label: "Gist", icon: "📣" },
  // Phase 4: Èkó Reserve — the bank app (gameplay coins only).
  { id: "bank", label: "Èkó Reserve", icon: "🏦" },
  // Phase 6: Boutique — premium clothing shop.
  { id: "boutique", label: "Boutique", icon: "🛍️" },
  // Phase 7: Èkó Rich List — top players by net worth.
  { id: "richlist", label: "Rich List", icon: "🏆" },
  // Phase 8: Èkó Gov — governor election + governance.
  { id: "gov", label: "Èkó Gov", icon: "🏛️" },
  { id: "style", label: "Style", icon: "✨" },
  { id: "room", label: "My Room", icon: "🏠" },
  { id: "me", label: "Me", icon: "🧑" },
];

/** Dock holds the four most-used apps. */
const DOCK_APPS = ["jobs", "gist", "bank", "me"] as const;

export interface PhoneProps {
  /** Slide-over visible. */
  open: boolean;
  onClose: () => void;
  /** Currently open app id, or null for the app grid. */
  activeApp: string | null;
  onSelectApp: (id: string | null) => void;
  /** Provided by the parent — returns the open app's content. */
  renderApp: (id: string) => ReactNode;
  /** Auth token — the Gem Hunt widget loads the live clue with it. */
  token: string;
  /** Current game day for the "☀️ Day N" pill. */
  day?: number | null;
  /** Player coins for the "₦X" pill. */
  coins?: number;
}

/** Live device clock for the iPhone screen ("09:41" style, 24h). */
function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(iv);
  }, []);
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Device date line like "Tue, 12 Mar". */
function useDateLine(): string {
  const [now] = useState(() => new Date());
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;
}

/* ------------------------------------------------------------------ */
/* Gem Hunt widget — the daily clue lives on the phone home screen.    */
/* Tapping opens the full gem dialog (ported above the phone panel).   */
/* ------------------------------------------------------------------ */

function GemWidget({ token }: { token: string }) {
  const { gem, reload } = useGemHunt(token);
  const [open, setOpen] = useState(false);
  if (!gem) return null;
  return (
    <>
      <button
        type="button"
        className="eko-iphone__widget"
        onClick={() => {
          blip("tap");
          setOpen(true);
        }}
        aria-label="Open the daily gem hunt"
      >
        <span className="eko-iphone__widget-kicker">💎 GEM HUNT</span>
        <span className="eko-iphone__widget-title">
          {gem.myFound ? `Found! +${naira(gem.myPrize ?? 0)}` : "Clue unlocked"}
        </span>
        <span className="eko-iphone__widget-sub">
          {gem.myFound ? gemCountdown(gem.nextGemInMs) : `\u201c${gem.clue}\u201d`}
        </span>
      </button>
      {open && (
        <GemDialog
          gem={gem}
          token={token}
          onClose={() => setOpen(false)}
          onSearched={reload}
        />
      )}
    </>
  );
}

function AppIcon({ app }: { app: PhoneApp }) {
  return (
    <span
      className={`eko-iphone__icon eko-iphone__icon--${app.id}`}
      aria-hidden="true"
    >
      {app.icon}
    </span>
  );
}

/**
 * Phone — the in-game iPhone (reference mockup 2026-10-13).
 *
 * Full-screen sky stage: day/coins pill + close pill on top, a 3D iPhone
 * with notch, purple→orange gradient wallpaper, big clock, date line,
 * frosted app grid + dock. Tapping an app opens it; the home indicator
 * (or ‹) goes back to the grid; ✕ puts the phone away.
 *
 * The wide Style studio keeps the legacy glass panel (room for the 3D
 * preview) — the iPhone chrome only applies to the standard panel.
 */
export function Phone({
  open,
  onClose,
  activeApp,
  onSelectApp,
  renderApp,
  token,
  day,
  coins,
}: PhoneProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const clock = useClock();
  const dateLine = useDateLine();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock body scroll while the phone is open; restore on close.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Raise the game tab bar above the sky so it stays visible.
    document.body.classList.add("eko-phone-open");
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      document.body.classList.remove("eko-phone-open");
    };
  }, [open, onClose]);

  if (!open) return null;

  const wide = activeApp === "style";
  const iphone = !wide;
  const known = activeApp ? PHONE_APPS.find((a) => a.id === activeApp) : undefined;
  const isAppOpen = activeApp !== null;
  const appLabel = known?.label ?? activeApp ?? "";
  const appIcon = known?.icon ?? "📱";

  const goGrid = () => {
    blip("tap");
    onSelectApp(null);
  };
  const openApp = (id: string) => () => {
    blip("tap");
    onSelectApp(id);
  };

  return (
    <div className="eko-phone__scrim" onClick={onClose}>
      {/* Sky glow behind the iPhone (blue left, warm right). */}
      <div className="eko-phone__glow" aria-hidden="true" />

      {/* Top pills: day/coins + close — match the reference mockup. */}
      <div
        className="eko-phone__skypills"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="eko-phone__daypill" role="status">
          <span aria-hidden="true">☀️</span>
          <span>
            Day {day ?? "–"}, {naira(coins ?? 0)}
          </span>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="eko-phone__closepill"
          onClick={onClose}
          aria-label="Close phone"
        >
          <span aria-hidden="true">×</span> Close
        </button>
      </div>

      <section
        className={`eko-phone__panel${wide ? " eko-phone__panel--wide" : ""}${iphone ? " eko-phone__panel--iphone" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={isAppOpen ? `${appLabel} — Phone` : "Phone"}
        onClick={(e) => e.stopPropagation()}
      >
        {iphone ? (
          <div className="eko-iphone__screen">
            <div className="eko-iphone__notch" aria-hidden="true" />

            {isAppOpen && activeApp ? (
              <>
                <div className="eko-iphone__navbar">
                  <button
                    type="button"
                    className="eko-iphone__navbtn"
                    onClick={goGrid}
                    aria-label="Back to apps"
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                  <span className="eko-iphone__navtitle">
                    {appLabel}
                  </span>
                  <button
                    type="button"
                    className="eko-iphone__navbtn"
                    onClick={onClose}
                    aria-label="Close phone"
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
                <div className="eko-iphone__app" key={activeApp}>
                  {renderApp(activeApp)}
                </div>
              </>
            ) : (
              <>
                <div className="eko-iphone__bigtine">{clock}</div>
                <div className="eko-iphone__dateline">
                  {dateLine} • Èkó Life
                </div>
                <GemWidget token={token} />
                <nav className="eko-iphone__grid" aria-label="Phone apps">
                  {PHONE_APPS.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      className="eko-iphone__appbtn"
                      onClick={openApp(app.id)}
                      aria-label={`Open ${app.label}`}
                    >
                      <AppIcon app={app} />
                      <span className="eko-iphone__label">{app.label}</span>
                    </button>
                  ))}
                </nav>
                <div className="eko-iphone__dock" role="group" aria-label="Dock">
                  {DOCK_APPS.map((id) => {
                    const app = PHONE_APPS.find((a) => a.id === id);
                    if (!app) return null;
                    return (
                      <button
                        key={id}
                        type="button"
                        className="eko-iphone__appbtn eko-iphone__appbtn--dock"
                        onClick={openApp(id)}
                        aria-label={`Open ${app.label}`}
                      >
                        <AppIcon app={app} />
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <button
              type="button"
              className="eko-iphone__homebar"
              onClick={goGrid}
              aria-label="Go to the app grid"
            />
          </div>
        ) : (
          <>
            <header className="eko-phone__header">
              <button
                type="button"
                className="eko-phone__back glass glass--tint-dark"
                onClick={goGrid}
                aria-label="Back to apps"
              >
                <span aria-hidden="true">‹</span>
              </button>
              <div className="eko-phone__titles">
                <h2 className="eko-phone__title">{appLabel}</h2>
                <p className="eko-phone__subtitle">Èkó Life</p>
              </div>
              <span className="eko-phone__app-icon" aria-hidden="true">
                {appIcon}
              </span>
              <button
                type="button"
                className="eko-phone__close glass glass--tint-dark"
                onClick={onClose}
                aria-label="Close phone"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </header>

            {activeApp ? (
              <div className="eko-phone__app" key={activeApp}>
                {renderApp(activeApp)}
              </div>
            ) : null}

            <div className="eko-phone__homebar" aria-hidden="true" />
          </>
        )}
      </section>
    </div>
  );
}
