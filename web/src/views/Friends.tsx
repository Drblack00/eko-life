import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, Loading, useToast } from "../components";
import { ApiError, friendsApi, type FriendEntry, type FriendLookup, type InviteInfo } from "../lib/api";
import "./Friends.css";

/**
 * W3 — dedicated Friends page (9th tab).
 * REST-backed: friend requests in/out, add-by-username, friends roster with
 * live online presence, and the invite-link section. Referral attribution is
 * data-only — no coins, no rewards, no payouts anywhere on this page.
 */

/** Build the shareable invite link. Pure (unit-tested). */
export function buildInviteLink(code: string, origin = "https://ekolife.onrender.com"): string {
  return `${origin.replace(/\/$/, "")}/?ref=${code}`;
}

/** Human "last seen" label. Pure (unit-tested). */
export function formatLastSeen(ts: number | null | undefined, online: boolean): string {
  if (online) return "Online now";
  if (!ts) return "Last seen a while ago";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "Active just now";
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `Active ${m}m ago`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return `Active ${h}h ago`;
  }
  const d = Math.floor(s / 86400);
  return `Active ${d}d ago`;
}

function AvatarDot({ entry }: { entry: FriendEntry }) {
  return (
    <span className="eko-fpage__avatar" aria-hidden="true">
      {entry.other_username.slice(0, 1).toUpperCase()}
      <span
        className={`eko-fpage__presence ${entry.online ? "eko-fpage__presence--on" : ""}`}
        title={entry.online ? "Online now" : "Offline"}
      />
    </span>
  );
}

