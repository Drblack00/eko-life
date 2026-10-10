import { useCallback, useEffect, useRef, useState } from "react";
import { StatBar, Button, EmptyState } from "../../../components";
import type { GameSocket } from "../../../hooks/useGameSocket";
import { getToken } from "../../../lib/auth";
import type { You, ActName } from "../../../game/types";
import "./NeedsPanel.css";

/** M8: six needs panel. Coordinator extends the shared `You` type with
 *  fun/social/hygiene/bladder (Number, 0–100) — until then we read them
 *  defensively. */

interface NeedDef {
  id: string;
  label: string;
  icon: string;
}

const FALLBACK_NEEDS: NeedDef[] = [
  { id: "hunger", label: "Hunger", icon: "🍲" },
  { id: "energy", label: "Energy", icon: "⚡" },
  { id: "fun", label: "Fun", icon: "🎮" },
  { id: "social", label: "Social", icon: "🗣️" },
  { id: "hygiene", label: "Hygiene", icon: "🚿" },
  { id: "bladder", label: "Bladder", icon: "🚻" },
];

interface Moodlet {
  key: string;
  label: string;
  expires_at: number;
  expires_in_ms: number;
  citywide: boolean;
  effects: unknown[];
}

function needValue(you: You, id: string): number {
  const v = Number((you as unknown as Record<string, unknown>)[id]);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 100;
}

function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * Needs panel — six live bars, active moodlet chips with countdowns,
 * city-event banner slot, and quick wash/toilet actions.
 * Props: { you, sock } (same as the other Game tabs).
 */
export function NeedsPanel({
  you,
  sock,
}: {
  you: You;
  sock: GameSocket;
}) {
  const [moodlets, setMoodlets] = useState<Moodlet[]>([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef<number | null>(null);

  const configNeeds: NeedDef[] =
    (sock.config as unknown as { needs?: NeedDef[] } | null)?.needs ??
    FALLBACK_NEEDS;

  const fetchMoodlets = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/v2/m8/moodlets", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = (await res.json()) as { moodlets?: Moodlet[] };
        setMoodlets(Array.isArray(body.moodlets) ? body.moodlets : []);
      }
    } catch {
      /* offline — keep last known */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMoodlets();
    timer.current = window.setInterval(fetchMoodlets, 30000);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [fetchMoodlets]);

  // Refresh moodlets shortly after any needs-mutating action lands
  // (the fresh `you` snapshot is the signal).
  useEffect(() => {
    fetchMoodlets();
  }, [you.hunger, you.energy, you.happiness, fetchMoodlets]);

  const cityEvents = moodlets.filter((m) => m.citywide);
  const personal = moodlets.filter((m) => !m.citywide);

  return (
    <div className="eko-needs eko-tabpad">
      <h2 className="eko-tabh">Needs</h2>

      {cityEvents.length > 0 && (
        <div className="eko-needs__events" role="status" aria-live="polite">
          {cityEvents.map((e) => (
            <div key={e.key} className="eko-needs__event glass">
              <span className="eko-needs__event-label">🌆 {e.label}</span>
              <span className="eko-needs__event-timer">
                {fmtCountdown(e.expires_in_ms)} left
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="eko-needs__bars">
        {configNeeds.map((n) => (
          <StatBar
            key={n.id}
            label={n.label}
            icon={n.icon}
            value={needValue(you, n.id)}
          />
        ))}
      </div>

      <div className="eko-needs__quick">
        <Button
          size="md"
          variant="ghost"
          onClick={() => sock.sendAct("wash" as ActName)}
        >
          🚿 Wash up
        </Button>
        <Button
          size="md"
          variant="ghost"
          onClick={() => sock.sendAct("toilet" as ActName)}
        >
          🚻 Toilet
        </Button>
      </div>

      <h3 className="eko-needs__sub">Moodlets</h3>
      {loading ? (
        <EmptyState emoji="🌀" title="Checking the vibe…" />
      ) : personal.length === 0 ? (
        <EmptyState
          emoji="😌"
          title="No moodlets"
          body="Eat tasty food, have fun, work a shift — life leaves its mark."
        />
      ) : (
        <ul className="eko-needs__chips">
          {personal.map((m) => (
            <li key={m.key} className="eko-needs__chip glass">
              <span className="eko-needs__chip-label">{m.label}</span>
              <span className="eko-needs__chip-timer">
                {fmtCountdown(m.expires_in_ms)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
