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

/** The apps inside the Phone. Order is the grid order. */
export const PHONE_APPS: PhoneApp[] = [
  { id: "jobs", label: "Jobs", icon: "💼" },
  { id: "daily", label: "Daily", icon: "🎯" },
  { id: "market", label: "Market", icon: "💰" },
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "friends", label: "Friends", icon: "🤝" },
  { id: "gist", label: "Gist", icon: "📣" },
  // Phase 4: Èkó Reserve — the bank app (gameplay coins only).
  { id: "bank", label: "Èkó Reserve", icon: "🏦" },
  // Invest — land, businesses, haulage (gameplay coins only).
  { id: "invest", label: "Invest", icon: "📈" },
  // Phase 6: Boutique — premium clothing shop.
  { id: "boutique", label: "Boutique", icon: "🛍️" },
  // Phase 7: Èkó Rich List — top players by net worth.
  { id: "richlist", label: "Rich List", icon: "🏆" },
  // Phase 8: Èkó Gov — governor election + governance.
  { id: "gov", label: "Èkó Gov", icon: "🏛️" },
  // Crews — player clans: discover, join, shared goals, league board.
  { id: "crews", label: "Crews", icon: "🛡️" },
  // Story Questlines — chat-thread story arcs.
  { id: "story", label: "Stories", icon: "📖" },
  // Live Events Calendar — season banner, day timeline, RSVPs.
  { id: "events", label: "Events", icon: "📅" },
  // UGC Design Contests — duel voting, 2-tap entries.
  { id: "contests", label: "Contests", icon: "🎨" },
  // Games — parlor-games lobby, stake escrow, hall of fame.
  { id: "games", label: "Games", icon: "🎱" },
  // Hustle — gig board with escrow + find-a-pro.
  { id: "hustle", label: "Hustle", icon: "🧰" },
  // World apps — ride hailing, health, trade school, tickets, charity,
  // in-game ads, IPO-style promos, civic (police/court/assurance).
  { id: "ride", label: "Waka Ride", icon: "🛵" },
  { id: "clinic", label: "Clinic", icon: "🏥" },
  { id: "learn", label: "Trade School", icon: "🎓" },
  { id: "tickets", label: "Tickets", icon: "🎟️" },
  { id: "give", label: "Give", icon: "💝" },
  { id: "myads", label: "My Ads", icon: "📢" },
  { id: "riseipo", label: "Rise", icon: "🚀" },
  { id: "civic", label: "Civic", icon: "⚖️" },
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
}

/** Live device clock for the iPhone status bar ("7:18" style). */
function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 20_000);
    return () => clearInterval(iv);
  }, []);
  const h = now.getHours() % 12 || 12;
  return `${h}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function StatusIcons() {
  return (
    <span className="eko-iphone__statusicons" aria-hidden="true">
      <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
        <rect x="0" y="7" width="3" height="4" rx="1" />
        <rect x="4.5" y="5" width="3" height="6" rx="1" />
        <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
        <rect x="13.5" y="0" width="3" height="11" rx="1" />
      </svg>
      <svg
        width="16" height="12" viewBox="0 0 16 12"
        fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
      >
        <path d="M8 10.6v.1" />
        <path d="M4.9 7.6a4.4 4.4 0 0 1 6.2 0" />
        <path d="M2.6 5a7.7 7.7 0 0 1 10.8 0" />
        <path d="M0.4 2.5a11 11 0 0 1 15.2 0" />
      </svg>
      <svg width="25" height="12" viewBox="0 0 25 12">
        <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" fill="none" stroke="currentColor" opacity="0.45" />
        <rect x="2" y="2" width="15" height="8" rx="2" fill="currentColor" />
        <path d="M23.5 4v4a2.2 2.2 0 0 0 0-4z" fill="currentColor" opacity="0.45" />
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Gem Hunt widget — the daily clue lives on the phone home screen.    */
/* Tapping opens the full gem dialog (ported above the phone panel).   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Dynamic Island — behaves like the real iPhone island. The gem hunt  */
/* notification lives in the island: a compact live activity when a   */
/* clue is available, auto-expands to announce a fresh clue, and      */
/* tapping pops it open to the full detail card with the hunt dialog.  */
/* ------------------------------------------------------------------ */

function DynamicIsland({ token }: { token: string }) {
  const { gem, reload } = useGemHunt(token);
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const prevClue = useRef<string | null>(null);

  // A fresh clue auto-expands the island briefly, like iOS.
  useEffect(() => {
    if (!gem) return;
    if (prevClue.current === null) {
      prevClue.current = gem.clue;
      return;
    }
    if (prevClue.current !== gem.clue && !gem.myFound) {
      prevClue.current = gem.clue;
      setAnnouncing(true);
      blip("toast");
      const t = setTimeout(() => setAnnouncing(false), 4500);
      return () => clearTimeout(t);
    }
    prevClue.current = gem.clue;
  }, [gem]);

  if (!gem) return <span className="eko-iphone__island" aria-hidden="true" />;

  const showPop = open || announcing;
  const live = !gem.myFound;
  const title = live ? "Clue unlocked" : `Found! +${naira(gem.myPrize ?? 0)}`;
  const sub = live ? `\u201c${gem.clue}\u201d` : gemCountdown(gem.nextGemInMs);

  const toggle = () => {
    blip("tap");
    setAnnouncing(false);
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        type="button"
        className={`eko-iphone__island${live ? " eko-iphone__island--live" : ""}`}
        onClick={toggle}
        aria-expanded={showPop}
        aria-label={showPop ? "Dismiss gem hunt notification" : "Open gem hunt notification"}
      >
        <span className="eko-iphone__island-inner" aria-hidden="true">
          <span className="eko-iphone__island-dot">💎</span>
          {live && <span className="eko-iphone__island-label">Clue</span>}
        </span>
      </button>
      {showPop && (
        <div className="eko-iphone__island-pop" role="status">
          <span className="eko-iphone__widget-kicker">💎 GEM HUNT</span>
          <span className="eko-iphone__widget-title">{title}</span>
          <span className="eko-iphone__widget-sub">{sub}</span>
          <button
            type="button"
            className="eko-iphone__island-cta"
            onClick={() => {
              blip("tap");
              setDialogOpen(true);
            }}
          >
            🔍 Open hunt
          </button>
        </div>
      )}
      {dialogOpen && (
        <GemDialog
          gem={gem}
          token={token}
          onClose={() => setDialogOpen(false)}
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
 * Phone — the in-game iPhone.
 *
 * The panel is a real phone: dynamic island, iOS status bar with a live
 * clock, a Gem Hunt widget, a 4-column app grid, a 4-app dock and a home
 * indicator. Tapping the home indicator (or ‹) goes back to the app grid;
 * tapping outside the phone (or ✕ in an app) puts it away.
 * The screen follows the app theme (Porcelain D, picked 2026-10-14).
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
}: PhoneProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const clock = useClock();

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
      <section
        className={`eko-phone__panel${wide ? " eko-phone__panel--wide" : ""}${iphone ? " eko-phone__panel--iphone" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={isAppOpen ? `${appLabel} — Phone` : "Phone"}
        onClick={(e) => e.stopPropagation()}
        /* Porcelain (option D, picked 2026-10-14): the iPhone screen follows
           the app theme — no forced theme override. */
      >
        {iphone ? (
          <>
            <div className="eko-iphone__top">
              <span className="eko-iphone__clock">{clock}</span>
              <DynamicIsland token={token} />
              <StatusIcons />
            </div>

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
                    ref={closeRef}
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
          </>
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
                ref={closeRef}
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
