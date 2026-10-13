import { useCallback, useEffect, useRef, useState } from "react";
import { LagosMap } from "../game/LagosMap";
import { STUB_PINS, type PinLocation } from "../game/stubLocations";
import { mapXYToWorld, toPin } from "../game/mapPins";
import { api, type PublicStats } from "../lib/api";
import { beaconError } from "../lib/beacon";
import { Button, Dialog, Skeleton } from "../components";
import type { NewsItem, PresenceEntry } from "../game/types";
import "./Landing.css";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Map a presence record to a CityMap pin (colored avatar dot). */
function presencePin(p: PresenceEntry): PinLocation {
  const { x, z } = mapXYToWorld(p.x, p.y);
  return {
    id: `presence:${p.id}`,
    name: `@${p.username}`,
    emoji: p.avatar || "🧍",
    blurb: "A fellow citizen, out and about in Èkó Life right now.",
    x,
    z,
    zone: Math.abs(x) < 13 ? "lagoon" : x < 0 ? "mainland" : "island",
  };
}

/** Public news ticker — marquee; reduced-motion users get a static list. */
function NewsTicker({ news }: { news: NewsItem[] }) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (news.length === 0) return null;
  if (reduced) {
    return (
      <div className="eko-ticker eko-ticker--static" aria-label="City news">
        {news.slice(0, 3).map((n) => (
          <span key={String(n.id ?? n.text)} className="eko-ticker__item">
            📻 {n.text}
          </span>
        ))}
      </div>
    );
  }
  const items = [...news, ...news]; // duplicate for a seamless loop
  return (
    <div className="eko-ticker" aria-label="City news" role="marquee">
      <div className="eko-ticker__track">
        {items.map((n, i) => (
          <span key={`${String(n.id ?? n.text)}-${i}`} className="eko-ticker__item">
            📻 {n.text}
          </span>
        ))}
      </div>
    </div>
  );
}

export type AuthEntry = "signup" | "login" | "guest";

