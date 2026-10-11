import { useState } from "react";
import type { GameSocket } from "../../hooks/useGameSocket";
import type { ActName, You } from "../../game/types";
import type { GameConfig } from "../../lib/api";
import { Sheet } from "../../components";
import { NeedsPanel } from "../v2/m8/NeedsPanel";
import { EatTab } from "../EatTab";

/* ------------------------------------------------------------------ */
/* NeedsBar — compact 6-need bar overlaid on the home room (bottom-    */
/* left). Tapping opens a detail panel that reuses the existing        */
/* NeedsPanel content plus the food/fun/study actions from EatTab, so  */
/* everything the old Needs dock tab offered stays reachable.          */
/* ------------------------------------------------------------------ */

const NEEDS = [
  { id: "hunger", label: "Hunger", icon: "🍲" },
  { id: "energy", label: "Energy", icon: "⚡" },
  { id: "fun", label: "Fun", icon: "🎮" },
  { id: "social", label: "Social", icon: "🗣️" },
  { id: "hygiene", label: "Hygiene", icon: "🚿" },
  { id: "bladder", label: "Bladder", icon: "🚻" },
] as const;

function needValue(you: You, id: string): number {
  const v = Number((you as unknown as Record<string, unknown>)[id]);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 100;
}

function barTone(v: number): string {
  if (v < 25) return "is-low";
  if (v < 55) return "is-mid";
  return "is-high";
}

/**
 * Compact needs bar + detail panel.
 * Props: you, sock (NeedsPanel + acts), config + sendAct (EatTab actions).
 */
export function NeedsBar({
  you,
  sock,
  config,
}: {
  you: You;
  sock: GameSocket;
  config: GameConfig | null;
}) {
  const [open, setOpen] = useState(false);
  const sendAct = (a: ActName, params?: Record<string, unknown>) =>
    sock.sendAct(a, params);

  return (
    <>
      <button
        type="button"
        className="eko-needsbar glass"
        onClick={() => setOpen(true)}
        aria-label="Open needs details"
        aria-haspopup="dialog"
      >
        {NEEDS.map((n) => {
          const v = needValue(you, n.id);
          return (
            <span key={n.id} className="eko-needsbar__need" title={`${n.label} ${v}%`}>
              <span className="eko-needsbar__icon" aria-hidden="true">
                {n.icon}
              </span>
              <span className={`eko-needsbar__track ${barTone(v)}`} aria-hidden="true">
                <span
                  className="eko-needsbar__fill"
                  style={{ width: `${v}%` }}
                />
              </span>
            </span>
          );
        })}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} label="Needs">
        <div className="eko-needsbar__sheet">
          <NeedsPanel you={you} sock={sock} />
          <EatTab
            you={you}
            config={config}
            onEat={(f) => sendAct("eat", { item: f.id })}
            onFun={(f) => sendAct("fun", { what: f.id })}
            onStudy={() => sendAct("study")}
          />
        </div>
      </Sheet>
    </>
  );
}
