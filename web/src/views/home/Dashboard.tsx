import type { You } from "../../game/types";
import { blip } from "../../lib/sound";

/* ------------------------------------------------------------------ */
/* Dashboard — Home 2 layout (picked 2026-10-12): greeting, 2×2 stat    */
/* cards, one-tap quick actions, then the existing hustle card + room.  */
/* ------------------------------------------------------------------ */

function greetingFor(date: Date): { text: string; emoji: string } {
  const h = date.getHours();
  if (h < 12) return { text: "Good morning", emoji: "☀️" };
  if (h < 17) return { text: "Good afternoon", emoji: "🌤️" };
  return { text: "Good evening", emoji: "🌙" };
}

export function Greeting({
  username,
  day,
}: {
  username: string;
  day: number | null;
}) {
  const now = new Date();
  const g = greetingFor(now);
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  return (
    <div className="eko-dash__greet">
      <h2 className="eko-dash__hello">
        {g.text}, {username} {g.emoji}
      </h2>
      <p className="eko-dash__sub">
        {weekday}
        {typeof day === "number" ? ` · Day ${day} in Èkó` : ""}
      </p>
    </div>
  );
}

/* ---------------- Stat cards ---------------- */

const STATS = [
  { id: "energy", label: "Energy", icon: "⚡", tone: "amber" },
  { id: "health", label: "Health", icon: "❤️", tone: "red" },
  { id: "happiness", label: "Happiness", icon: "😊", tone: "green" },
  { id: "hunger", label: "Hunger", icon: "🍽️", tone: "orange" },
] as const;

function statTone(v: number): string {
  if (v < 25) return "is-low";
  if (v < 55) return "is-mid";
  return "is-high";
}

export function StatCards({ you }: { you: You }) {
  return (
    <div
      className="eko-dash__stats"
      role="group"
      aria-label="Your stats"
    >
      {STATS.map((s) => {
        const v = Math.max(
          0,
          Math.min(100, Math.round(Number(you[s.id]) || 0)),
        );
        return (
          <div
            key={s.id}
            className={`eko-dash__stat glass eko-dash__stat--${s.tone} ${statTone(v)}`}
          >
            <span
              className="eko-dash__stat-ico"
              aria-hidden="true"
            >
              {s.icon}
            </span>
            <span className="eko-dash__stat-body">
              <strong className="eko-dash__stat-val">{v}</strong>
              <span className="eko-dash__stat-label">{s.label}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Quick actions ---------------- */

export function QuickActions({
  onWork,
  onTravel,
  onEat,
  onSleep,
}: {
  onWork: () => void;
  onTravel: () => void;
  onEat: () => void;
  onSleep: () => void;
}) {
  const acts = [
    { id: "work", label: "Work", icon: "💼", run: onWork },
    { id: "travel", label: "Travel", icon: "🚕", run: onTravel },
    { id: "eat", label: "Eat", icon: "🍔", run: onEat },
    { id: "sleep", label: "Sleep", icon: "😴", run: onSleep },
  ];
  return (
    <div className="eko-dash__actions" role="group" aria-label="Quick actions">
      {acts.map((a) => (
        <button
          key={a.id}
          type="button"
          className="eko-dash__action glass"
          onClick={() => {
            blip("tap");
            a.run();
          }}
        >
          <span className="eko-dash__action-ico" aria-hidden="true">
            {a.icon}
          </span>
          <span className="eko-dash__action-label">{a.label}</span>
        </button>
      ))}
    </div>
  );
}