export function Landing({ onAuth }: { onAuth: (tab: AuthEntry) => void }) {
  const [pins, setPins] = useState<PinLocation[]>(STUB_PINS);
  const [pinsReady, setPinsReady] = useState(false);
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [selected, setSelected] = useState<PinLocation | null>(null);
  const [govOpen, setGovOpen] = useState(false);
  const statsTimer = useRef<number | null>(null);
  const presenceTimer = useRef<number | null>(null);

  // Load pins from server config (fallback: local stubs)
  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((cfg) => {
        if (cancelled) return;
        const list = Array.isArray(cfg.locations) ? cfg.locations : [];
        if (list.length > 0) {
          setPins(list.slice(0, 60).map((l, i) => toPin(l, i, list.length)));
        }
        setPinsReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        beaconError(err instanceof Error ? err.message : "config fetch failed", "landing:config");
        setPinsReady(true); // stubs already in place
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live counters + news ticker, 15s poll
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .stats()
        .then((s) => {
          if (!cancelled) setStats(s);
        })
        .catch(() => {
          /* keep last known counters; landing still works offline-ish */
        });
      api
        .news()
        .then((items) => {
          if (!cancelled && items) setNews(items);
        })
        .catch(() => {
          /* no ticker — the server may not have news yet */
        });
    };
    load();
    statsTimer.current = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      if (statsTimer.current) window.clearInterval(statsTimer.current);
    };
  }, []);

  // Player presence dots on the 3D map — polls the optional public
  // GET /api/presence (capped, 10s). When the endpoint doesn't exist the
  // map simply renders without presence dots.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .presence()
        .then((list) => {
          if (!cancelled) setPresence(list ?? []);
        })
        .catch(() => {
          if (!cancelled) setPresence([]);
        });
    };
    load();
    presenceTimer.current = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      if (presenceTimer.current) window.clearInterval(presenceTimer.current);
    };
  }, []);

  // Merge location pins + presence dots (re-renders pin layer via CityMap).
  const allPins = pins.concat(presence.map(presencePin));

  const handlePinSelect = useCallback((pin: PinLocation) => {
    setSelected(pin);
  }, []);

  const selectedIsPlayer = selected?.id.startsWith("presence:") ?? false;

  return (
    <div className="eko-landing">
      <div className="eko-landing__map" key={pinsReady ? "ready" : "stub"}>
        <LagosMap pins={allPins} onPinSelect={handlePinSelect} />
      </div>

      <header className="eko-landing__topbar">
        <div className="eko-landing__brand">
          <span className="eko-landing__logo" aria-hidden="true">
            🌊
          </span>
          <span className="eko-landing__wordmark">Èkó Life</span>
        </div>

        <div className="eko-landing__counters" aria-live="polite">
          {stats ? (
            <>
              <span className="eko-pill" title="Players online now">
                <span className="eko-dot" aria-hidden="true" />
                {formatCount(stats.online)} online
              </span>
              <span className="eko-pill" title="Total visits">
                👀 {formatCount(stats.visits)} visits
              </span>
            </>
          ) : (
            <>
              <Skeleton width={96} height={30} rounded={999} />
              <Skeleton width={96} height={30} rounded={999} />
            </>
          )}
          <button
            type="button"
            className="eko-pill eko-pill--gov"
            onClick={() => setGovOpen(true)}
            aria-haspopup="dialog"
          >
            🏛️ {stats?.governor ? `@${stats.governor}` : "No governor yet"}
          </button>
        </div>
      </header>

      <NewsTicker news={news} />

      <main className="eko-landing__hero">
        <div className="eko-landing__cta-card">
          <h1 className="eko-landing__title">Live your Lagos story.</h1>
          <p className="eko-landing__sub">
            Hustle on the Mainland, chill on the Island, meet real people —
            and maybe run this city one day.
          </p>
          <div className="eko-landing__cta-row">
            <Button size="lg" onClick={() => onAuth("signup")}>
              Create free account
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={() => onAuth("guest")}
            >
              Play as guest
            </Button>
          </div>
          <button
            type="button"
            className="eko-landing__login-link"
            onClick={() => onAuth("login")}
          >
            Already have an account? Log in
          </button>
        </div>
      </main>

      {/* Location / player dialog */}
      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.emoji} ${selected.name}` : undefined}
      >
        {selected && selectedIsPlayer ? (
          <>
            <p className="eko-landing__dialog-text">
              That's <strong>{selected.name}</strong> — a fellow citizen, live
              in the city right now.
            </p>
            <p className="eko-landing__dialog-note">
              Join the city to chat with them, add them as a friend, or meet at
              a hangout.
            </p>
            <Button size="lg" onClick={() => onAuth("guest")}>
              Play as guest to meet them
            </Button>
            <Button variant="ghost" onClick={() => onAuth("signup")}>
              Create an account instead
            </Button>
          </>
        ) : (
          selected && (
            <>
              <p className="eko-landing__dialog-text">{selected.blurb}</p>
              <p className="eko-landing__dialog-note">
                Guests and players hang out here, chat, and meet people.
              </p>
              <Button size="lg" onClick={() => onAuth("guest")}>
                Play as guest to visit
              </Button>
              <Button variant="ghost" onClick={() => onAuth("signup")}>
                Create an account instead
              </Button>
            </>
          )
        )}
      </Dialog>

      {/* Governor dialog */}
      <Dialog
        open={govOpen}
        onClose={() => setGovOpen(false)}
        title="🏛️ State House"
      >
        {stats?.governor ? (
          <>
            <p className="eko-landing__dialog-text">
              <strong>@{stats.governor}</strong> is the governor of Èkó Life
              this week — elected by the players, for the players.
            </p>
            <p className="eko-landing__dialog-note">
              Create a character to vote in the next election — or run for the
              seat yourself.
            </p>
            <Button
              size="lg"
              onClick={() => {
                setGovOpen(false);
                onAuth("signup");
              }}
            >
              Join and vote
            </Button>
          </>
        ) : (
          <>
            <p className="eko-landing__dialog-text">
              <strong>No governor yet — be the first!</strong>
            </p>
            <p className="eko-landing__dialog-note">
              The State House seat is empty. Create your character, build your
              name in the city, and take the crown in the next election.
            </p>
            <Button
              size="lg"
              onClick={() => {
                setGovOpen(false);
                onAuth("signup");
              }}
            >
              Claim your shot
            </Button>
          </>
        )}
      </Dialog>
    </div>
  );
}
