import { useEffect, useMemo, useState } from "react";
import { Button, Card, Dialog, EmptyState } from "../../../components";
import "./m7.css";

/* ---------- local types (mirror of server CAREER_TRACKS, display only —
   the server is authoritative for every check) ---------- */
export interface ShiftRoleInfo {
  id: string;
  trackId: string;
  name: string;
  locationId: string;
  payPerShift: number;
  energyCost: number;
  icon?: string;
  skillGate?: { skill: string; level: number };
  certRequired?: boolean;
}
export interface ShiftTrackInfo {
  id: string;
  name: string;
  path?: string;
  icon?: string;
  blurb?: string;
  tier: "entry" | "mid";
  roles: ShiftRoleInfo[];
}
export interface ActiveShift {
  job: string;
  name?: string;
  endsAt: number;
}
export interface JobsTabYou {
  money: number;
  energy: number;
  cert?: number | boolean;
  class?: string;
  locationId?: string;
  skills?: Record<string, number | { level?: number; xp?: number }> | string | null;
  shift?: ActiveShift | null;
}
export interface JobsTabProps {
  you: JobsTabYou;
  /** raw WS sender, e.g. (msg) => socket.send(JSON.stringify(msg)) */
  send: (msg: Record<string, unknown>) => void;
  /** from init.config.careerTracks (coordinator merges CONFIG_DATA); falls back to /api/config */
  careerTracks?: ShiftTrackInfo[];
  skillLabels?: Record<string, string>;
  locationName?: (id: string) => string;
}

const SHIFT_SECONDS = 3600;

const naira = (n: number) => "₦" + Number(n).toLocaleString("en-NG");

