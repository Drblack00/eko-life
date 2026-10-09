import { useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, useToast } from "../../components";
import type { GameSocket } from "../../hooks/useGameSocket";
import type { DmThread } from "../../game/types";
import type { ProfileTarget } from "./ProfileSheet";

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Start a DM by username (used when the peer has no thread yet). */
export function startDmWithUsername(
  sock: GameSocket,
  username: string
): { id: number; username: string } | null {
  const clean = username.trim();
  if (!clean) return null;
  const friend = sock.friends.find(
    (f) => f.username.toLowerCase() === clean.toLowerCase()
  );
  if (friend) return { id: friend.id, username: friend.username };
  const online = sock.players.find(
    (p) => (p.name ?? "").toLowerCase() === clean.toLowerCase()
  );
  if (online) return { id: online.id, username: online.name };
  return null;
}

function Conversation({
  peer,
  sock,
  onBack,
  onOpenProfile,
}: {
  peer: { id: number; username: string };
  sock: GameSocket;
  onBack: () => void;
  onOpenProfile: (t: ProfileTarget) => void;
}) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const key = String(peer.id);
  const messages = (sock.dmMessages[key] ?? []).slice(-100);

  useEffect(() => {
    sock.setActiveDm(peer.id);
    sock.requestDmHistory(peer.id);
    sock.readDm(peer.id);
    return () => {
      sock.setActiveDm(null);
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
    if (sock.isBlocked(peer.id)) {
      toast("You've blocked this player. Unblock them to message.", "error");
      return;
    }
    sock.sendDm(peer.id, text);
    setInput("");
  };

  return (
    <div className="eko-dmthread">
      <div className="eko-dmthread__head">
        <button type="button" className="eko-backbtn" onClick={onBack} aria-label="Back to DMs">
          ←
        </button>
        <button
          type="button"
          className="eko-dmthread__name"
          onClick={() => onOpenProfile({ playerId: peer.id, username: peer.username })}
        >
          💬 @{peer.username}
        </button>
      </div>
      <div className="eko-msglist" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="eko-msglist__empty">
            No messages yet — say hello to @{peer.username}. 👋
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`eko-dm ${m.mine ? "eko-dm--mine" : ""}`}>
              <span className="eko-dm__text">{m.text}</span>
              <span className="eko-msg__ts">{timeOf(m.ts)}</span>
            </div>
          ))
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
          placeholder={`Message @${peer.username}…`}
          maxLength={200}
          aria-label={`Message @${peer.username}`}
        />
        <Button type="submit" size="md" disabled={!input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}

/** DMs sub-view: thread list with unread → conversation. */
export function DmsView({
  sock,
  onOpenProfile,
  startWith,
  onStartWithConsumed,
}: {
  sock: GameSocket;
  onOpenProfile: (t: ProfileTarget) => void;
  /** From the profile sheet: jump straight into this peer's conversation. */
  startWith: { id: number; username: string } | null;
  onStartWithConsumed: () => void;
}) {
  const { toast } = useToast();
  const [activePeer, setActivePeer] = useState<{ id: number; username: string } | null>(null);
  const [newUser, setNewUser] = useState("");

  useEffect(() => {
    if (startWith) {
      setActivePeer(startWith);
      onStartWithConsumed();
    }
  }, [startWith, onStartWithConsumed]);

  if (activePeer) {
    return (
      <Conversation
        peer={activePeer}
        sock={sock}
        onBack={() => setActivePeer(null)}
        onOpenProfile={onOpenProfile}
      />
    );
  }

  const openByUsername = () => {
    const found = startDmWithUsername(sock, newUser);
    if (!found) {
      toast(
        "Couldn't find that player — add them as a friend first, or tap their name in chat.",
        "error"
      );
      return;
    }
    setNewUser("");
    setActivePeer(found);
  };

  const sorted = [...sock.dmThreads].sort(
    (a: DmThread, b: DmThread) => (b.lastTs ?? 0) - (a.lastTs ?? 0)
  );

  return (
    <div className="eko-dms">
      <form
        className="eko-dms__new"
        onSubmit={(e) => {
          e.preventDefault();
          openByUsername();
        }}
      >
        <input
          value={newUser}
          onChange={(e) => setNewUser(e.target.value)}
          placeholder="Message @username…"
          maxLength={16}
          aria-label="Start DM by username"
        />
        <Button type="submit" size="md" variant="accent">
          New
        </Button>
      </form>
      {sorted.length === 0 ? (
        <EmptyState
          emoji="💬"
          title="No conversations yet"
          body="Tap a username in city chat or a room to start a private conversation."
        />
      ) : (
        sorted.map((t) => {
          const unread = sock.dmUnreadFor(t.id);
          return (
            <Card key={t.id} className="eko-dmcard">
              <button
                type="button"
                className="eko-dmcard__main"
                onClick={() => setActivePeer({ id: t.id, username: t.username })}
                aria-label={`Open conversation with @${t.username}${unread > 0 ? `, ${unread} unread` : ""}`}
              >
                <span className="eko-dmcard__avatar" aria-hidden="true">
                  {t.username.slice(0, 1).toUpperCase()}
                </span>
                <span className="eko-dmcard__meta">
                  <strong className="eko-dmcard__name">@{t.username}</strong>
                  {t.lastText && (
                    <span className="eko-dmcard__last">{t.lastText.slice(0, 60)}</span>
                  )}
                </span>
                {unread > 0 && (
                  <span className="eko-badge" aria-label={`${unread} unread`}>
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
            </Card>
          );
        })
      )}
    </div>
  );
}
