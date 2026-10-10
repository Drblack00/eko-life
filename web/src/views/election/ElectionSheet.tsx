import { useState } from "react";
import { Button, Dialog, EmptyState, Sheet, useToast } from "../../components";
import type { GameSocket } from "../../hooks/useGameSocket";
import { naira, type You } from "../../game/types";
import { PolicyBanner, PolicyPicker, Commissioners } from "../v2/m11";
import "../v2/m11/m11.css";
import "./Election.css";

/** Governor candidacy fee (ARCHITECTURE.md game constants, server-validated). */
const RUN_FEE = 50000;
const BROADCAST_KEY = "eko:govbroadcast";

function broadcastSentToday(): boolean {
  try {
    const raw = window.localStorage.getItem(BROADCAST_KEY);
    if (!raw) return false;
    const d = new Date(Number(raw)).toDateString();
    return d === new Date().toDateString();
  } catch {
    return false;
  }
}

/**
 * Election sheet — opened from the governor pill in the HUD.
 * Current governor + days left, candidate list with vote buttons (one vote,
 * confirmed), "Run for Governor" (₦50,000, confirmed), and the governor's
 * daily broadcast input.
 */
export function ElectionSheet({
  open,
  onClose,
  sock,
  you,
}: {
  open: boolean;
  onClose: () => void;
  sock: GameSocket;
  you: You;
}) {
  const { toast } = useToast();
  const [runAsk, setRunAsk] = useState(false);
  const [voteFor, setVoteFor] = useState<{ id: number; name: string } | null>(null);
  const [broadcast, setBroadcast] = useState("");
  const [broadcastDone, setBroadcastDone] = useState(broadcastSentToday);

  const election = sock.election;
  const governor = sock.governor;
  const iAmGovernor =
    governor !== null &&
    governor.name !== null &&
    (governor.id === you.id ||
      governor.name === you.username ||
      governor.name === you.name);
  const canAffordRun = you.money >= RUN_FEE;

  const sendBroadcast = () => {
    const text = broadcast.trim();
    if (!text) return;
    sock.sendGovBroadcast(text);
    setBroadcast("");
    setBroadcastDone(true);
    try {
      window.localStorage.setItem(BROADCAST_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    toast("📢 Governor broadcast sent.", "success");
  };

  const candidates = (election?.candidates ?? []).slice().sort(
    (a, b) => (b.votes ?? 0) - (a.votes ?? 0)
  );

  return (
    <>
      <Sheet open={open} onClose={onClose} label="State House — Elections">
        <div className="eko-election">
          <section className="eko-election__gov">
            <span className="eko-election__crown" aria-hidden="true">
              👑
            </span>
            <div>
              <strong>
                {governor?.name ? `@${governor.name}` : "No governor yet"}
              </strong>
              {governor?.name && (
                <span className="eko-election__term">
                  {election?.endsInDays !== undefined
                    ? ` · ${election.endsInDays} day${election.endsInDays === 1 ? "" : "s"} left`
                    : " · currently serving"}
                </span>
              )}
              {!governor?.name && (
                <span className="eko-election__term"> · the seat is empty</span>
              )}
            </div>
          </section>

          {iAmGovernor && (
            <section className="eko-election__broadcast" aria-label="Governor broadcast">
              <h3>📢 Broadcast as Governor</h3>
              {broadcastDone ? (
                <p className="eko-election__note">
                  Broadcast sent today — come back tomorrow for your next one.
                </p>
              ) : (
                <form
                  className="eko-inputbar"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendBroadcast();
                  }}
                >
                  <input
                    value={broadcast}
                    onChange={(e) => setBroadcast(e.target.value)}
                    placeholder="Address the city (1/day)…"
                    maxLength={200}
                    aria-label="Governor broadcast"
                  />
                  <Button type="submit" size="md" disabled={!broadcast.trim()}>
                    Send
                  </Button>
                </form>
              )}
            </section>
          )}

          <section aria-label="Candidates">
            <h3 className="eko-election__h">Candidates</h3>
            {!election?.active ? (
              <EmptyState
                emoji="🏛️"
                title="No race running right now"
                body="The State House is quiet between elections. When a race opens, candidates appear here — and one vote each."
              />
            ) : candidates.length === 0 ? (
              <EmptyState
                emoji="🗳️"
                title="Race is open — no candidates yet"
                body="Be the first to throw your hat in the ring."
              />
            ) : (
              candidates.map((c) => {
                const isMe = c.id === you.id || c.name === you.username || c.name === you.name;
                const voted = election.voted;
                return (
                  <div key={c.id} className="eko-election__cand">
                    <span className="eko-election__cand-name">
                      {isMe ? "You" : `@${c.name}`}
                    </span>
                    {typeof c.votes === "number" && (
                      <span className="eko-election__cand-votes">
                        🗳️ {c.votes} vote{c.votes === 1 ? "" : "s"}
                      </span>
                    )}
                    <Button
                      size="md"
                      variant={voted ? "ghost" : "accent"}
                      disabled={voted || isMe}
                      onClick={() => setVoteFor({ id: c.id, name: c.name })}
                      aria-label={
                        voted
                          ? "You already voted in this race"
                          : isMe
                            ? "You can't vote for yourself"
                            : `Vote for @${c.name}`
                      }
                    >
                      {voted ? "Voted ✓" : isMe ? "That's you" : "Vote"}
                    </Button>
                  </div>
                );
              })
            )}
            {election?.active && election.voted && (
              <p className="eko-election__note">
                ✓ Your vote is in. Results land when the race closes.
              </p>
            )}
          </section>

          <section aria-label="Run for governor">
            <h3 className="eko-election__h">Run for Governor</h3>
            {election?.running ? (
              <p className="eko-election__note">
                🎤 You're on the ballot — campaign in City Chat and the rooms.
              </p>
            ) : (
              <Button
                size="lg"
                variant="accent"
                className="eko-election__run"
                disabled={!canAffordRun}
                onClick={() => setRunAsk(true)}
              >
                {canAffordRun
                  ? `🎤 Run for Governor · ${naira(RUN_FEE)} fee`
                  : `🎤 Run for Governor · need ${naira(RUN_FEE)}`}
              </Button>
            )}
            <p className="eko-election__note">
              Candidacy costs {naira(RUN_FEE)} (non-refundable). One vote per
              player. The winner gets the crown 👑, a daily salary, and a
              once-a-day city-wide broadcast.
            </p>
          </section>

          {/* M11: governance with teeth — policy + cabinet */}
          <PolicyBanner sock={sock} />
          <PolicyPicker sock={sock} you={you} />
          <Commissioners sock={sock} you={you} />
        </div>
      </Sheet>

      {/* Run confirm */}
      <Dialog open={runAsk} onClose={() => setRunAsk(false)} title="Run for Governor?">
        <p className="eko-profile__dialog-text">
          This charges <strong>{naira(RUN_FEE)}</strong> from your wallet —
          non-refundable. You'll appear on the ballot for the whole city to
          vote on.
        </p>
        <div className="eko-profile__dialog-actions">
          <Button variant="ghost" onClick={() => setRunAsk(false)}>
            Keep my money
          </Button>
          <Button
            onClick={() => {
              sock.runForGovernor();
              setRunAsk(false);
              toast("🎤 You're in the race — go campaign!", "success");
            }}
          >
            Pay {naira(RUN_FEE)} &amp; run
          </Button>
        </div>
      </Dialog>

      {/* Vote confirm */}
      <Dialog
        open={voteFor !== null}
        onClose={() => setVoteFor(null)}
        title="Confirm your vote"
      >
        <p className="eko-profile__dialog-text">
          Vote for <strong>@{voteFor?.name}</strong>? One vote per player —
          you can't change it afterwards.
        </p>
        <div className="eko-profile__dialog-actions">
          <Button variant="ghost" onClick={() => setVoteFor(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (voteFor) sock.voteFor(voteFor.id);
              setVoteFor(null);
              onClose();
            }}
          >
            🗳️ Cast my vote
          </Button>
        </div>
      </Dialog>
    </>
  );
}
