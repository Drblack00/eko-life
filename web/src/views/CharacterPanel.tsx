/**
 * Character panel (Phase 2 of the reference audit) — a tabbed dialog opened
 * from the avatar button in the top status pill. Rebuilds the reference's
 * observed 7-tab character dialog (Profile / Needs / Goals / Skills /
 * People / Career / Settings) in original code, every tab wired to a REAL
 * Èkó Life system. Sections without a backing system are omitted, never
 * faked. Reuses Me/Style/phone systems via links — never duplicates them.
 */
import { useEffect, useRef, useState } from "react";
import { Button, Card, Dialog, EmptyState } from "../components";
import { StudioPreview, type StudioPreviewApi } from "./avatar/editor/StudioPreview";
import { buildAvatarLook } from "./avatar/avatarModel";
import { ThemePicker } from "../theme/theme";
import { blip, isSoundEnabled, setSoundEnabled } from "../lib/sound";
import {
  authGet,
  friendsApi,
  profileApi,
  type FriendEntry,
} from "../lib/api";
import {
  NOTIFICATION_PREF_LABELS,
  naira,
  type AvatarLook,
  type NotificationPrefs,
  type You,
} from "../game/types";
import { SKILL_FALLBACK } from "./v2/m12";
import type { ShiftTrackInfo } from "./v2/m7";
import "./CharacterPanel.css";

export type CharacterTabId =
  | "profile"
  | "needs"
  | "goals"
  | "skills"
  | "people"
  | "career"
  | "settings";

const TABS: Array<{ id: CharacterTabId; label: string; icon: string }> = [
  { id: "profile", label: "Profile", icon: "👤" },
  { id: "needs", label: "Needs", icon: "💚" },
  { id: "goals", label: "Goals", icon: "🎯" },
  { id: "skills", label: "Skills", icon: "💪" },
  { id: "people", label: "People", icon: "👥" },
  { id: "career", label: "Career", icon: "💼" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

/* ------------------------------------------------------------------ */
/* Profile tab                                                         */
/* ------------------------------------------------------------------ */

function AvatarPreview3D({ look }: { look: AvatarLook | null | undefined }) {
  const apiRef = useRef<StudioPreviewApi | null>(null);
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const built = buildAvatarLook((look ?? {}) as AvatarLook);
      api.setFigure({ group: built.group, update: built.update });
    } catch {
      /* preview stays empty rather than breaking the panel */
    }
    return () => {
      try {
        apiRef.current?.setFigure(null);
      } catch {
        /* noop */
      }
    };
  }, [look]);
  return (
    <div className="eko-char__preview">
      <StudioPreview
        onApi={(api) => {
          apiRef.current = api;
          if (api) {
            try {
              const built = buildAvatarLook((look ?? {}) as AvatarLook);
              api.setFigure({ group: built.group, update: built.update });
            } catch {
              /* preview stays empty */
            }
          }
        }}
      />
      <p className="eko-char__preview-hint">Drag to spin · pinch to zoom</p>
    </div>
  );
}

