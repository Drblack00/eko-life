import { useState } from "react";
import { Button, Card, EmptyState, useToast } from "../../components";
import type { GameSocket } from "../../hooks/useGameSocket";
import type { ProfileTarget } from "./ProfileSheet";

/** Friends sub-view: roster, pending requests, add-by-username, block list. */
export function FriendsView({
  sock,
  onOpenProfile,
  onStartDm,
}: {
  sock: GameSocket;
  onOpenProfile: (t: ProfileTarget) => void;
  onStartDm: (playerId: number, username: string) => void;
}) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");

  const add = () => {
    const clean = username.trim();
    if (!clean) return;
    sock.addFriend(clean);
    toast(`🤝 Friend request sent to @${clean}`, "success");
    setUsername("");
  };

  const blockedEntries = Object.entries(sock.blocked);

  return (
    <div className="eko-friends">
      {sock.friendRequests.length > 0 && (
        <section aria-label="Friend requests">
          <h3 className="eko-friends__h">
            Requests ({sock.friendRequests.length})
          </h3>
          {sock.friendRequests.map((r) => (
            <Card key={r.id} className="eko-friendcard">
              <button
                type="button"
                className="eko-friendcard__who"
                onClick={() => onOpenProfile({ playerId: r.id, username: r.username })}
              >
                <span className="eko-friendcard__avatar" aria-hidden="true">
                  {r.username.slice(0, 1).toUpperCase()}
                </span>
                <strong>@{r.username}</strong>
              </button>
              <div className="eko-friendcard__acts">
                <Button size="md" variant="accent" onClick={() => sock.acceptFriend(r.id)}>
                  Accept
                </Button>
                <Button size="md" variant="ghost" onClick={() => sock.declineFriend(r.id)}>
                  Decline
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      <form
        className="eko-friends__add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Add friend by username…"
          maxLength={16}
          aria-label="Add friend by username"
        />
        <Button type="submit" size="md" variant="accent">
          Add
        </Button>
      </form>

      <section aria-label="Friends">
        <h3 className="eko-friends__h">Friends ({sock.friends.length})</h3>
        {sock.friends.length === 0 ? (
          <EmptyState
            emoji="🤝"
            title="No friends yet"
            body="Tap any username in chat or a room and hit Add friend. Friends show up here with their online status."
          />
        ) : (
          sock.friends.map((f) => (
            <Card key={f.id} className="eko-friendcard">
              <button
                type="button"
                className="eko-friendcard__who"
                onClick={() => onOpenProfile({ playerId: f.id, username: f.username })}
              >
                <span
                  className="eko-dot"
                  data-on={f.online ? "1" : "0"}
                  aria-label={f.online ? "online" : "offline"}
                />
                <strong>@{f.username}</strong>
              </button>
              <div className="eko-friendcard__acts">
                <Button size="md" variant="ghost" onClick={() => onStartDm(f.id, f.username)}>
                  💬
                </Button>
                <Button size="md" variant="ghost" onClick={() => sock.removeFriend(f.id)} aria-label={`Remove @${f.username}`}>
                  💔
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      {blockedEntries.length > 0 && (
        <section aria-label="Blocked players">
          <h3 className="eko-friends__h">Blocked ({blockedEntries.length})</h3>
          {blockedEntries.map(([idStr, name]) => {
            const id = Number(idStr);
            return (
              <Card key={idStr} className="eko-friendcard">
                <span className="eko-friendcard__who">
                  <strong>🚫 @{name}</strong>
                </span>
                <Button size="md" variant="ghost" onClick={() => sock.unblockUser(id)}>
                  Unblock
                </Button>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
