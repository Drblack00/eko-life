import type { GameSocket } from "../../hooks/useGameSocket";
import type { GameConfig } from "../../lib/api";
import { asList } from "../../lib/api";
import { naira, type ActName, type You } from "../../game/types";
import { Icon, type IconName } from "../../components";
import { GoalsCard } from "./GoalsCard";
import "./Dashboard.css";

/* ------------------------------------------------------------------ */
/* Dashboard — liquid-glass redesign (2026-10-13).
 *
 * Prototype home layout wired to REAL game state only:
 * hero → profile strip → quick-action grid → needs → discover →
 * today's goals → community pulse. No invented numbers: every value
 * comes from the `you` snapshot, the game config, or the socket.
 * ------------------------------------------------------------------ */

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

interface NeedDef {
  id: string;
  label: string;
  icon: IconName;
  value: number;
}

function needsFor(you: You): NeedDef[] {
  const needs: NeedDef[] = [
    { id: "health", label: "Health", icon: "heart-pulse", value: clampPct(you.health) },
    { id: "energy", label: "Energy", icon: "zap", value: clampPct(you.energy) },
    { id: "mood", label: "Mood", icon: "smile", value: clampPct(you.happiness) },
    { id: "hunger", label: "Hunger", icon: "utensils", value: clampPct(you.hunger) },
  ];
  // M8 extended needs — shown only when the server actually tracks them.
  if (typeof you.fun === "number")
    needs.push({ id: "fun", label: "Fun", icon: "sparkles", value: clampPct(you.fun) });
  if (typeof you.social === "number")
    needs.push({ id: "social", label: "Social", icon: "users", value: clampPct(you.social) });
  if (typeof you.hygiene === "number")
    needs.push({ id: "hygiene", label: "Hygiene", icon: "droplet", value: clampPct(you.hygiene) });
  return needs;
}

export interface DashboardProps {
  you: You;
  config: GameConfig;
  token: string;
  sock: GameSocket;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  /** Opens a phone app (jobs, style...). */
  onOpenApp?: (app: string) => void;
  /** Switches the bottom-dock tab. */
  onTab?: (t: "home" | "buy" | "map" | "phone") => void;
  onOpenNotifications?: () => void;
  onTopUp?: () => void;
  tip?: string | null;
}