export function FriendsPage({ token }: { token: string }) {
  const { toast } = useToast();
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [incoming, setIncoming] = useState<FriendEntry[]>([]);
  const [outgoing, setOutgoing] = useState<FriendEntry[]>([]);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);

  // add-by-username
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<FriendLookup | null>(null);
  const [looking, setLooking] = useState(false);

  // invite buttons
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [list, reqs, inv] = await Promise.all([
          friendsApi.list(token),
          friendsApi.requests(token),
          friendsApi.invite(token),
        ]);
        if (!mounted.current) return;
        setFriends(list.friends.filter((f) => f.status === "accepted"));
        setIncoming(reqs.incoming);
        setOutgoing(reqs.outgoing);
        setInvite(inv);
      } catch (err) {
        if (!silent && mounted.current) {
          toast(
            err instanceof ApiError ? err.message : "Couldn't load your friends.",
            "error"
          );
        }
      } finally {
        if (!silent && mounted.current) setLoading(false);
      }
    },
    [token, toast]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Refresh presence quietly every 30s (no spinners, no toasts).
  useEffect(() => {
    const t = window.setInterval(() => load(true), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  const errMsg = (err: unknown, fallback: string) =>
    err instanceof ApiError ? err.message : fallback;

  const doLookup = async () => {
    const name = query.trim();
    if (!name) return;
    setLooking(true);
    setLookup(null);
    try {
      const hit = await friendsApi.lookup(token, name);
      if (mounted.current) setLookup(hit);
    } catch (err) {
      if (mounted.current) {
        if (err instanceof ApiError && err.status === 404) {
          toast(`No player found with the username @${name}.`, "error");
        } else {
          toast(errMsg(err, "Lookup failed."), "error");
        }
      }
    } finally {
      if (mounted.current) setLooking(false);
    }
  };

  const sendRequest = async () => {
    if (!lookup || lookup.is_self) return;
    setActing(-1);
    try {
      const res = await friendsApi.sendRequest(token, lookup.username);
      if (res.result === "accepted") {
        toast(`🤝 You and @${lookup.username} are now friends!`, "success");
      } else if (res.result === "exists") {
        toast(`Already connected with @${lookup.username}.`, "info");
      } else {
        toast(`Friend request sent to @${lookup.username}.`, "success");
      }
      setLookup(null);
      setQuery("");
      await load(true);
    } catch (err) {
      toast(errMsg(err, "Couldn't send the request."), "error");
    } finally {
      if (mounted.current) setActing(null);
    }
  };

  const accept = async (id: number, name: string) => {
    setActing(id);
    try {
      await friendsApi.accept(token, id);
      toast(`🤝 You and @${name} are now friends!`, "success");
      await load(true);
    } catch (err) {
      toast(errMsg(err, "Couldn't accept the request."), "error");
    } finally {
      if (mounted.current) setActing(null);
    }
  };

  const decline = async (id: number, name: string) => {
    setActing(id);
    try {
      await friendsApi.decline(token, id);
      toast(`Declined @${name}'s request.`, "info");
      await load(true);
    } catch (err) {
      toast(errMsg(err, "Couldn't decline the request."), "error");
    } finally {
      if (mounted.current) setActing(null);
    }
  };

  const cancel = async (id: number, name: string) => {
    setActing(id);
    try {
      await friendsApi.remove(token, id);
      toast(`Cancelled your request to @${name}.`, "info");
      await load(true);
    } catch (err) {
      toast(errMsg(err, "Couldn't cancel the request."), "error");
    } finally {
      if (mounted.current) setActing(null);
    }
  };

  const unfriend = async (id: number, name: string) => {
    if (!window.confirm(`Remove @${name} from your friends?`)) return;
    setActing(id);
    try {
      await friendsApi.remove(token, id);
      toast(`Removed @${name}.`, "info");
      await load(true);
    } catch (err) {
      toast(errMsg(err, "Couldn't remove them."), "error");
    } finally {
      if (mounted.current) setActing(null);
    }
  };

  const copyLink = async () => {
    const link = invite?.link ?? "";
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Clipboard API unavailable (older iOS / permissions) — fallback.
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* last resort: the link stays visible for manual copy */
      }
      ta.remove();
    }
    setCopied(true);
    toast("Invite link copied — send it anywhere.", "success");
    window.setTimeout(() => mounted.current && setCopied(false), 2000);
  };

  const shareLink = async () => {
    const link = invite?.link ?? "";
    if (!link) return;
    const data = {
      title: "Èkó Life",
      text: "Come live your Lagos story with me on Èkó Life — it's free.",
      url: link,
    };
    if (typeof navigator.share === "function") {
      setSharing(true);
      try {
        await navigator.share(data);
      } catch {
        /* user cancelled the share sheet — not an error */
      } finally {
        if (mounted.current) setSharing(false);
      }
    } else {
      // iOS-friendly fallback: copy to clipboard.
      await copyLink();
    }
  };

  if (loading) {
    return (
      <div className="eko-fpage">
        <Loading message="Loading your circle…" />
      </div>
    );
  }

  return (
    <div className="eko-fpage">
      <header className="eko-fpage__head">
        <h2 className="eko-fpage__title">🤝 Friends</h2>
        <p className="eko-fpage__sub">
          {friends.length === 0
            ? "Your circle starts here."
            : `${friends.length} friend${friends.length === 1 ? "" : "s"} in the city.`}
        </p>
      </header>

      {/* ---- incoming requests ---- */}
      {incoming.length > 0 && (
        <section aria-label="Incoming friend requests" className="eko-fpage__section">
          <h3 className="eko-fpage__h">
            Requests <span className="eko-fpage__badge">{incoming.length}</span>
          </h3>
          {incoming.map((r) => (
            <Card key={r.id} className="eko-fpage__row">
              <AvatarDot entry={r} />
              <div className="eko-fpage__who">
                <strong>@{r.other_username}</strong>
                <span className="eko-fpage__meta">{formatLastSeen(r.last_seen, r.online)}</span>
              </div>
              <div className="eko-fpage__acts">
                <Button
                  size="md"
                  variant="accent"
                  disabled={acting === r.id}
                  onClick={() => accept(r.id, r.other_username)}
                >
                  Accept
                </Button>
                <Button
                  size="md"
                  variant="ghost"
                  disabled={acting === r.id}
                  onClick={() => decline(r.id, r.other_username)}
                >
                  Decline
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {/* ---- add by username ---- */}
      <section aria-label="Add a friend" className="eko-fpage__section">
        <h3 className="eko-fpage__h">Add by username</h3>
        <form
          className="eko-fpage__add"
          onSubmit={(e) => {
            e.preventDefault();
            doLookup();
          }}
        >
          <input
            className="eko-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Exact username, e.g. lagos_hustler"
            maxLength={16}
            autoComplete="off"
            aria-label="Username to add"
          />
          <Button type="submit" size="md" variant="accent" loading={looking}>
            Search
          </Button>
        </form>
        {lookup && (
          <Card className="eko-fpage__row eko-fpage__row--found">
            <span
              className="eko-fpage__avatar"
              style={{ backgroundColor: lookup.color }}
              aria-hidden="true"
            >
              {lookup.avatar}
            </span>
            <div className="eko-fpage__who">
              <strong>@{lookup.username}</strong>
              <span className="eko-fpage__meta">
                {lookup.is_self ? "That's you!" : "Player found"}
              </span>
            </div>
            {!lookup.is_self && (
              <div className="eko-fpage__acts">
                <Button size="md" variant="accent" disabled={acting === -1} onClick={sendRequest}>
                  Send request
                </Button>
              </div>
            )}
          </Card>
        )}
      </section>

      {/* ---- outgoing requests ---- */}
      {outgoing.length > 0 && (
        <section aria-label="Sent requests" className="eko-fpage__section">
          <h3 className="eko-fpage__h">
            Sent <span className="eko-fpage__badge">{outgoing.length}</span>
          </h3>
          {outgoing.map((r) => (
            <Card key={r.id} className="eko-fpage__row">
              <AvatarDot entry={r} />
              <div className="eko-fpage__who">
                <strong>@{r.other_username}</strong>
                <span className="eko-fpage__meta">Waiting for a reply</span>
              </div>
              <div className="eko-fpage__acts">
                <Button
                  size="md"
                  variant="ghost"
                  disabled={acting === r.id}
                  onClick={() => cancel(r.id, r.other_username)}
                >
                  Cancel
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {/* ---- friends roster ---- */}
      <section aria-label="Your friends" className="eko-fpage__section">
        <h3 className="eko-fpage__h">My friends</h3>
        {friends.length === 0 ? (
          <EmptyState
            emoji="👥"
            title="No friends yet"
            body="Search a username above or share your invite link below — the city is better with your people."
          />
        ) : (
          friends.map((f) => (
            <Card key={f.id} className="eko-fpage__row">
              <AvatarDot entry={f} />
              <div className="eko-fpage__who">
                <strong>@{f.other_username}</strong>
                <span className="eko-fpage__meta">{formatLastSeen(f.last_seen, f.online)}</span>
              </div>
              <div className="eko-fpage__acts">
                <Button
                  size="md"
                  variant="ghost"
                  disabled={acting === f.id}
                  onClick={() => unfriend(f.id, f.other_username)}
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      {/* ---- invite ---- */}
      <section aria-label="Invite friends" className="eko-fpage__section">
        <h3 className="eko-fpage__h">Invite friends</h3>
        <Card className="eko-fpage__invite">
          <p className="eko-fpage__invite-text">
            Share your personal link — anyone who signs up with it is counted
            as your invite. No rewards, just bragging rights. 😎
          </p>
          {invite ? (
            <>
              <div className="eko-fpage__linkrow">
                <code className="eko-fpage__link">{invite.link}</code>
              </div>
              <div className="eko-fpage__invite-acts">
                <Button size="md" variant="accent" onClick={copyLink}>
                  {copied ? "✓ Copied!" : "⧉ Copy link"}
                </Button>
                <Button size="md" variant="ghost" loading={sharing} onClick={shareLink}>
                  ↗ Share
                </Button>
              </div>
              <p className="eko-fpage__joined" aria-live="polite">
                <strong>{invite.joined}</strong> friend{invite.joined === 1 ? "" : "s"} joined
                via your link
              </p>
            </>
          ) : (
            <Loading message="Preparing your invite link…" />
          )}
        </Card>
      </section>
    </div>
  );
}
