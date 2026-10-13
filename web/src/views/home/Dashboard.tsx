import { useEffect, useState } from "react";
import type { NewsItem, You } from "../../game/types";
import { api } from "../../lib/api";
import { blip } from "../../lib/sound";
import "./Dashboard.css";

/* ------------------------------------------------------------------ */
/* Dashboard — G1 "Ocean Glass" (picked 2026-10-12): liquid-glass hero, */
/* progress-ring stats (shown once), glass quick actions, tip, hustle, */
/* trending news. Room editor lives in the Phone app now.              */
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
  online,
  onWallet,
  onBell,
  onGov,
  hasUnread,
}: {
  username: string;
  day: number | null;
  online?: number;
  onWallet?: () => void;
  onBell?: () => void;
  onGov?: () => void;
  hasUnread?: boolean;
}) {
  const now = new Date();
  const g = greetingFor(now);
  const weekday = now.toLocaleDateString(undefined, { weekday: "long" });
  return (
    <div className="oglass og-hero">
      <div className="og-hero__top">
        <div className="og-avatar" aria-hidden="true">
          😎
        </div>
        <div className="og-hero__who">
          <div className="og-hero__name">{username}</div>
          <div className="og-hero__sub">
            🟢 {typeof online === "number" ? online : 0} online
          </div>
        </div>
        <div className="og-hero__icons">
          <button
            type="button"
            className="og-icobtn"
            onClick={() => {
              blip("tap");
              onWallet?.();
            }}
            aria-label="Wallet"
          >
            ∞
          </button>
          <button
            type="button"
            className="og-icobtn"
            onClick={() => {
              blip("tap");
              onBell?.();
            }}
            aria-label="Notifications"
          >
            🔔{hasUnread ? <span className="og-dot" /> : null}
          </button>
          <button
            type="button"
            className="og-icobtn"
            onClick={() => {
              blip("tap");
              onGov?.();
            }}
            aria-label="Government"
          >
            🏛️
          </button>
        </div>
      </div>
      <div className="og-hero__greet">
        <h2>
          {g.text} {g.emoji}
        </h2>
        <p>
          {weekday}
          {typeof day === "number" ? ` · Day ${day} in Èkó` : ""}
        </p>
      </div>
    </div>
  );
}

/* ---------------- Stat rings (shown once) ---------------- */

const STATS = [
  { id: "energy", label: "Energy", icon: "⚡", color: "#06d6a0" },
  { id: "health", label: "Health", icon: "❤️", color: "#ff6b8a" },
  { id: "happiness", label: "Happiness", icon: "😊", color: "#ffd166" },
  { id: "hunger", label: "Hunger", icon: "🍽️", color: "#ff9f1c" },
] as const;

function Ring({ value, color }: { value: number; color: string }) {
  const r = 21;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <span className="og-ring" aria-hidden="true">
      <svg width="50" height="50" viewBox="0 0 50 50">
        <circle
          cx="25"
          cy="25"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="6"
        />
        <circle
          cx="25"
          cy="25"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          transform="rotate(-90 25 25)"
        />
      </svg>
      <span className="og-ring__v">{value}</span>
    </span>
  );
}

export function StatRings({ you }: { you: You }) {
  return (
    <div className="og-stats" role="group" aria-label="Your stats">
      {STATS.map((s) => {
        const v = Math.max(0, Math.min(100, Math.round(Number(you[s.id]) || 0)));
        return (
          <div key={s.id} className="oglass og-stat">
            <Ring value={v} color={s.color} />
            <span className="og-stat__label">
              {s.icon} {s.label}
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
    <div className="og-actions" role="group" aria-label="Quick actions">
      {acts.map((a) => (
        <button
          key={a.id}
          type="button"
          className="oglass og-action"
          onClick={() => {
            blip("tap");
            a.run();
          }}
        >
          <span className="og-action__ico" aria-hidden="true">
            {a.icon}
          </span>
          <span className="og-action__label">{a.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- Tip ---------------- */

export function HomeTip({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="oglass og-tip" role="status">
      <span aria-hidden="true">💡</span>
      <span>{text}</span>
    </div>
  );
}

/* ---------------- Trending news ---------------- */

function timeAgo(ts?: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
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
  const top = items.slice(0, 4);
  return (
    <section className="og-news" aria-label="Trending news">
      <div className="og-news__head">
        <h3>🔥 Trending in Èkó</h3>
        {onOpenGist ? (
          <button
            type="button"
            className="og-news__more"
            onClick={() => {
              blip("tap");
              onOpenGist();
            }}
          >
            More ›
          </button>
        ) : null}
      </div>
      <div className="og-news__list">
        {top.map((n, i) => (
          <article key={String(n.id ?? i)} className="oglass og-news__item">
            <span className="og-news__rank">{i + 1}</span>
            <p className="og-news__text">{n.text}</p>
            {n.ts ? (
              <time className="og-news__time">{timeAgo(n.ts)} ago</time>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
