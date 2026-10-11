import { useCallback, useEffect, useState } from "react";
import { authGet } from "../../lib/api";
import type { ActName } from "../../game/types";
import { Button } from "../../components";

/* ------------------------------------------------------------------ */
/* GoalsCard — compact "Today's Hustle" card for the Home tab. Reuses   */
/* the M9 hustle endpoint (the same missions DailyTab shows) so the    */
/* goals stay in sync; tapping expands the full mission list inline    */
/* with claim buttons.                                                 */
/* ------------------------------------------------------------------ */

interface Mission {
  id: string;
  label: string;
  reward: number;
  done: boolean;
  claimed: boolean;
}
interface HustleData {
  dayKey: string;
  missions: Mission[];
  stars: number;
}

export function GoalsCard({
  token,
  sendAct,
}: {
  token: string;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
}) {
  const [hustle, setHustle] = useState<HustleData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const h = (await authGet("/api/v2/m9/hustle", token)) as HustleData | null;
      if (h && Array.isArray(h.missions)) setHustle(h);
    } catch {
      /* offline — keep last state */
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const claim = useCallback(
    (m: Mission) => {
      setBusy(m.id);
      sendAct("hustle_claim", { missionId: m.id });
      window.setTimeout(() => {
        load();
        setBusy(null);
      }, 900);
    },
    [sendAct, load]
  );

  const missions = hustle?.missions ?? [];
  const doneCount = missions.filter((m) => m.done || m.claimed).length;
  const preview = missions.slice(0, 3);
  const list = expanded ? missions : preview;

  return (
    <section className="eko-goals glass" aria-label="Today's goals">
      <button
        type="button"
        className="eko-goals__head"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="eko-goals__title">
          <span aria-hidden="true">🎯</span> Today&apos;s hustle
        </span>
        <span className="eko-goals__meta">
          <span className="eko-goals__stars" title="Perk stars">
            ✨ {hustle?.stars ?? 0}
          </span>
          <span className="eko-goals__count">
            {missions.length === 0 ? "…" : `${doneCount}/${missions.length}`}
          </span>
          <span className="eko-goals__chev" aria-hidden="true">
            {expanded ? "▴" : "▾"}
          </span>
        </span>
      </button>

      {missions.length === 0 ? (
        <p className="eko-goals__empty">Loading today&apos;s missions…</p>
      ) : (
        <ul className="eko-goals__list">
          {list.map((m) => (
            <li
              key={m.id}
              className={`eko-goals__item ${m.claimed ? "is-claimed" : ""}`}
            >
              <span className="eko-goals__check" aria-hidden="true">
                {m.claimed ? "✅" : m.done ? "☑️" : "⬜"}
              </span>
              <span className="eko-goals__label">{m.label}</span>
              <span className="eko-goals__reward">+{m.reward} ✨</span>
              {expanded && !m.claimed && (
                <Button
                  size="md"
                  variant={m.done ? "primary" : "ghost"}
                  disabled={!m.done || busy === m.id}
                  onClick={() => claim(m)}
                >
                  {busy === m.id ? "…" : m.done ? "Claim" : "Locked"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