function ProfileTab({
  you,
  token,
  onProfileChanged,
  onOpenStyle,
}: {
  you: You;
  token: string;
  onProfileChanged: (patch: { username?: string; name?: string }) => void;
  onOpenStyle: () => void;
}) {
  const [editing, setEditing] = useState<"username" | "name" | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    friendsApi
      .invite(token)
      .then((info) => {
        if (alive && info?.link) setInviteLink(info.link);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);

  const startEdit = (field: "username" | "name") => {
    setEditing(field);
    setValue(field === "username" ? you.username : you.name);
    setError(null);
    blip("tap");
  };

  const save = async () => {
    const v = value.trim();
    if (editing === "username" && !/^[a-zA-Z0-9_]{3,16}$/.test(v)) {
      setError("Username: 3–16 characters, letters, numbers or _.");
      return;
    }
    if (editing === "name" && v.length < 1) {
      setError("Display name can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await profileApi.update(
        token,
        editing === "username" ? { username: v } : { name: v }
      );
      if (r.username) onProfileChanged({ username: r.username });
      if (r.name) onProfileChanged({ name: r.name });
      blip("coin");
      setEditing(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't save — try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      /* clipboard unavailable — user can copy manually */
    }
    setCopied(true);
    blip("coin");
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="eko-char__profile">
      <AvatarPreview3D look={you.avatar_look} />
      <dl className="eko-char__rows">
        <div>
          <dt>Username</dt>
          <dd>
            @{you.username}{" "}
            <button
              type="button"
              className="eko-char__linkbtn"
              onClick={() => startEdit("username")}
            >
              Change
            </button>
          </dd>
        </div>
        {editing === "username" && (
          <div className="eko-char__editrow">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={16}
              aria-label="New username"
              placeholder="3–16 chars, letters, numbers, _"
            />
            <Button size="md" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="md" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        )}
        <div>
          <dt>Display name</dt>
          <dd>
            {you.name}{" "}
            <button
              type="button"
              className="eko-char__linkbtn"
              onClick={() => startEdit("name")}
            >
              Edit
            </button>
          </dd>
        </div>
        {editing === "name" && (
          <div className="eko-char__editrow">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={24}
              aria-label="New display name"
            />
            <Button size="md" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="md" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        )}
        {error && (
          <p className="eko-char__error" role="alert">
            {error}
          </p>
        )}
        {you.email_masked && (
          <div>
            <dt>Email</dt>
            <dd>{you.email_masked}</dd>
          </div>
        )}
        <div>
          <dt>Invite link</dt>
          <dd>
            {inviteLink ? (
              <>
                <span className="eko-char__linktext">{inviteLink}</span>{" "}
                <button
                  type="button"
                  className="eko-char__linkbtn"
                  onClick={copyLink}
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </>
            ) : (
              "Loading…"
            )}
          </dd>
        </div>
      </dl>
      <Button size="md" variant="accent" onClick={onOpenStyle}>
        ✨ Open Style studio
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Needs tab                                                           */
/* ------------------------------------------------------------------ */

interface NeedDef {
  id: string;
  label: string;
  icon: string;
}

const NEED_DEFS: NeedDef[] = [
  { id: "hunger", label: "Hunger", icon: "🍲" },
  { id: "energy", label: "Energy", icon: "⚡" },
  { id: "fun", label: "Fun", icon: "🎮" },
  { id: "social", label: "Social", icon: "🗣️" },
  { id: "hygiene", label: "Hygiene", icon: "🚿" },
  { id: "bladder", label: "Bladder", icon: "🚻" },
];

/** Original wording: how the character feels, from the lowest need. */
export function feelingsLine(lowest: NeedDef): string {
  switch (lowest.id) {
    case "hunger":
      return "Your stomach is filing a complaint — find food soon.";
    case "energy":
      return "You're running on fumes. Rest would do wonders.";
    case "fun":
      return "Boredom is creeping in — go have some fun.";
    case "social":
      return "You're feeling a bit lonely. Gist with someone.";
    case "hygiene":
      return "Nothing beats a good bath.";
    case "bladder":
      return "Nature is calling — find a restroom fast.";
    default:
      return "You're feeling fresh and ready for anything.";
  }
}

/** Original wording: status line from money + happiness. */
export function statusLine(money: number, happiness: number): string {
  if (happiness < 30)
    return "Low Battery — cheer up, the city is still yours.";
  if (money >= 100_000 && happiness >= 70)
    return "Soft Life — Money dey. Enjoyment dey. Life is sweet.";
  if (money >= 20_000) return "Getting There — pocket is warming up.";
  if (money >= 5_000) return "Hustle Mode — every kobo counts.";
  return "Survival Mode — grind now, shine later.";
}

function NeedsTab({ you }: { you: You }) {
  const values = NEED_DEFS.map((d) => ({
    ...d,
    value: Math.max(
      0,
      Math.min(100, Math.round(Number((you as unknown as Record<string, unknown>)[d.id]) || 0))
    ),
  }));
  const lowest = values.reduce((a, b) => (a.value <= b.value ? a : b));
  const allGood = lowest.value >= 70;
  return (
    <div>
      <ul className="eko-char__needs">
        {values.map((n) => (
          <li key={n.id} className="eko-char__need">
            <span className="eko-char__need-icon" aria-hidden="true">
              {n.icon}
            </span>
            <span className="eko-char__need-label">{n.label}</span>
            <span
              className="eko-char__need-bar"
              role="progressbar"
              aria-valuenow={n.value}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${n.label} ${n.value}%`}
            >
              <span
                className={`eko-char__need-fill${n.value < 30 ? " eko-char__need-fill--low" : ""}`}
                style={{ width: `${n.value}%` }}
              />
            </span>
            <span className="eko-char__need-pct">{n.value}%</span>
          </li>
        ))}
      </ul>
      <Card className="eko-char__feelings">
        <p>
          <strong>Feelings:</strong>{" "}
          {allGood
            ? "You're feeling fresh and ready for anything."
            : feelingsLine(lowest)}
        </p>
        <p>
          <strong>Status:</strong> {statusLine(you.money, you.happiness)}
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Goals tab — Today's Hustle (M9) + perks (display only)              */
/* ------------------------------------------------------------------ */

interface Mission {
  id: string;
  label: string;
  reward: number;
  done: boolean;
}

interface Perk {
  id: string;
  name: string;
  icon: string;
  cost: number;
  desc: string;
}

function GoalsTab({
  token,
  you,
  onOpenDaily,
}: {
  token: string;
  you: You;
  onOpenDaily: () => void;
}) {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [stars, setStars] = useState<number>(you.perk_stars ?? 0);
  const [perks, setPerks] = useState<{ owned: string[]; list: Perk[] } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const h = (await authGet("/api/v2/m9/hustle", token)) as {
          missions?: Mission[];
          stars?: number;
        };
        if (!alive) return;
        if (Array.isArray(h?.missions)) setMissions(h.missions);
        if (typeof h?.stars === "number") setStars(h.stars);
      } catch {
        /* hustle stays hidden */
      }
      try {
        const p = (await authGet("/api/v2/m9/perks", token)) as {
          stars?: number;
          owned?: string[];
          perks?: Perk[];
        };
        if (!alive) return;
        if (Array.isArray(p?.perks))
          setPerks({ owned: p.owned ?? [], list: p.perks });
        if (typeof p?.stars === "number") setStars(p.stars);
      } catch {
        /* perks stay hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const done = missions?.filter((m) => m.done).length ?? 0;
  const total = missions?.length ?? 0;

  return (
    <div>
      <Card>
        <h3 className="eko-char__h">🎯 Today's Hustle</h3>
        {missions ? (
          <>
            <p className="eko-char__sub">
              {done}/{total} missions · ⭐ {stars} perk stars
            </p>
            <ul className="eko-char__missions">
              {missions.map((m) => (
                <li key={m.id} className={m.done ? "eko-char__mission--done" : ""}>
                  <span aria-hidden="true">{m.done ? "✅" : "⬜"}</span>
                  <span>{m.label}</span>
                  <span className="eko-char__reward">{naira(m.reward)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="eko-char__sub">Loading today's hustle…</p>
        )}
      </Card>
      <Card>
        <h3 className="eko-char__h">✨ Perks</h3>
        {perks ? (
          <>
            <p className="eko-char__sub">
              {perks.owned.length} unlocked · ⭐ {stars} stars — unlock more in
              Daily.
            </p>
            <ul className="eko-char__perks">
              {perks.list.map((p) => {
                const owned = perks.owned.includes(p.id);
                return (
                  <li key={p.id} className={owned ? "eko-char__perk--owned" : ""}>
                    <span aria-hidden="true">{p.icon}</span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.desc}</small>
                    </span>
                    <span className="eko-char__perk-cost">
                      {owned ? "✓" : `🔒 ${p.cost}✨`}
                    </span>
                  </li>
                );
              })}
            </ul>
            <Button size="md" variant="accent" onClick={onOpenDaily}>
              Open Daily to unlock perks
            </Button>
          </>
        ) : (
          <p className="eko-char__sub">Loading perks…</p>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skills tab — real levels from the `you` snapshot + academy certs     */
/* ------------------------------------------------------------------ */

function SkillsTab({ you }: { you: You }) {
  const skills = you.skills ?? {};
  const certs = you.academy?.certs ?? [];
  return (
    <div>
      {certs.length > 0 && (
        <Card>
          <h3 className="eko-char__h">🎓 Certificates</h3>
          <ul className="eko-char__certs">
            {certs.map((c) => (
              <li key={c}>🎓 {c}</li>
            ))}
          </ul>
        </Card>
      )}
      <ul className="eko-char__skills">
        {SKILL_FALLBACK.map((def) => {
          const s = skills[def.id];
          const level = typeof s?.level === "number" ? s.level : 0;
          const xp = typeof s?.xp === "number" ? s.xp : 0;
          const xpNext = 100 * (level + 1);
          return (
            <li key={def.id} className="eko-char__skill">
              <span className="eko-char__skill-icon" aria-hidden="true">
                {def.icon}
              </span>
              <span className="eko-char__skill-body">
                <span className="eko-char__skill-head">
                  <strong>{def.name}</strong>
                  <span>Lv {level}</span>
                </span>
                <span
                  className="eko-char__need-bar"
                  role="progressbar"
                  aria-valuenow={Math.min(100, Math.round((xp / xpNext) * 100))}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${def.name} experience`}
                >
                  <span
                    className="eko-char__need-fill"
                    style={{ width: `${Math.min(100, (xp / xpNext) * 100)}%` }}
                  />
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="eko-char__tip">
        Train skills at venues around the city — gyms, hubs, clubs and more.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* People tab — friends with online status                              */
/* ------------------------------------------------------------------ */

function PeopleTab({ token }: { token: string }) {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    friendsApi
      .list(token)
      .then((r) => {
        if (alive)
          setFriends(
            (r?.friends ?? []).filter((f) => f.status === "accepted")
          );
      })
      .catch(() => {
        if (alive) setFriends([]);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  if (friends === null)
    return <p className="eko-char__sub">Loading friends…</p>;
  if (friends.length === 0)
    return (
      <EmptyState
        emoji="👥"
        title="No friends yet"
        body="Visit places around town and say hello — friendships start with a greeting."
      />
    );
  return (
    <ul className="eko-char__friends">
      {friends.map((f) => (
        <li key={f.id} className="eko-char__friend">
          <span
            className={`eko-char__dot${f.online ? " eko-char__dot--on" : ""}`}
            aria-hidden="true"
          />
          <strong>@{f.other_username}</strong>
          <span className="eko-char__friend-status">
            {f.online ? "Online now" : "Offline"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Career tab — active shift + career track ladder (real M7 data)       */
/* ------------------------------------------------------------------ */

function CareerTab({
  you,
  token,
  onOpenJobs,
}: {
  you: You;
  token: string;
  onOpenJobs: () => void;
}) {
  const [tracks, setTracks] = useState<ShiftTrackInfo[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/config");
        const j = (await r.json()) as { careerTracks?: ShiftTrackInfo[] };
        if (alive && Array.isArray(j.careerTracks)) setTracks(j.careerTracks);
      } catch {
        /* career ladder stays hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const shift = you.shift;
  const currentTrack = shift?.trackId
    ? tracks?.find((t) => t.id === shift.trackId) ?? null
    : null;

  return (
    <div>
      <Card>
        <h3 className="eko-char__h">💼 Current work</h3>
        {shift ? (
          <dl className="eko-char__rows">
            <div>
              <dt>Shift</dt>
              <dd>{shift.name || shift.job}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>Clocked in — ends {new Date(shift.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd>
            </div>
          </dl>
        ) : (
          <p className="eko-char__sub">
            Not on shift right now. Pick a role below to start earning.
          </p>
        )}
        <Button size="md" variant="accent" onClick={onOpenJobs}>
          Open Jobs
        </Button>
      </Card>
      {currentTrack && (
        <Card>
          <h3 className="eko-char__h">
            {currentTrack.icon ?? "🪜"} {currentTrack.name} — ladder
          </h3>
          <ol className="eko-char__ladder">
            {currentTrack.roles.map((r) => {
              const current = shift?.job === r.id;
              return (
                <li key={r.id} className={current ? "eko-char__ladder--current" : ""}>
                  <span aria-hidden="true">{r.icon ?? "💼"}</span>
                  <span>
                    <strong>{r.name}</strong>
                    {current && <em> — you are here</em>}
                  </span>
                  <span className="eko-char__reward">{naira(r.payPerShift)}/shift</span>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
      {!currentTrack && tracks && tracks.length > 0 && (
        <Card>
          <h3 className="eko-char__h">🪜 Career tracks</h3>
          <ul className="eko-char__tracks">
            {tracks.map((t) => (
              <li key={t.id}>
                <span aria-hidden="true">{t.icon ?? "💼"}</span>
                <span>
                  <strong>{t.name}</strong>
                  <small>
                    {t.roles.length} roles · from{" "}
                    {naira(Math.min(...t.roles.map((r) => r.payPerShift)))}/shift
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings tab — reuses the existing theme picker, sound engine,      */
/* notification prefs, walkthrough replay and sign-out. No invented    */
/* destructive flows (no "log out everywhere" / "new life" in-game).   */
/* ------------------------------------------------------------------ */

function SettingsTab({
  notifPrefs,
  onNotifPrefs,
  onReplayWalkthrough,
  onSignOut,
}: {
  notifPrefs: NotificationPrefs | null;
  onNotifPrefs: (p: Partial<NotificationPrefs>) => void;
  onReplayWalkthrough: () => void;
  onSignOut: () => void;
}) {
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
  const toggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) blip("tap");
  };
  return (
    <div>
      <Card>
        <h3 className="eko-char__h">🖥️ Display</h3>
        <ThemePicker />
        <label className="eko-char__switchrow">
          <span>
            <strong>Sound effects</strong>
            <small>Tap and success sounds</small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={soundOn}
            aria-label="Sound effects"
            className={`eko-switch${soundOn ? " eko-switch--on" : ""}`}
            onClick={toggleSound}
          >
            <span className="eko-switch__knob" aria-hidden="true" />
          </button>
        </label>
      </Card>
      <Card>
        <h3 className="eko-char__h">🔔 Notifications</h3>
        {(Object.keys(NOTIFICATION_PREF_LABELS) as Array<keyof NotificationPrefs>).map(
          (key) => {
            const label = NOTIFICATION_PREF_LABELS[key];
            const on = notifPrefs ? notifPrefs[key] !== false : true;
            return (
              <label key={key} className="eko-char__switchrow">
                <span>
                  <strong>{label.title}</strong>
                  <small>{label.hint}</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={label.title}
                  className={`eko-switch${on ? " eko-switch--on" : ""}`}
                  onClick={() => onNotifPrefs({ [key]: !on })}
                >
                  <span className="eko-switch__knob" aria-hidden="true" />
                </button>
              </label>
            );
          }
        )}
      </Card>
      <Card>
        <h3 className="eko-char__h">❓ Help</h3>
        <Button size="md" variant="ghost" onClick={onReplayWalkthrough}>
          🎬 Replay walkthrough
        </Button>
      </Card>
      <Button variant="ghost" onClick={onSignOut} className="eko-char__signout">
        Log out
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel shell                                                         */
/* ------------------------------------------------------------------ */

export function CharacterPanel({
  open,
  initialTab,
  token,
  you,
  onClose,
  onOpenApp,
  onReplayWalkthrough,
  onSignOut,
  notifPrefs,
  onNotifPrefs,
  onProfileChanged,
}: {
  open: boolean;
  initialTab: CharacterTabId;
  token: string;
  you: You;
  onClose: () => void;
  onOpenApp: (app: string) => void;
  onReplayWalkthrough: () => void;
  onSignOut: () => void;
  notifPrefs: NotificationPrefs | null;
  onNotifPrefs: (p: Partial<NotificationPrefs>) => void;
  onProfileChanged: (patch: { username?: string; name?: string }) => void;
}) {
  const [tab, setTab] = useState<CharacterTabId>(initialTab);

  // Opening the panel always starts on the requested tab.
  useEffect(() => {
    if (open) {
      setTab(initialTab);
      blip("tap");
    }
  }, [open, initialTab]);

  const switchTab = (id: CharacterTabId) => {
    setTab(id);
    blip("tap");
  };

  const goApp = (app: string) => {
    onClose();
    // Let the dialog unmount before the phone sheet opens.
    window.setTimeout(() => onOpenApp(app), 60);
  };

  return (
    <Dialog open={open} onClose={onClose} title="My character">
      <div className="eko-char">
        <div className="eko-char__tabs" role="tablist" aria-label="Character sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`eko-char__tab${tab === t.id ? " eko-char__tab--active" : ""}`}
              onClick={() => switchTab(t.id)}
              title={t.label}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span className="eko-char__tab-label">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="eko-char__body" role="tabpanel">
          {tab === "profile" && (
            <ProfileTab
              you={you}
              token={token}
              onProfileChanged={onProfileChanged}
              onOpenStyle={() => goApp("style")}
            />
          )}
          {tab === "needs" && <NeedsTab you={you} />}
          {tab === "goals" && (
            <GoalsTab token={token} you={you} onOpenDaily={() => goApp("daily")} />
          )}
          {tab === "skills" && <SkillsTab you={you} />}
          {tab === "people" && <PeopleTab token={token} />}
          {tab === "career" && (
            <CareerTab you={you} token={token} onOpenJobs={() => goApp("jobs")} />
          )}
          {tab === "settings" && (
            <SettingsTab
              notifPrefs={notifPrefs}
              onNotifPrefs={onNotifPrefs}
              onReplayWalkthrough={() => {
                onClose();
                window.setTimeout(onReplayWalkthrough, 60);
              }}
              onSignOut={onSignOut}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}