function skillLevel(you: JobsTabYou, skill: string): number {
  try {
    const s = you.skills;
    const obj = typeof s === "string" ? JSON.parse(s || "{}") : s || {};
    const raw = obj[skill];
    // Server shape is { level, xp }; legacy callers may pass a bare number.
    const v = Number(raw && typeof raw === "object" ? raw.level : raw);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

function fmtCountdown(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

type GateState =
  | { ok: true }
  | { ok: false; reason: string };

function gateFor(you: JobsTabYou, role: ShiftRoleInfo, onShift: boolean, locName: (id: string) => string): GateState {
  if (onShift) return { ok: false, reason: "On shift" };
  if (you.locationId !== role.locationId)
    return { ok: false, reason: `📍 ${locName(role.locationId)}` };
  if (role.certRequired && !Number(you.cert))
    return { ok: false, reason: "🎓 Certificate needed" };
  if (role.skillGate) {
    const lvl = skillLevel(you, role.skillGate.skill);
    if (lvl < role.skillGate.level)
      return { ok: false, reason: `${role.skillGate.skill} Lv ${role.skillGate.level} needed` };
  }
  if (Number(you.energy) < role.energyCost) return { ok: false, reason: "Too tired" };
  return { ok: true };
}

export function JobsTab({ you, send, careerTracks: propTracks, skillLabels, locationName }: JobsTabProps) {
  const [fetched, setFetched] = useState<ShiftTrackInfo[] | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const tracks = propTracks ?? fetched;

  // Fallback: pull careerTracks from /api/config when the coordinator
  // hasn't passed them as a prop.
  useEffect(() => {
    if (propTracks) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/config");
        if (!r.ok) return;
        const j = (await r.json()) as { careerTracks?: ShiftTrackInfo[] };
        if (alive && Array.isArray(j.careerTracks)) setFetched(j.careerTracks);
      } catch {
        /* empty state covers the failure */
      }
    })();
    return () => {
      alive = false;
    };
  }, [propTracks]);

  // Local 1s countdown ticker for the active shift (display only).
  const shift = you.shift ?? null;
  useEffect(() => {
    if (!shift) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [shift?.job, shift?.endsAt]);

  const locName = (id: string) => (locationName ? locationName(id) : id);

  const { entryTracks, midTracks } = useMemo(() => {
    const list = tracks ?? [];
    return {
      entryTracks: list.filter((t) => t.tier === "entry"),
      midTracks: list.filter((t) => t.tier !== "entry"),
    };
  }, [tracks]);

  if (!tracks) {
    return (
      <div className="m7-wrap">
        <EmptyState emoji="💼" title="Loading jobs…" />
      </div>
    );
  }

  const onShift = !!shift;
  const secondsLeft = shift ? Math.max(0, Math.ceil((shift.endsAt - now) / 1000)) : 0;
  const progress = shift ? Math.min(1, Math.max(0, 1 - secondsLeft / SHIFT_SECONDS)) : 0;

  const renderRole = (role: ShiftRoleInfo) => {
    const gate = gateFor(you, role, onShift, locName);
    const skillLabel =
      role.skillGate != null
        ? (skillLabels?.[role.skillGate.skill] ?? role.skillGate.skill)
        : null;
    return (
      <div key={role.id} className="m7-role">
        <div className="m7-role__main">
          <span className="m7-role__icon" aria-hidden="true">{role.icon ?? "💼"}</span>
          <div className="m7-role__text">
            <div className="m7-role__name">{role.name}</div>
            <div className="m7-role__meta">
              <span className="m7-role__pay">{naira(role.payPerShift)}/shift</span>
              <span className="m7-role__cost">⚡{role.energyCost}</span>
              {role.certRequired && <span className="m7-chip">🎓 cert</span>}
              {role.skillGate && (
                <span className="m7-chip">
                  {skillLabel} Lv {role.skillGate.level}
                  {skillLevel(you, role.skillGate.skill) >= role.skillGate.level ? " ✓" : ""}
                </span>
              )}
            </div>
            {!gate.ok && <div className="m7-role__gate">{gate.reason}</div>}
          </div>
        </div>
        <Button
          variant={gate.ok ? "primary" : "ghost"}
          disabled={!gate.ok}
          onClick={() => send({ t: "act", a: "shift_start", job: role.id })}
          title={gate.ok ? undefined : gate.reason}
          aria-label={gate.ok ? `Clock in as ${role.name}` : `${role.name}: ${gate.reason}`}
        >
          {gate.ok ? "Clock in" : "🔒"}
        </Button>
      </div>
    );
  };

  const renderTrack = (track: ShiftTrackInfo) => (
    <Card key={track.id} className="m7-track">
      <div className="m7-track__head">
        <span className="m7-track__icon" aria-hidden="true">{track.icon ?? "💼"}</span>
        <div>
          <div className="m7-track__name">{track.name}</div>
          {track.blurb && <div className="m7-track__blurb">{track.blurb}</div>}
        </div>
      </div>
      <div className="m7-track__roles">{track.roles.map(renderRole)}</div>
    </Card>
  );

  return (
    <div className="m7-wrap">
      {shift && (
        <Card className="m7-shift" elevated>
          <div className="m7-shift__head">
            <span aria-hidden="true">⏰</span>
            <div>
              <div className="m7-shift__title">On shift{shift.name ? `: ${shift.name}` : ""}</div>
              <div className="m7-shift__time" role="timer">
                {secondsLeft > 0 ? `${fmtCountdown(secondsLeft)} left` : "Finishing…"}
              </div>
            </div>
          </div>
          <div
            className="m7-shift__bar"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Shift progress"
          >
            <div className="m7-shift__fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <Button variant="danger" onClick={() => setConfirmLeave(true)}>
            Leave shift
          </Button>
        </Card>
      )}

      <h2 className="m7-section">Entry roles</h2>
      {entryTracks.length === 0 && <EmptyState emoji="🔍" title="No entry roles found" />}
      {entryTracks.map(renderTrack)}

      <h2 className="m7-section">Mid-tier roles</h2>
      <p className="m7-note">Gated by skills or certificates — train up to unlock bigger pay.</p>
      {midTracks.length === 0 && <EmptyState emoji="🔍" title="No mid-tier roles found" />}
      {midTracks.map(renderTrack)}

      <Dialog open={confirmLeave} onClose={() => setConfirmLeave(false)} title="Leave shift?">
        <p className="m7-dialog__text">
          Leaving early <strong>forfeits the whole shift — you earn nothing</strong> for the
          time worked. Stick it out to get paid.
        </p>
        <div className="m7-dialog__actions">
          <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
            Keep working
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmLeave(false);
              send({ t: "act", a: "shift_leave" });
            }}
          >
            Leave — forfeit pay
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
