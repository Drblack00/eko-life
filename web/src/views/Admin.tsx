import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminApi, ApiError, type AdminPlayer } from "../lib/api";
import { naira } from "../game/types";
import { Button, Card, Dialog, EmptyState, Loading, useToast } from "../components";
import { BillboardsManager } from "./v2/m13/BillboardsAdmin";
import "./v2/m13/m13.css";
import "./Admin.css";

type ConfirmKind = "ban" | "unban" | "makeAdmin";

/** Friendly error for admin calls: 403 → "Admins only", 404 → not live yet. */
function adminErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "Admins only — this account isn't an admin.";
    if (err.status === 404)
      return "Admin tools aren't live on this server yet. (The server team is still shipping the M4 admin endpoints.)";
    return err.message;
  }
  return "Couldn't reach the city. Check your connection and try again.";
}

function StatusFlags({ p }: { p: AdminPlayer }) {
  return (
    <span className="eko-admin__flags">
      <span
        className={`eko-admin__dot ${p.online ? "eko-admin__dot--on" : ""}`}
        role="img"
        aria-label={p.online ? "Online" : "Offline"}
        title={p.online ? "Online" : "Offline"}
      />
      {p.banned && <span className="eko-admin__flag eko-admin__flag--banned">Banned</span>}
      {p.is_admin && <span className="eko-admin__flag eko-admin__flag--admin">Admin</span>}
    </span>
  );
}

