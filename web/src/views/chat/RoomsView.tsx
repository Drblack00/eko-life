import { useEffect, useRef, useState } from "react";
import { Button, Card, Dialog, EmptyState, useToast } from "../../components";
import type { GameSocket, RoomMembersStatus } from "../../hooks/useGameSocket";
import type { RoomEntry, RoomMember } from "../../game/types";
import type { ProfileTarget } from "./ProfileSheet";
// PORT-P4: social — begin (group creation + member lookup)
import { ApiError, friendsApi, socialApi } from "../../lib/api";
// PORT-P4: social — end

/**
 * Pure member-list view state: the UI must never sit on an infinite spinner.
 * - "loading": fetch in flight (or not yet started)
 * - "error": server stayed silent -> show error + retry
 * - "empty": loaded, nobody in the room
 * - "list": render members
 */
export type RoomMembersView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "list"; members: RoomMember[] };

export function resolveRoomMembersView(
  members: RoomMember[] | undefined,
  status: RoomMembersStatus | undefined
): RoomMembersView {
  if (status === "error") return { kind: "error" };
  if (members !== undefined) {
    if (status === "loaded" || members.length > 0) {
      return members.length === 0 ? { kind: "empty" } : { kind: "list", members };
    }
  }
  return { kind: "loading" };
}

const ROOM_ICONS = ["💬", "🏠", "💼", "🎶", "⚽", "🍲", "📚", "🎮", "🌊", "🔥"];
const MUTE_OPTIONS = [5, 15, 60];

