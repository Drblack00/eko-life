import { useEffect, useState } from "react";
import type { NewsItem, You } from "../../game/types";
import { api, authGet } from "../../lib/api";
import { blip } from "../../lib/sound";
import { moodFor } from "./homeChrome";
import "./Dashboard.css";

/* ------------------------------------------------------------------ */
/* Dashboard — cartoon reference rebuild (2026-10-13): matches the     */
/* approved Home mockup exactly. Top pill (weather/day/mood/money),    */
/* goals card with checklist + stat tiles, 2x2 actions, tip, hustle,   */
/* news cards. All game logic (stats, actions, navigation) preserved.  */
/* ------------------------------------------------------------------ */

/* ---------------- Top pill ---------------- */

function formatNaira(n: number): string {
  return `₦${Math.max(0, Math.round(n || 0)).toLocaleString("en-NG")}`;
}

export function TopPill({
  you,
  day,
  onTopUp,
}: {
  you: You;
  day: number | null;
  onTopUp?: () => void;
}) {
  const mood = moodFor(you.happiness);
  return (
    <div className="db-toppill" role="status" aria-label="Status">
      <span className="db-toppill__weather" aria-hidden="true">
        ☀️
      </span>
      <span className="db-toppill__chunk">
        <strong>Sunny</strong>
        <strong>28°C</strong>
      </span>
      <span className="db-toppill__dot" aria-hidden="true">
        •
      </span>
      <span className="db-toppill__chunk">
        <strong>Day {typeof day === "number" ? day : "–"}</strong>
      </span>
      <span className="db-toppill__dot" aria-hidden="true">
        •
      </span>
      <span className="db-toppill__chunk" aria-hidden="true">
        {mood.emoji}
      </span>
      <span className="db-toppill__chunk">
        <strong>
          Mood:
          <br />
          {mood.label}
        </strong>
      </span>
      <span className="db-toppill__chunk" aria-hidden="true">
        💰
      </span>
      <span className="db-toppill__chunk">
        <strong>{formatNaira(you.money)}</strong>
      </span>
      <button
        type="button"
        className="db-toppill__plus"
        onClick={() => {
          blip("tap");
          onTopUp?.();
        }}
        aria-label="Add money"
      >
        +
      </button>
    </div>
  );
}

/* ---------------- Goals panel (goals + stat tiles) ---------------- */

const GOAL_ITEMS = [
  "Complete 3 daily tasks",
  "Meet Kemi at Yaba market",
  "Upgrade your food stall",
];

const STATS = [
  { id: "energy", label: "Energy", icon: "⚡" },
  { id: "health", label: "Health", icon: "❤️" },
  { id: "happiness", label: "Happy", icon: "😊" },
  { id: "hunger", label: "Hunger", icon: "🍔" },
] as const;

export function GoalsPanel({ you }: { you: You }) {
  return (
    <section className="db-goals" aria-label="Goals">
      <div className="db-goals__head">
        <h3 className="db-goals__title">
          <span aria-hidden="true">🎯</span> Goals
        </h3>
        <span className="db-goals__badge">{GOAL_ITEMS.length} ACTIVE</span>
      </div>
      <ul className="db-goals__list">
        {GOAL_ITEMS.map((g) => (
          <li key={g} className="db-goals__item">
            <span className="db-goals__check" aria-hidden="true">
              ✓
            </span>
            <span className="db-goals__text">{g}</span>
          </li>
        ))}
      </ul>
      <div className="db-stats" role="group" aria-label="Your stats">
        {STATS.map((s) => {
          const v = Math.max(
            0,
            Math.min(100, Math.round(Number(you[s.id]) || 0))
          );
          return (
            <div key={s.id} className="db-stat">
              <span className="db-stat__ico" aria-hidden="true">
                {s.icon}
              </span>
              <span className="db-stat__label">{s.label}</span>
              <span className="db-stat__bar" aria-hidden="true">
                <span
                  className="db-stat__fill"
                  style={{ width: `${v}%` }}
                />
              </span>
              <span className="db-stat__v">{v}</span>
            </div>
          );
        })}
      </div>
    </section>
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
    <div className="db-actions" role="group" aria-label="Quick actions">
      {acts.map((a) => (
        <button
          key={a.id}
          type="button"
          className="db-action"
          onClick={() => {
            blip("tap");
            a.run();
          }}
        >
          <span className="db-action__ico" aria-hidden="true">
            {a.icon}
          </span>
          <span className="db-action__label">{a.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- Tip ---------------- */

interface HustleMission {
  id: string;
  label: string;
  done: boolean;
  claimed: boolean;
}

export function HomeTip({ text, token }: { text: string | null; token: string }) {
  const [sub, setSub] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    authGet("/api/v2/m9/hustle", token)
      .then((h) => {
        const data = h as unknown as {
          missions?: HustleMission[];
        } | null;
        if (!live || !data || !Array.isArray(data.missions)) return;
        const missions = data.missions;
        if (missions.length === 0) return;
        const done = missions.filter((m) => m.done || m.claimed).length;
        const next = missions.find((m) => !m.done && !m.claimed);
        setSub(
          `${next ? next.label : missions[0].label} • ${done} of ${missions.length} completed`
        );
      })
      .catch(() => {
        /* offline — tip still renders */
      });
    return () => {
      live = false;
    };
  }, [token]);
  if (!text && !sub) return null;
  return (
    <div className="db-tip" role="status">
      <span className="db-tip__ico" aria-hidden="true">
        💡
      </span>
      <div className="db-tip__body">
        {text ? (
          <p className="db-tip__main">
            <strong className="db-tip__word">Tip:</strong> {text}
          </p>
        ) : null}
        {sub ? <p className="db-tip__sub">{sub}</p> : null}
      </div>
    </div>
  );
}

/* ---------------- Trending news (reference card style) ---------------- */

function newsIcon(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("fest") || t.includes("party") || t.includes("event"))
    return "📢";
  if (t.includes("road") || t.includes("traffic")) return "📰";
  return "📢";
}

export function TrendingNews({ onOpenGist }: { onOpenGist?: () => void }) {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  useEffect(() => {
    let live = true;
    api
      .news()
      .then((n) => {
        if (live) setItems(n ?? []);
      })
      .catch(() => {
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, []);
  if (!items || items.length === 0) return null;
  const top = items.slice(0, 2);
  return (
    <div className="db-newslist">
      {top.map((n, i) => {
        const text = n.text || "";
        const [title, ...rest] = text.split(/[.!]\s/);
        const subtitle = rest.join(". ").trim();
        return (
          <article key={String(n.id ?? i)} className="db-news">
            <span className="db-news__ico" aria-hidden="true">
              {newsIcon(text)}
            </span>
            <div className="db-news__body">
              <h4 className="db-news__title">{title}</h4>
              {subtitle ? (
                <p className="db-news__sub">{subtitle}</p>
              ) : null}
            </div>
            {onOpenGist ? (
              <button
                type="button"
                className={`db-news__btn ${i === 0 ? "db-news__btn--green" : "db-news__btn--orange"}`}
                onClick={() => {
                  blip("tap");
                  onOpenGist();
                }}
              >
                {i === 0 ? "+Event" : "Info"}
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
