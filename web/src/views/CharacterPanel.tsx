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
import type { ShiftTrackInfo } from "./v2/m7";
import "./CharacterPanel.css";
// PORT-P1: core loop — begin
import {
  SimNeedsTab,
  SimMoodTab,
  SimSkillsTab,
  SimPerksTab,
  SimGoalsTab,
  SimQuestsTab,
  type SimSend,
} from "./vitality/SimTabs";
// PORT-P1: core loop — end
// PORT-P3: careers — begin
import { careersApi, type CareerStatus } from "./careers/api";
// PORT-P3: careers — end

export type CharacterTabId =
  | "profile"
  | "needs"
  // PORT-P1: core loop — begin
  | "mood"
  // PORT-P1: core loop — end
  | "goals"
  | "skills"
  // PORT-P1: core loop — begin
  | "perks"
  | "quests"
  // PORT-P1: core loop — end
  | "people"
  | "career"
  | "settings";

const TABS: Array<{ id: CharacterTabId; label: string; icon: string }> = [
  { id: "profile", label: "Profile", icon: "👤" },
  { id: "needs", label: "Needs", icon: "💚" },
  // PORT-P1: core loop — begin
  { id: "mood", label: "Mood", icon: "✨" },
  // PORT-P1: core loop — end
  { id: "goals", label: "Goals", icon: "🎯" },
  { id: "skills", label: "Skills", icon: "💪" },
  // PORT-P1: core loop — begin
  { id: "perks", label: "Perks", icon: "💎" },
  { id: "quests", label: "Quests", icon: "🗺️" },
  // PORT-P1: core loop — end
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
// PORT-P3: careers — begin (compact P3 career card for the Sim-panel Career tab)
function P3CareerCard({ token, onOpenJobs }: { token: string; onOpenJobs: () => void }) {
  const [status, setStatus] = useState<CareerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    careersApi
      .me(token)
      .then((st) => alive && setStatus(st))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token]);
  if (!status || !status.employed) return null;
  const st = status;
  const promote = async () => {
    setBusy(true);
    try {
      const r = await careersApi.promote(token);
      setStatus(r.status);
      setMsg(`🎉 Promoted to ${r.newTitle}!`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Promotion failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h3 className="eko-char__h">
        {st.careerIcon ?? "💼"} {st.careerName}
      </h3>
      <dl className="eko-char__rows">
        <div>
          <dt>Rank</dt>
          <dd>
            {st.rankTitle} · {st.rank} of {st.rankOf}
          </dd>
        </div>
        <div>
          <dt>Pay</dt>
          <dd>{naira(st.payPerShift ?? 0)}/shift</dd>
        </div>
        <div>
          <dt>Shifts at rank</dt>
          <dd>
            {st.shiftsAtRank}/{st.shiftsNeeded}
          </dd>
        </div>
        {st.performance !== null && st.performance !== undefined && (
          <div>
            <dt>Performance</dt>
            <dd>{st.performance}%</dd>
          </div>
        )}
        {st.nextRank && (
          <div>
            <dt>Next</dt>
            <dd>
              {st.nextRank.title} · {naira(st.nextRank.payPerShift)}/shift
            </dd>
          </div>
        )}
      </dl>
      {msg && <p className="eko-char__sub">{msg}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {st.promotionReady && (
          <Button size="md" variant="accent" disabled={busy} onClick={() => void promote()}>
            Promote
          </Button>
        )}
        <Button size="md" variant="ghost" onClick={onOpenJobs}>
          Open Careers
        </Button>
      </div>
    </Card>
  );
}
// PORT-P3: careers — end

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
      {/* PORT-P3: careers — begin */}
      <P3CareerCard token={token} onOpenJobs={onOpenJobs} />
      {/* PORT-P3: careers — end */}
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
  // PORT-P1: core loop — begin
  send,
  // PORT-P1: core loop — end
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
  // PORT-P1: core loop — begin
  send?: SimSend;
  // PORT-P1: core loop — end
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
          {tab === "needs" && <SimNeedsTab token={token} />}
          {/* PORT-P1: core loop — begin */}
          {tab === "mood" && <SimMoodTab token={token} />}
          {/* PORT-P1: core loop — end */}
          {tab === "goals" && <SimGoalsTab token={token} />}
          {tab === "skills" && <SimSkillsTab token={token} />}
          {/* PORT-P1: core loop — begin */}
          {tab === "perks" && <SimPerksTab token={token} send={send} />}
          {tab === "quests" && <SimQuestsTab token={token} send={send} />}
          {/* PORT-P1: core loop — end */}
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