export function Dashboard({
  you,
  config,
  token,
  sock,
  sendAct,
  onOpenApp,
  onTab,
  onOpenNotifications,
  onTopUp,
  tip,
}: DashboardProps) {
  const greet = greetingFor(new Date());
  const online = sock.status === "open";
  const className = config.classes?.[you.class]?.name ?? you.class ?? "Newcomer";
  const housingName = config.housing?.[you.housing]?.name ?? you.housing ?? "—";
  const district =
    asList(config.locations).find((l) => l.id === you.locationId)?.name ??
    "Somewhere in Lagos";
  const wallet = you.is_admin ? "∞" : naira(you.money);
  const needs = needsFor(you);
  const districts = asList(config.locations).slice(0, 4);
  const goCity = () => onTab?.("map");

  const quick: Array<{
    id: string;
    label: string;
    hint: string;
    icon: IconName;
    run: () => void;
  }> = [
    { id: "explore", label: "Explore", hint: "Find your next stop", icon: "map", run: goCity },
    { id: "style", label: "My style", hint: "Make it yours", icon: "shirt", run: () => onOpenApp?.("style") },
    { id: "jobs", label: "Jobs", hint: "Build your career", icon: "briefcase", run: () => onOpenApp?.("jobs") },
    { id: "phone", label: "My phone", hint: "Your life, connected", icon: "smartphone", run: () => onTab?.("phone") },
  ];

  return (
    <div className="lg-scope">
      {/* Hero */}
      <div className="hero glass">
        <div className="hero-art" role="img" aria-label="Stylised Lagos skyline at dusk" />
        <div>
          <div className="eyebrow">A new day in Lagos</div>
          <h1>
            Your city.
            <br />
            Your story.
          </h1>
          <p>Build your life, meet your people, and find your place in Èkó.</p>
          <div className="hero-actions">
            <button type="button" className="primary" onClick={goCity}>
              <Icon name="play" size={18} />
              Continue playing
            </button>
            <button type="button" className="secondary" onClick={goCity}>
              <Icon name="map" size={18} />
              Explore city
            </button>
          </div>
        </div>
      </div>

      {/* Profile strip — real snapshot data only */}
      <div className="profile-strip glass">
        <div
          className="avatar"
          style={you.color ? { background: you.color } : undefined}
          aria-hidden="true"
        >
          {you.avatar || you.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="profile-main">
          <div className="profile-line">
            <span className="profile-name">
              {greet}, {you.name}
            </span>
            <span className={`pill${online ? "" : " pill--dim"}`}>
              <span aria-hidden="true">●</span> {online ? "Online" : "Offline"}
            </span>
          </div>
          <div className="profile-sub">
            {className} · {housingName}
          </div>
        </div>
        <div className="profile-metrics">
          <div>
            <div className="metric-label">Wallet</div>
            <div className="metric-value">
              {wallet} <small>NGN</small>
            </div>
          </div>
          <div>
            <div className="metric-label">District</div>
            <div className="metric-value" style={{ fontSize: 15 }}>
              {district}
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="section">
        <div className="section-head">
          <h2>Jump back in</h2>
          <span className="muted">Quick access</span>
        </div>
        <div className="quick-grid">
          {quick.map((q) => (
            <button key={q.id} type="button" className="quick" onClick={q.run}>
              <span className="action-icon" aria-hidden="true">
                <Icon name={q.icon} />
              </span>
              <strong>{q.label}</strong>
              <small>{q.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="desktop-dashboard">
        <div>
          {/* Needs — real values from the you snapshot */}
          <div className="section">
            <div className="section-head">
              <h2>Your daily life</h2>
              <button
                type="button"
                className="section-link"
                onClick={() => onOpenApp?.("needs")}
              >
                Manage needs ↗
              </button>
            </div>
            <div className="needs glass">
              {needs.map((n) => (
                <div className="need" key={n.id}>
                  <span className="need-icon" aria-hidden="true">
                    <Icon name={n.icon} />
                  </span>
                  <div>
                    <div className="need-label">{n.label}</div>
                    <div className="bar" role="progressbar" aria-valuenow={n.value} aria-valuemin={0} aria-valuemax={100} aria-label={n.label}>
                      <span style={{ width: `${n.value}%` }} />
                    </div>
                  </div>
                  <span className="need-value">{n.value}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Discover — real districts from the game config */}
          {districts.length > 0 && (
            <div className="section">
              <div className="section-head">
                <h2>Discover Èkó</h2>
                <button type="button" className="section-link" onClick={goCity}>
                  View all ↗
                </button>
              </div>
              <div className="cards">
                {districts.map((d) => (
                  <button key={d.id} type="button" className="discover-card" onClick={goCity}>
                    <div className="discover-art" aria-hidden="true">
                      <Icon name="map-pin" />
                    </div>
                    <div className="discover-copy">
                      <strong>{d.name}</strong>
                      <small>{d.blurb ?? d.zone ?? d.region ?? "Lagos"}</small>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          {/* Today's goals — live hustle data */}
          <div className="section">
            <div className="section-head">
              <h2>Today&apos;s goals</h2>
            </div>
            <GoalsCard token={token} sendAct={sendAct} />
          </div>

          {/* Community pulse — real presence data only */}
          <div className="section">
            <div className="section-head">
              <h2>Community pulse</h2>
            </div>
            <div className="glass feed-item">
              <div className="feed-avatar" aria-hidden="true">
                {String(sock.online).length > 2 ? "◆" : sock.online}
              </div>
              <div>
                <strong style={{ fontSize: 13 }}>The city is awake</strong>
                <div className="muted">
                  Day {sock.day} · {sock.online} player{sock.online === 1 ? "" : "s"} online
                </div>
                <p>
                  {tip ??
                    "Tap a quick action above to get moving — the city rewards the bold."}
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button type="button" className="secondary" onClick={() => onOpenApp?.("chat")}>
                    <Icon name="messages" size={18} />
                    City chat
                  </button>
                  <button type="button" className="secondary" onClick={onOpenNotifications}>
                    <Icon name="bell" size={18} />
                    Notifications
                    {sock.unreadNotifications > 0 ? ` (${sock.unreadNotifications})` : ""}
                  </button>
                  <button type="button" className="secondary" onClick={onTopUp}>
                    <Icon name="wallet" size={18} />
                    Wallet
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
