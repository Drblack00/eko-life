import { useCallback, useEffect, useState } from "react";
import { authGet, type TravelFares } from "../../lib/api";
import { naira } from "../../game/types";
import { Button, Dialog } from "../../components";
import { blip } from "../../lib/sound";
import { compactNum, moodFor, shiftCountdown, SHORTCUTS } from "./homeChrome";
import "./HomeChrome.css";

export { compactNum, moodFor };

/* ------------------------------------------------------------------ */
/* Site stats: visits counter (public /api/stats, polled).             */
/* ------------------------------------------------------------------ */

export function useVisits(): number | null {
  const [visits, setVisits] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/stats");
        if (!r.ok) return;
        const j = (await r.json()) as { visits?: number };
        if (alive && typeof j.visits === "number") setVisits(j.visits);
      } catch {
        /* counter stays on last value */
      }
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);
  return visits;
}

/* ------------------------------------------------------------------ */
/* Announcement pill — latest world news, dismissible per session.     */
/* ------------------------------------------------------------------ */

interface NewsItem {
  type: string;
  text: string;
  ts: number;
  day: number;
}

export function AnnouncementPill({ onDismiss }: { onDismiss: () => void }) {
  const [item, setItem] = useState<NewsItem | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/news");
        if (!r.ok) return;
        const j = (await r.json()) as { news?: NewsItem[] };
        const latest = Array.isArray(j.news) && j.news.length > 0 ? j.news[j.news.length - 1] : null;
        if (alive && latest && latest.text) setItem(latest);
      } catch {
        /* no announcement */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (!item) return null;
  return (
    <div className="eko-announce glass" role="status">
      <span aria-hidden="true">📢</span>
      <span className="eko-announce__text">{item.text}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss announcement">
        ✕
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Top-up dialog — cash wallet is inert, so this explains + routes      */
/* to real earning instead of wiring payments.                         */
/* ------------------------------------------------------------------ */

export function TopUpDialog({
  open,
  balance,
  onClose,
  onEarn,
}: {
  open: boolean;
  balance: string;
  onClose: () => void;
  onEarn: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Top up wallet">
      <div className="eko-topup">
        <p className="eko-topup__balance">
          Current balance: <strong>{balance}</strong>
        </p>
        <p>
          Direct top-ups aren't available in Èkó Life yet — they're coming
          soon. The fastest way to stack coins right now is clocking in for
          shifts.
        </p>
        <div className="eko-topup__actions">
          <Button
            onClick={() => {
              blip("tap");
              onClose();
              onEarn();
            }}
          >
            💼 Earn in Jobs
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Keyboard shortcuts dialog.                                          */
/* ------------------------------------------------------------------ */

export function ShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="⌨️ Keyboard shortcuts">
      <ul className="eko-shortcuts">
        {SHORTCUTS.map((s) => (
          <li key={s.key} className="eko-shortcuts__row">
            <kbd>{s.label}</kbd>
            <span>{s.description}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Left floating cards: goals, daily, clean-screen toggle.             */
/* ------------------------------------------------------------------ */

interface Mission {
  id: string;
  label: string;
  reward: number;
  done: boolean;
}

function useHustle(token: string) {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [stars, setStars] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const h = (await authGet("/api/v2/m9/hustle", token)) as {
          missions?: Mission[];
          stars?: number;
        } | null;
        if (!alive || !h) return;
        if (Array.isArray(h.missions)) setMissions(h.missions);
        if (typeof h.stars === "number") setStars(h.stars);
      } catch {
        /* cards stay hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);
  return { missions, stars };
}

function SideCards({
  token,
  onOpenApp,
  cleanMode,
  onToggleClean,
}: {
  token: string;
  onOpenApp: (app: string) => void;
  cleanMode: boolean;
  onToggleClean: () => void;
}) {
  const { missions, stars } = useHustle(token);
  const top = missions?.find((m) => !m.done) ?? null;
  const tap = (app: string) => () => {
    blip("tap");
    onOpenApp(app);
  };
  return (
    <div className="eko-sidecards" aria-label="Quick cards">
      {top && (
        <button type="button" className="eko-sidecard glass" onClick={tap("daily")}>
          <span className="eko-sidecard__icon" aria-hidden="true">
            🎯
          </span>
          <span className="eko-sidecard__body">
            <strong>Goal</strong>
            <span className="eko-sidecard__text">{top.label}</span>
            <span className="eko-sidecard__sub">{naira(top.reward)} reward</span>
          </span>
        </button>
      )}
      <button type="button" className="eko-sidecard glass" onClick={tap("daily")}>
        <span className="eko-sidecard__icon" aria-hidden="true">
          📅
        </span>
        <span className="eko-sidecard__body">
          <strong>Daily</strong>
          <span className="eko-sidecard__text">Today's hustle</span>
          <span className="eko-sidecard__sub">⭐ {stars} earned</span>
        </span>
      </button>
      <button
        type="button"
        className="eko-sidecard eko-sidecard--toggle glass"
        onClick={() => {
          blip("tap");
          onToggleClean();
        }}
        aria-pressed={cleanMode}
        title={cleanMode ? "Show the interface" : "Hide the interface"}
      >
        <span className="eko-sidecard__icon" aria-hidden="true">
          {cleanMode ? "📺" : "🧹"}
        </span>
        <span className="eko-sidecard__body">
          <strong>{cleanMode ? "Show UI" : "Clean screen"}</strong>
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom-right pills: go to work, travel, shortcuts.                  */
/* ------------------------------------------------------------------ */

function WorkPill({
  shift,
  onOpenApp,
}: {
  shift?: { job: string; name: string; endsAt: number } | null;
  onOpenApp: (app: string) => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!shift) return;
    const iv = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(iv);
  }, [shift]);
  const tap = () => {
    blip("tap");
    onOpenApp("jobs");
  };
  if (shift) {
    return (
      <button type="button" className="eko-workpill glass" onClick={tap}>
        <span aria-hidden="true">🔨</span>
        <span>
          <strong>On shift</strong>
          <span className="eko-workpill__sub">
            {shift.name || shift.job} · {shiftCountdown(shift.endsAt)}
          </span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" className="eko-workpill glass" onClick={tap}>
      <span aria-hidden="true">💼</span>
      <strong>Go to work</strong>
    </button>
  );
}

function TravelPill({
  fares,
  onGo,
}: {
  fares?: TravelFares;
  onGo: () => void;
}) {
  const from = fares?.sameRegion ?? 0;
  return (
    <button
      type="button"
      className="eko-workpill glass"
      onClick={() => {
        blip("tap");
        onGo();
      }}
      title="Open the map to travel"
    >
      <span aria-hidden="true">🚕</span>
      <span>
        <strong>Travel</strong>
        <span className="eko-workpill__sub">From {naira(from)}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Combined overlay root — rendered on the Home tab only.              */
/* ------------------------------------------------------------------ */

export function HomeOverlays({
  token,
  shift,
  fares,
  cleanMode,
  onToggleClean,
  onOpenApp,
  onTab,
  onOpenShortcuts,
}: {
  token: string;
  shift?: { job: string; name: string; endsAt: number } | null;
  fares?: TravelFares;
  cleanMode: boolean;
  onToggleClean: () => void;
  onOpenApp: (app: string) => void;
  onTab: (t: "home" | "buy" | "map" | "phone") => void;
  onOpenShortcuts: () => void;
}) {
  const goMap = useCallback(() => onTab("map"), [onTab]);
  return (
    <>
      <SideCards
        token={token}
        onOpenApp={onOpenApp}
        cleanMode={cleanMode}
        onToggleClean={onToggleClean}
      />
      <div className="eko-workpills" aria-label="Work and travel">
        <WorkPill shift={shift} onOpenApp={onOpenApp} />
        <TravelPill fares={fares} onGo={goMap} />
        <button
          type="button"
          className="eko-workpill eko-workpill--round glass"
          onClick={() => {
            blip("tap");
            onOpenShortcuts();
          }}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
        >
          ⌨️
        </button>
      </div>
    </>
  );
}
