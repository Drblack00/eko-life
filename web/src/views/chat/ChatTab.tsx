import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, useToast } from "../../components";
import type { GameSocket } from "../../hooks/useGameSocket";
import type { You } from "../../game/types";
import { ProfileSheet, type ProfileTarget } from "./ProfileSheet";
import { RoomsView } from "./RoomsView";
import { DmsView } from "./DmsView";
import { FriendsView } from "./FriendsView";
import "./Chat.css";

type Segment = "city" | "rooms" | "dms" | "friends";

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function CityChat({
  sock,
  onOpenProfile,
}: {
  sock: GameSocket;
  onOpenProfile: (t: ProfileTarget) => void;
}) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const nextAt = useRef(0);
  // Perf: render at most the latest 100 messages.
  const messages = sock.chat.slice(-100);
  const govName = sock.governor?.name ?? null;
  const govId = sock.governor?.id ?? null;

  const send = () => {
    const text = input.trim();
    if (!text) return;
    const now = Date.now();
    if (now < nextAt.current) {
      toast("Slow down — one message every ~1.2s.", "error");
      return;
    }
    nextAt.current = now + 1200;
    sock.sendChat(text);
    setInput("");
    const el = listRef.current;
    if (el) window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  };

  return (
    <div className="eko-citychat">
      <div className="eko-msglist" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <EmptyState
            emoji="🌆"
            title="The plaza is quiet"
            body="Be the first to say something in City Chat — greet the city, find hustle partners, or shout out your room."
          />
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
          placeholder="Say something to the city…"
          maxLength={200}
          aria-label="City chat message"
        />
        <Button type="submit" size="md" disabled={!input.trim()}>
          Send
        </Button>
      </form>
      <p className="eko-chat__hint">
        💬 City Chat is public — one message every ~1.2s. Tap a name for their
        profile, DMs, and safety options.
      </p>
    </div>
  );
}

/**
 * 💬 Chat tab (6th bottom tab): City chat, topic rooms, DMs, and friends.
 */
export function ChatTab({
  sock,
  you,
  token,
}: {
  sock: GameSocket;
  you: You;
  // PORT-P4: social — REST token for group creation + message requests.
  token: string;
}) {
  const [seg, setSeg] = useState<Segment>("city");
  const [profile, setProfile] = useState<ProfileTarget | null>(null);
  const [dmStart, setDmStart] = useState<{ id: number; username: string } | null>(null);

  // M21: notification deep-link — a tapped room notification jumps straight
  // to the rooms segment; RoomsView opens the specific room.
  useEffect(() => {
    if (sock.navRoomId != null) setSeg("rooms");
  }, [sock.navRoomId]);

  const openProfile = (t: ProfileTarget) => setProfile(t);
  const startDm = (playerId: number, username: string) => {
    setProfile(null);
    setDmStart({ id: playerId, username });
    setSeg("dms");
  };

  const roomUnreadTotal = Object.values(sock.roomUnread).reduce(
    (a, b) => a + (b || 0),
    0
  );

  const SEGS: Array<{ id: Segment; label: string; icon: string; badge: number }> = [
    { id: "city", label: "City", icon: "🌆", badge: 0 },
    { id: "rooms", label: "Rooms", icon: "🏘️", badge: roomUnreadTotal },
    { id: "dms", label: "DMs", icon: "💌", badge: sock.dmUnreadTotal },
    {
      id: "friends",
      label: "Friends",
      icon: "🤝",
      badge: sock.friendRequests.length,
    },
  ];

  return (
    <div className="eko-chat">
      <div className="eko-chat__segs" role="tablist" aria-label="Chat sections">
        {SEGS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={seg === s.id}
            className={`eko-chat__seg ${seg === s.id ? "eko-chat__seg--active" : ""}`}
            onClick={() => setSeg(s.id)}
          >
            <span aria-hidden="true">{s.icon}</span> {s.label}
            {s.badge > 0 && (
              <span className="eko-badge" aria-label={`${s.badge} unread`}>
                {s.badge > 99 ? "99+" : s.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {seg === "city" && <CityChat sock={sock} onOpenProfile={openProfile} />}
      {seg === "rooms" && (
        <RoomsView
          youId={you.id}
          sock={sock}
          token={token}
          onOpenProfile={openProfile}
        />
      )}
      {seg === "dms" && (
        <DmsView
          sock={sock}
          token={token}
          onOpenProfile={openProfile}
          startWith={dmStart}
          onStartWithConsumed={() => setDmStart(null)}
        />
      )}
      {seg === "friends" && (
        <FriendsView sock={sock} onOpenProfile={openProfile} onStartDm={startDm} />
      )}

      <ProfileSheet
        open={profile !== null}
        target={profile}
        youId={you.id}
        sock={sock}
        onClose={() => setProfile(null)}
        onStartDm={startDm}
      />
    </div>
  );
}