export function AdminView({
  token,
  onBack,
}: {
  token: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; player: AdminPlayer } | null>(null);
  const [busy, setBusy] = useState(false);
  const [broadcast, setBroadcast] = useState("");
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [confirmBroadcast, setConfirmBroadcast] = useState(false);
  const liveRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await adminApi.players(token);
      if (!liveRef.current) return;
      setPlayers(list);
    } catch (err) {
      if (!liveRef.current) return;
      setError(adminErrorMessage(err));
      setPlayers([]);
    } finally {
      if (liveRef.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    liveRef.current = true;
    load();
    return () => {
      liveRef.current = false;
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => p.username.toLowerCase().includes(q));
  }, [players, search]);

  /** Apply a mutation then refresh the roster. */
  const mutate = useCallback(
    async (fn: () => Promise<unknown>, success: string) => {
      setBusy(true);
      try {
        await fn();
        toast(success, "success");
        await load();
      } catch (err) {
        toast(adminErrorMessage(err), "error");
      } finally {
        setBusy(false);
        setConfirm(null);
      }
    },
    [load, toast]
  );

  const doConfirm = () => {
    if (!confirm || busy) return;
    const p = confirm.player;
    if (confirm.kind === "ban") {
      void mutate(() => adminApi.ban(token, p.username, true), `${p.username} has been banned.`);
    } else if (confirm.kind === "unban") {
      void mutate(() => adminApi.ban(token, p.username, false), `${p.username} has been unbanned.`);
    } else {
      void mutate(
        () => adminApi.makeAdmin(token, p.username),
        `${p.username} is now an admin.`
      );
    }
  };

  const sendBroadcast = async () => {
    const text = broadcast.trim();
    if (!text || broadcastBusy) return;
    setBroadcastBusy(true);
    try {
      await adminApi.broadcast(token, text);
      toast("Broadcast sent to every player.", "success");
      setBroadcast("");
      setConfirmBroadcast(false);
    } catch (err) {
      toast(adminErrorMessage(err), "error");
    } finally {
      setBroadcastBusy(false);
    }
  };

  const confirmTitles: Record<ConfirmKind, string> = {
    ban: "Ban player",
    unban: "Unban player",
    makeAdmin: "Make admin",
  };

  return (
    <div className="eko-admin">
      <header className="eko-admin__head">
        <button
          type="button"
          className="eko-admin__back"
          onClick={onBack}
          aria-label="Back to the game"
        >
          ←
        </button>
        <h1 className="eko-admin__title">Admin dashboard</h1>
        <Button size="md" variant="ghost" onClick={() => void load()} disabled={loading}>
          ↻ Refresh
        </Button>
      </header>

      {/* M13: billboard management (text, colors, position) */}
      <BillboardsManager token={token} />

      {loading ? (
        <div className="eko-admin__center">
          <Loading message="Loading players…" />
        </div>
      ) : error ? (
        <div className="eko-admin__center">
          <EmptyState emoji="🔒" title="Can't load admin tools" body={error} />
          <Button size="md" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <Card className="eko-admin__broadcast" elevated>
            <h2 className="eko-admin__sect">📣 Broadcast to everyone</h2>
            <div className="eko-admin__brow">
              <input
                className="eko-input"
                value={broadcast}
                onChange={(e) => setBroadcast(e.target.value)}
                maxLength={200}
                placeholder="Message for all players (200 chars)…"
                aria-label="Broadcast message"
              />
              <Button
                size="md"
                variant="accent"
                disabled={!broadcast.trim()}
                onClick={() => setConfirmBroadcast(true)}
              >
                Send
              </Button>
            </div>
            <p className="eko-admin__note">
              Lands as a system toast on every connected player. Use for
              events, maintenance, and shout-outs.
            </p>
          </Card>

          <div className="eko-admin__toolbar">
            <input
              className="eko-input eko-admin__search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Search players…"
              aria-label="Search players"
            />
            <span className="eko-admin__count" aria-live="polite">
              {filtered.length} player{filtered.length === 1 ? "" : "s"}
            </span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              emoji="🌆"
              title={players.length === 0 ? "No players yet" : "No matches"}
              body={
                players.length === 0
                  ? "Nobody has walked into the city yet."
                  : `Nobody matches "${search.trim()}".`
              }
            />
          ) : (
            <div className="eko-admin__tablewrap" role="region" aria-label="Players" tabIndex={0}>
              <table className="eko-admin__table">
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Money</th>
                    <th scope="col">Energy</th>
                    <th scope="col">Housing</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className={p.banned ? "eko-admin__row--banned" : ""}>
                      <td data-label="Player">
                        <strong>{p.username}</strong>
                      </td>
                      <td data-label="Money">{naira(p.money ?? 0)}</td>
                      <td data-label="Energy">{Math.round(p.energy ?? 0)}</td>
                      <td data-label="Housing">{p.housing ?? "—"}</td>
                      <td data-label="Status">
                        <StatusFlags p={p} />
                      </td>
                      <td data-label="Actions">
                        <div className="eko-admin__actions">
                          {p.banned ? (
                            <Button
                              className="eko-admin__rowbtn"
                              onClick={() => setConfirm({ kind: "unban", player: p })}
                            >
                              Unban
                            </Button>
                          ) : (
                            <Button
                              className="eko-admin__rowbtn"
                              variant="danger"
                              onClick={() => setConfirm({ kind: "ban", player: p })}
                            >
                              Ban
                            </Button>
                          )}
                          {!p.is_admin && (
                            <Button
                              className="eko-admin__rowbtn"
                              variant="ghost"
                              onClick={() => setConfirm({ kind: "makeAdmin", player: p })}
                            >
                              Make admin
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Dialog
        open={confirm !== null}
        onClose={() => (busy ? undefined : setConfirm(null))}
        title={confirm ? confirmTitles[confirm.kind] : ""}
      >
        {confirm && (
          <div className="eko-admin__confirm">
            <p>
              {confirm.kind === "ban" && (
                <>
                  Ban <strong>{confirm.player.username}</strong>? They'll be
                  kicked out and can't sign in again until unbanned.
                </>
              )}
              {confirm.kind === "unban" && (
                <>
                  Unban <strong>{confirm.player.username}</strong>? They'll be
                  able to sign in again.
                </>
              )}
              {confirm.kind === "makeAdmin" && (
                <>
                  Make <strong>{confirm.player.username}</strong> an admin? They
                  get full access to this dashboard — banning, broadcasting,
                  and making more admins.
                </>
              )}
            </p>
            <div className="eko-admin__confirm-actions">
              <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant={confirm.kind === "makeAdmin" ? "accent" : "danger"}
                onClick={doConfirm}
                loading={busy}
              >
                {confirm.kind === "ban"
                  ? "Ban player"
                  : confirm.kind === "unban"
                    ? "Unban player"
                    : "Make admin"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={confirmBroadcast}
        onClose={() => (broadcastBusy ? undefined : setConfirmBroadcast(false))}
        title="Send broadcast?"
      >
        <div className="eko-admin__confirm">
          <p>Everyone online will see:</p>
          <blockquote className="eko-admin__preview">{broadcast.trim()}</blockquote>
          <div className="eko-admin__confirm-actions">
            <Button variant="ghost" onClick={() => setConfirmBroadcast(false)} disabled={broadcastBusy}>
              Cancel
            </Button>
            <Button variant="accent" onClick={() => void sendBroadcast()} loading={broadcastBusy}>
              Send to everyone
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
