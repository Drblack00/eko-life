import { useCallback, useEffect, useState } from "react";
import { authGet } from "../../lib/api";
import type { ActName } from "../../game/types";

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
  const pct = missions.length ? Math.round((doneCount / missions.length) * 100) : 0;

  return (
    <section className="db-hustle" aria-label="Today's hustle">
      <button
        type="button"
        className="db-hustle__head"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="db-hustle__title">
          <span aria-hidden="true">✨</span> Today&apos;s hustle
        </span>
        <span className="db-hustle__count">
          {missions.length === 0 ? "…" : `${doneCount}/${missions.length}`}
        </span>
      </button>
      <div className="db-hustle__bar" aria-hidden="true">
        <span className="db-hustle__fill" style={{ width: `${pct}%` }} />
      </div>

      {missions.length > 0 && (
        <ul className="db-hustle__list">
          {list.map((m) => (
            <li
              key={m.id}
              className={`db-hustle__item ${m.done || m.claimed ? "is-done" : ""}`}
            >
              <span className="db-goals__check" aria-hidden="true">
                {m.done || m.claimed ? "✓" : "•"}
              </span>
              <span className="db-hustle__label">{m.label}</span>
              {expanded && !m.claimed && (
                <button
                  type="button"
                  className="db-hustle__claim"
                  disabled={!m.done || busy === m.id}
                  onClick={() => claim(m)}
                >
                  {busy === m.id ? "…" : m.done ? "Claim" : "Locked"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
