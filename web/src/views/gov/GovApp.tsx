import { useCallback, useEffect, useState } from "react";
import { govApi, type GovState } from "../../lib/api";
import type { You } from "../../game/types";
import "./GovApp.css";

/** Format coins as ₦ with thousands separators. Exported for tests. */
export function formatNaira(n: number): string {
  return "₦" + Math.floor(Number(n) || 0).toLocaleString("en-NG");
}

/**
 * Èkó Gov — the State House phone app.
 *
 * Current governor, the live election (candidates, voting, running for
 * office), the sitting governor's policy and cabinet, and past results.
 * All actions go through the /api/gov REST surface (server-validated).
 */
export function GovApp({ token, you }: { token: string; you: You }) {
  const [state, setState] = useState<GovState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState(false);
  const [voteFor, setVoteFor] = useState<{ id: number; name: string } | null>(null);
  const [appointName, setAppointName] = useState("");
  const [appointTitle, setAppointTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await govApi.state(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the State House.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (key: string, fn: () => Promise<{ state: GovState }>, doneMsg: string) => {
      setBusy(key);
      setNotice(null);
      try {
        const r = await fn();
        setState(r.state);
        setNotice(doneMsg);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const iAmGovernor =
    state?.governor != null && Number(state.governor.id) === Number(you.id);
  const votedName =
    state?.myVote != null
      ? state.candidates.find((c) => c.playerId === state.myVote)?.username
      : null;

  return (
    <div className="eko-gov">
      <header className="eko-gov__head">
        <div>
          <h2 className="eko-gov__title">🏛️ Èkó Gov</h2>
          <p className="eko-gov__sub">The State House — who runs this city</p>
        </div>
        <button
          type="button"
          className="eko-gov__refresh"
          onClick={() => void load()}
          aria-label="Refresh State House"
          disabled={loading}
        >
          <span aria-hidden="true">⟳</span>
        </button>
      </header>

      {notice && (
        <p className="eko-gov__notice" role="status">
          {notice}
        </p>
      )}

      {loading && !state ? (
        <p className="eko-gov__loading">Opening the State House…</p>
      ) : error && !state ? (
        <div className="eko-gov__error">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : state ? (
        <>
          {/* ---- sitting governor ---- */}
          <section className="eko-gov__card" aria-label="Sitting governor">
            <span className="eko-gov__crown" aria-hidden="true">
              👑
            </span>
            <div>
              <strong>
                {state.governor?.username
                  ? `@${state.governor.username}`
                  : "No governor yet"}
              </strong>
              <span className="eko-gov__term">
                {state.governor?.username
                  ? iAmGovernor
                    ? " · that's you — the city is yours"
                    : " · currently serving"
                  : " · the seat is empty"}
              </span>
              {state.governor?.username && (
                <p className="eko-gov__perk">
                  👑 Governor badge on Gist posts · ₦25,000 daily salary
                </p>
              )}
            </div>
          </section>

          {/* ---- live election ---- */}
          <section aria-label="Election">
            <h3 className="eko-gov__h">🗳️ The race</h3>
            {!state.election ? (
              <p className="eko-gov__empty">
                No race running right now. The State House is quiet between
                elections.
              </p>
            ) : (
              <>
                <p className="eko-gov__race-meta">
                  Voting open · {state.election.daysLeft} day
                  {state.election.daysLeft === 1 ? "" : "s"} left
                </p>
                {state.candidates.length === 0 ? (
                  <p className="eko-gov__empty">
                    Race is open — no candidates yet. Be the first to step up.
                  </p>
                ) : (
                  <ul className="eko-gov__cands">
                    {state.candidates.map((c) => {
                      const isMe = c.playerId === Number(you.id);
                      const voted = state.myVote != null;
                      return (
                        <li key={c.playerId} className="eko-gov__cand">
                          <span className="eko-gov__cand-name">
                            {isMe ? "You" : `@${c.username}`}
                          </span>
                          <span className="eko-gov__cand-votes">
                            🗳️ {c.votes} vote{c.votes === 1 ? "" : "s"}
                          </span>
                          <button
                            type="button"
                            className="eko-gov__vote"
                            disabled={voted || isMe || busy != null}
                            onClick={() =>
                              setVoteFor({ id: c.playerId, name: c.username })
                            }
                            aria-label={
                              voted
                                ? "You already voted in this race"
                                : isMe
                                  ? "You can't vote for yourself"
                                  : `Vote for @${c.username}`
                            }
                          >
                            {state.myVote === c.playerId
                              ? "Voted ✓"
                              : voted
                                ? "Voted ✓"
                                : isMe
                                  ? "That's you"
                                  : "Vote"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {votedName && (
                  <p className="eko-gov__note">
                    ✓ Your vote is in{votedName ? ` for @${votedName}` : ""}.
                    Results land when the race closes.
                  </p>
                )}
              </>
            )}
          </section>

          {/* ---- run for governor ---- */}
          <section aria-label="Run for governor">
            <h3 className="eko-gov__h">🎤 Run for Governor</h3>
            {state.isCandidate ? (
              <p className="eko-gov__note">
                You're on the ballot — campaign in City Chat and the rooms.
              </p>
            ) : !state.election ? (
              <p className="eko-gov__empty">
                Candidacy opens when the next race begins.
              </p>
            ) : (
              <button
                type="button"
                className="eko-gov__run"
                disabled={!state.canRun || busy != null}
                onClick={() => setConfirmRun(true)}
              >
                {busy === "run"
                  ? "Joining the race…"
                  : `🎤 Run for Governor · ${formatNaira(state.runFee)} fee`}
              </button>
            )}
            <p className="eko-gov__fine">
              Candidacy costs {formatNaira(state.runFee)} (non-refundable). One
              vote per player. The winner takes the crown 👑, a daily salary,
              and the Governor badge across the city.
            </p>
          </section>

          {/* ---- policy ---- */}
          <section aria-label="City policy">
            <h3 className="eko-gov__h">📜 City policy</h3>
            {state.policy.id ? (
              <div className="eko-gov__card">
                <span aria-hidden="true">{state.policy.icon}</span>
                <div>
                  <strong>{state.policy.name}</strong>
                  <p className="eko-gov__fine">{state.policy.desc}</p>
                  <p className="eko-gov__fine">
                    Effect: {state.policy.effects}
                    {state.policy.defaulted ? " (automatic default)" : ""}
                  </p>
                </div>
              </div>
            ) : (
              <p className="eko-gov__empty">
                No policy signed yet this term.
              </p>
            )}
            {state.policy.canPick && (
              <div className="eko-gov__picker">
                <p className="eko-gov__fine">
                  You are the Governor — sign one policy for the whole city.
                </p>
                <ul className="eko-gov__policies">
                  {state.policies.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="eko-gov__policy"
                        disabled={busy != null}
                        onClick={() =>
                          void act(
                            `policy:${p.id}`,
                            () => govApi.pickPolicy(token, p.id),
                            `🏛️ "${p.name}" signed — the whole city feels it.`
                          )
                        }
                      >
                        <span aria-hidden="true">{p.icon}</span>
                        <strong>{p.name}</strong>
                        <span className="eko-gov__fine">{p.effects}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ---- cabinet ---- */}
          <section aria-label="Cabinet">
            <h3 className="eko-gov__h">🎖️ Cabinet</h3>
            {state.commissioners.length === 0 ? (
              <p className="eko-gov__empty">
                No commissioners appointed yet.
              </p>
            ) : (
              <ul className="eko-gov__cands">
                {state.commissioners.map((c) => (
                  <li key={c.title} className="eko-gov__cand">
                    <span className="eko-gov__cand-name">
                      {c.username ? `@${c.username}` : "Vacant"}
                    </span>
                    <span className="eko-gov__cand-votes">{c.title}</span>
                    {iAmGovernor && (
                      <button
                        type="button"
                        className="eko-gov__vote"
                        disabled={busy != null}
                        onClick={() =>
                          void act(
                            `dismiss:${c.title}`,
                            () => govApi.dismiss(token, c.title),
                            `🎖️ ${c.title} seat vacated.`
                          )
                        }
                        aria-label={`Dismiss ${c.title}`}
                      >
                        Dismiss
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {iAmGovernor && (
              <form
                className="eko-gov__appoint"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!appointTitle || !appointName.trim() || busy) return;
                  void act(
                    "appoint",
                    () =>
                      govApi.appoint(token, appointTitle, appointName.trim()),
                    `🎖️ @${appointName.trim()} appointed ${appointTitle}.`
                  );
                  setAppointName("");
                }}
              >
                <select
                  value={appointTitle}
                  onChange={(e) => setAppointTitle(e.target.value)}
                  aria-label="Commissioner title"
                >
                  <option value="">Pick a seat…</option>
                  {state.commissionerTitles.map((t) => (
                    <option key={t.title} value={t.title}>
                      {t.icon} {t.title}
                    </option>
                  ))}
                </select>
                <input
                  value={appointName}
                  onChange={(e) => setAppointName(e.target.value)}
                  placeholder="@username"
                  aria-label="Player username"
                  maxLength={32}
                />
                <button
                  type="submit"
                  disabled={!appointTitle || !appointName.trim() || busy != null}
                >
                  Appoint
                </button>
              </form>
            )}
          </section>

          {/* ---- past results ---- */}
          {state.lastWinner?.username && (
            <section aria-label="Past results">
              <h3 className="eko-gov__h">🏁 Last result</h3>
              <p className="eko-gov__empty">
                👑 @{state.lastWinner.username} won the last race.
              </p>
            </section>
          )}
        </>
      ) : null}

      {/* ---- confirm dialogs ---- */}
      {confirmRun && state && (
        <div className="eko-gov__dialog" role="dialog" aria-modal="true" aria-label="Confirm candidacy">
          <div className="eko-gov__dialog-box">
            <h3>Run for Governor?</h3>
            <p>
              This charges <strong>{formatNaira(state.runFee)}</strong> from
              your wallet — non-refundable. You'll appear on the ballot for the
              whole city to vote on.
            </p>
            <div className="eko-gov__dialog-actions">
              <button type="button" onClick={() => setConfirmRun(false)}>
                Keep my money
              </button>
              <button
                type="button"
                disabled={busy != null}
                onClick={() => {
                  setConfirmRun(false);
                  void act(
                    "run",
                    () => govApi.run(token),
                    "🎤 You're in the race — go campaign!"
                  );
                }}
              >
                Pay {formatNaira(state.runFee)} &amp; run
              </button>
            </div>
          </div>
        </div>
      )}
      {voteFor && (
        <div className="eko-gov__dialog" role="dialog" aria-modal="true" aria-label="Confirm vote">
          <div className="eko-gov__dialog-box">
            <h3>Confirm your vote</h3>
            <p>
              Vote for <strong>@{voteFor.name}</strong>? One vote per player —
              you can't change it afterwards.
            </p>
            <div className="eko-gov__dialog-actions">
              <button type="button" onClick={() => setVoteFor(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy != null}
                onClick={() => {
                  const v = voteFor;
                  setVoteFor(null);
                  void act(
                    "vote",
                    () => govApi.vote(token, v.id),
                    "🗳️ Vote cast! Results at the end of the race."
                  );
                }}
              >
                🗳️ Cast my vote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