function useThrottle() {
  const { toast } = useToast();
  const nextAt = useRef(0);
  return (fn: () => void) => {
    const now = Date.now();
    if (now < nextAt.current) {
      toast("Slow down — one message every ~1.2s.", "error");
      return;
    }
    nextAt.current = now + 1200;
    fn();
  };
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function RoomThread({
  room,
  youId,
  sock,
  onBack,
  onOpenProfile,
}: {
  room: RoomEntry;
  youId: number;
  sock: GameSocket;
  onBack: () => void;
  onOpenProfile: (t: ProfileTarget) => void;
}) {
  const [input, setInput] = useState("");
  const [membersOpen, setMembersOpen] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [muteTarget, setMuteTarget] = useState<RoomMember | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sendThrottled = useThrottle();
  const key = String(room.id);
  const messages = (sock.roomMessages[key] ?? []).slice(-100);
  const members = sock.roomMembers[key];
  const membersView = resolveRoomMembersView(members, sock.roomMembersStatus?.[key]);
  const isOwner =
    room.ownerId === youId || (members ?? []).some((m) => m.id === youId && m.isOwner);
  const govName = sock.governor?.name ?? null;
  const govId = sock.governor?.id ?? null;

  useEffect(() => {
    sock.setActiveRoom(room.id);
    sock.readRoom(room.id);
    sock.requestRoomMembers(room.id);
    return () => {
      sock.setActiveRoom(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    sendThrottled(() => {
      sock.sendRoomChat(room.id, text);
      setInput("");
    });
  };

  return (
    <div className="eko-roomthread">
      <div className="eko-roomthread__head">
        <button type="button" className="eko-backbtn" onClick={onBack} aria-label="Back to rooms">
          ←
        </button>
        <span className="eko-roomthread__icon" aria-hidden="true">
          {room.icon ?? "💬"}
        </span>
        <div className="eko-roomthread__title">
          <strong>{room.name}</strong>
          {room.topic && <span className="eko-roomthread__topic">{room.topic}</span>}
        </div>
        <button
          type="button"
          className="eko-backbtn"
          onClick={() => setMembersOpen((v) => !v)}
          aria-label="Room members"
          aria-expanded={membersOpen}
        >
          👥
        </button>
        <button
          type="button"
          className="eko-backbtn eko-backbtn--danger"
          onClick={() => setLeaveAsk(true)}
          aria-label="Leave room"
        >
          🚪
        </button>
      </div>

      {membersOpen && (
        <div className="eko-roomthread__members">
          <h3 className="eko-roomthread__members-h">
            Members (
            {membersView.kind === "list"
              ? membersView.members.length
              : membersView.kind === "empty"
                ? 0
                : "…"}
            ) {isOwner && "— you run this room 👑"}
          </h3>
          {membersView.kind === "loading" && (
            <p className="eko-roomthread__note">Loading members…</p>
          )}
          {membersView.kind === "error" && (
            <div className="eko-roomthread__note">
              <p>Couldn't load members.</p>
              <Button size="md" variant="ghost" onClick={() => sock.requestRoomMembers(room.id)}>
                🔄 Retry
              </Button>
            </div>
          )}
          {membersView.kind === "empty" && (
            <p className="eko-roomthread__note">No members yet.</p>
          )}
          {membersView.kind === "list" &&
            membersView.members.map((m) => (
              <div key={m.id} className="eko-roomthread__member">
                <span className="eko-dot eko-dot--sm" data-on={m.online ? "1" : "0"} aria-hidden="true" />
                <button
                  type="button"
                  className="eko-msg__name"
                  onClick={() => onOpenProfile({ playerId: m.id, username: m.username })}
                >
                  @{m.username}
                </button>
                {m.isOwner && <span aria-label="owner">👑</span>}
                {m.muted && <span aria-label="muted">🔇</span>}
                {isOwner && m.id !== youId && (
                  <span className="eko-roomthread__mod">
                    <button
                      type="button"
                      onClick={() => setMuteTarget(m)}
                      aria-label={`Mute @${m.username}`}
                    >
                      🔇
                    </button>
                    <button
                      type="button"
                      onClick={() => sock.kickRoomMember(room.id, m.id)}
                      aria-label={`Kick @${m.username}`}
                    >
                      🥾
                    </button>
                  </span>
                )}
              </div>
            ))}
        </div>
      )}

      <div className="eko-msglist" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="eko-msglist__empty">No messages yet — say hello! 👋</p>
        ) : (
          messages.map((m) => {
            // Server flags governor messages (`gov:true`); fall back to a
            // name/id match against the known governor.
            const isGov =
              m.gov === true ||
              (govId !== null && m.senderId === govId) ||
              (govName !== null && m.name === govName);
            return (
              <div key={m.id} className="eko-msg">
                <button
                  type="button"
                  className="eko-msg__name"
                  onClick={() =>
                    m.senderId != null
                      ? onOpenProfile({ playerId: m.senderId, username: m.name })
                      : undefined
                  }
                >
                  {isGov && "👑 "}@{m.name}
                </button>
                <span className="eko-msg__text">{m.text}</span>
                <span className="eko-msg__ts">{timeOf(m.ts)}</span>
              </div>
            );
          })
        )}
      </div>

      <form
        className="eko-inputbar"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Message ${room.name}…`}
          maxLength={200}
          aria-label={`Message ${room.name}`}
        />
        <Button type="submit" size="md" disabled={!input.trim()}>
          Send
        </Button>
      </form>

      <Dialog open={leaveAsk} onClose={() => setLeaveAsk(false)} title={`Leave ${room.name}?`}>
        <p className="eko-profile__dialog-text">You'll stop getting its messages.</p>
        <div className="eko-profile__dialog-actions">
          <Button variant="ghost" onClick={() => setLeaveAsk(false)}>
            Stay
          </Button>
          <Button
            onClick={() => {
              sock.leaveRoom(room.id);
              setLeaveAsk(false);
              onBack();
            }}
          >
            Leave
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={muteTarget !== null}
        onClose={() => setMuteTarget(null)}
        title={muteTarget ? `Mute @${muteTarget.username}` : "Mute"}
      >
        <p className="eko-profile__dialog-text">How long should they stay muted?</p>
        <div className="eko-profile__dialog-actions">
          <Button variant="ghost" onClick={() => setMuteTarget(null)}>
            Cancel
          </Button>
          {MUTE_OPTIONS.map((min) => (
            <Button
              key={min}
              onClick={() => {
                if (muteTarget) sock.muteRoomMember(room.id, muteTarget.id, min);
                setMuteTarget(null);
              }}
            >
              {min}m
            </Button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

function CreateRoomDialog({
  open,
  sock,
  onClose,
}: {
  open: boolean;
  sock: GameSocket;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [icon, setIcon] = useState(ROOM_ICONS[0]);
  const create = () => {
    const clean = name.trim();
    if (!clean) {
      toast("Give your room a name first.", "error");
      return;
    }
    sock.createRoom(clean, topic.trim(), icon);
    setName("");
    setTopic("");
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title="Create a room">
      <div className="eko-createroom">
        <div className="eko-createroom__icons">
          {ROOM_ICONS.map((ic) => (
            <button
              key={ic}
              type="button"
              className={`eko-createroom__icon ${icon === ic ? "eko-createroom__icon--active" : ""}`}
              onClick={() => setIcon(ic)}
              aria-pressed={icon === ic}
            >
              {ic}
            </button>
          ))}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Room name (e.g. Hustle Talk)"
          maxLength={40}
          aria-label="Room name"
        />
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic — what is this room for?"
          maxLength={120}
          aria-label="Room topic"
        />
        <div className="eko-profile__dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create}>Create room</Button>
        </div>
      </div>
    </Dialog>
  );
}

// PORT-P4: social — begin (group icon picker: 16 emoji, mirrors server GROUP_ICONS)
export const GROUP_ICONS = [
  "💬", "🏠", "💼", "🎶", "⚽", "🍲", "📚", "🎮",
  "🌊", "🔥", "🚗", "💰", "🎓", "🏋️", "🎬", "🌴",
];

/** Pure validation for the group-create form (unit-tested). */
export function groupCreateValid(name: string, members: string[]): boolean {
  return name.trim().length >= 2 && members.length >= 1;
}

/**
 * Create-group dialog: name + 16-emoji icon picker + add members by
 * username (exact lookup). Create stays disabled until the name and at
 * least one valid member are set. Groups are private rooms — chat itself
 * keeps flowing over the realtime socket after creation.
 */
function CreateGroupDialog({
  open,
  token,
  sock,
  onClose,
}: {
  open: boolean;
  token: string;
  sock: GameSocket;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(GROUP_ICONS[0]);
  const [memberInput, setMemberInput] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [looking, setLooking] = useState(false);
  const [creating, setCreating] = useState(false);

  const canCreate = groupCreateValid(name, members) && !creating;

  const addMember = async () => {
    const uname = memberInput.trim().replace(/^@/, "");
    if (!uname || looking) return;
    if (members.some((m) => m.toLowerCase() === uname.toLowerCase())) {
      toast("Already in the member list.", "error");
      return;
    }
    setLooking(true);
    try {
      const found = await friendsApi.lookup(token, uname);
      if (found.is_self) {
        toast("That's you — you're in automatically.", "error");
        return;
      }
      setMembers((prev) => [...prev, found.username]);
      setMemberInput("");
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "No player found with that username.",
        "error"
      );
    } finally {
      setLooking(false);
    }
  };

  const removeMember = (uname: string) =>
    setMembers((prev) => prev.filter((m) => m !== uname));

  const create = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const clean = name.trim();
      await socialApi.createGroup(token, { name: clean, icon, members });
      toast(`Group "${clean}" created — say hi.`, "success");
      sock.sendSocial("rooms");
      setName("");
      setIcon(GROUP_ICONS[0]);
      setMembers([]);
      setMemberInput("");
      onClose();
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "Couldn't create the group.",
        "error"
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Create a group">
      <div className="eko-createroom">
        <div
          className="eko-createroom__icons"
          role="radiogroup"
          aria-label="Group icon"
        >
          {GROUP_ICONS.map((ic) => (
            <button
              key={ic}
              type="button"
              className={`eko-createroom__icon ${
                icon === ic ? "eko-createroom__icon--active" : ""
              }`}
              onClick={() => setIcon(ic)}
              aria-pressed={icon === ic}
              aria-label={`Group icon ${ic}`}
            >
              {ic}
            </button>
          ))}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name (e.g. Owambe Gang)"
          maxLength={32}
          aria-label="Group name"
        />
        <div className="eko-createroom__memberadd">
          <input
            value={memberInput}
            onChange={(e) => setMemberInput(e.target.value)}
            placeholder="Add by username, e.g. @tobi"
            maxLength={16}
            aria-label="Add member by username"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addMember();
              }
            }}
          />
          <Button
            size="md"
            variant="ghost"
            onClick={() => void addMember()}
            loading={looking}
            disabled={!memberInput.trim()}
          >
            Add
          </Button>
        </div>
        {members.length > 0 && (
          <div className="eko-createroom__chips" aria-label="Members">
            {members.map((m) => (
              <span key={m} className="eko-createroom__chip">
                @{m}
                <button
                  type="button"
                  onClick={() => removeMember(m)}
                  aria-label={`Remove @${m}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <p className="eko-chat__hint">
          Private to members. Create needs a name and at least one member.
        </p>
        <div className="eko-profile__dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={!canCreate} loading={creating}>
            Create group
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
// PORT-P4: social — end

/** Rooms sub-view: list with unread badges → thread view. */
export function RoomsView({
  youId,
  sock,
  token,
  onOpenProfile,
}: {
  youId: number;
  sock: GameSocket;
  // PORT-P4: social — REST token for group creation.
  token: string;
  onOpenProfile: (t: ProfileTarget) => void;
}) {
  const [activeId, setActiveId] = useState<string | number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // PORT-P4: social — begin
  const [groupOpen, setGroupOpen] = useState(false);
  // PORT-P4: social — end

  // M21: notification deep-link — open the tapped room, then clear the nav.
  useEffect(() => {
    if (sock.navRoomId != null) {
      setActiveId(sock.navRoomId);
      sock.clearRoomNav();
    }
  }, [sock.navRoomId, sock]);

  const activeRoom = sock.rooms.find((r) => String(r.id) === String(activeId)) ?? null;
  if (activeRoom) {
    return (
      <RoomThread
        room={activeRoom}
        youId={youId}
        sock={sock}
        onBack={() => setActiveId(null)}
        onOpenProfile={onOpenProfile}
      />
    );
  }

  return (
    <div className="eko-rooms">
      <div className="eko-rooms__actions">
        <Button size="md" variant="accent" onClick={() => setCreateOpen(true)}>
          ➕ Create room
        </Button>
        {/* PORT-P4: social — private groups with member invites */}
        <Button size="md" variant="accent" onClick={() => setGroupOpen(true)}>
          👯 New group
        </Button>
        <Button size="md" variant="ghost" onClick={() => sock.sendSocial("rooms")}>
          🔄 Refresh
        </Button>
      </div>
      {sock.rooms.length === 0 ? (
        <EmptyState
          emoji="💬"
          title="No rooms yet"
          body="Topic rooms are where the city's conversations live — hustle talk, market deals, street gist. Create the first one."
        />
      ) : (
        sock.rooms.map((r) => {
          const unread = sock.roomUnread[String(r.id)] ?? r.unread ?? 0;
          const joined = r.joined === true;
          return (
            <Card key={String(r.id)} className="eko-roomcard">
              <div className="eko-roomcard__row">
                <button
                  type="button"
                  className="eko-roomcard__main"
                  onClick={() => joined && setActiveId(r.id)}
                  aria-label={
                    joined
                      ? `Open ${r.name}${unread > 0 ? `, ${unread} unread` : ""}`
                      : `${r.name} — join to open`
                  }
                >
                  <span className="eko-roomcard__icon" aria-hidden="true">
                    {r.icon ?? "💬"}
                  </span>
                  <span className="eko-roomcard__meta">
                    <strong className="eko-roomcard__name">{r.name}</strong>
                    {r.topic && <span className="eko-roomcard__topic">{r.topic}</span>}
                    {typeof r.members === "number" && (
                      <span className="eko-roomcard__count">👥 {r.members}</span>
                    )}
                  </span>
                  {joined && unread > 0 && (
                    <span className="eko-badge" aria-label={`${unread} unread`}>
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </button>
                {!joined && (
                  <Button
                    size="md"
                    variant="accent"
                    onClick={() => sock.joinRoom(r.id)}
                    aria-label={`Join ${r.name}`}
                  >
                    Join
                  </Button>
                )}
              </div>
            </Card>
          );
        })
      )}
      <CreateRoomDialog open={createOpen} sock={sock} onClose={() => setCreateOpen(false)} />
      {/* PORT-P4: social — group creation (name + icon + members) */}
      <CreateGroupDialog
        open={groupOpen}
        token={token}
        sock={sock}
        onClose={() => setGroupOpen(false)}
      />
    </div>
  );
}
