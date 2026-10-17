import { useCallback, useEffect, useMemo, useState } from "react";
import {
  gamesApi,
  type TgCatalogue,
  type TgFame,
  type TgMatch,
  type TgTable,
} from "../../lib/api";
import "./GamesApp.css";

/**
 * P6 — Table Games hall (game coins only).
 *
 * Four rails: Tables (browsable lobby with stakes ₦1,000–₦10,000,000,
 * seat counts, variants; unaffordable tables show "need ₦X more"),
 * Watch (matches on the tables now + scoreboard replay), Hall of Fame
 * (per game: games played, win %, best pot), and Create a table
 * (venue, game, stake tier, variant, optional @username invite).
 *
 * v1 matches resolve instantly against the Èkó CPU placeholder AI
 * (documented on the server); real-time multiplayer + stronger AI
 * are deferred. The scoreboard replays the server's move log.
 */

type Rail = "tables" | "watch" | "fame" | "create";

function fmt(n: number): string {
  return `₦${Math.floor(Number(n) || 0).toLocaleString("en-NG")}`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function SeatDots({ taken, total }: { taken: number; total: number }) {
  return (
    <span className="eko-gm__seats" aria-label={`${taken} of ${total} seated`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={i < taken ? "eko-gm__dot eko-gm__dot--on" : "eko-gm__dot"}
        />
      ))}
      <span className="eko-gm__seatct">
        {taken} of {total} seated
      </span>
    </span>
  );
}

/** Animated scoreboard: reveals the server's move log line by line. */
function Scoreboard({ match, onClose }: { match: TgMatch; onClose: () => void }) {
  const [shown, setShown] = useState(1);
  useEffect(() => {
    setShown(1);
    if (match.log.length <= 1) return;
    const iv = setInterval(
      () => setShown((s) => (s >= match.log.length ? s : s + 1)),
      900
    );
    return () => clearInterval(iv);
  }, [match.id, match.log.length]);
  const done = shown >= match.log.length;
  return (
    <div className="eko-gm__scrim" role="dialog" aria-label="Match scoreboard">
      <div className="eko-gm__card eko-gm__card--wide">
        <div className="eko-gm__row">
          <div>
            <div className="eko-gm__title">
              {match.game.icon} {match.game.name}
            </div>
            <div className="eko-gm__muted">
              Stake {fmt(match.stake)} · Pot {fmt(match.pot)}
              {match.payout > 0 && <> · Winner takes {fmt(match.payout)}</>}
            </div>
          </div>
          <button className="eko-gm__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="eko-gm__log" aria-live="polite">
          {match.log.slice(0, shown).map((line, i) => (
            <p key={i} className={i === shown - 1 ? "eko-gm__line eko-gm__line--new" : "eko-gm__line"}>
              {line}
            </p>
          ))}
        </div>
        <div className="eko-gm__row">
          <div className="eko-gm__muted">
            {done ? (
              <>
                Winner: <strong>{match.winner ?? "—"}</strong>
              </>
            ) : (
              "Replaying…"
            )}
          </div>
          {done && (
            <button className="eko-gm__btn" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function GamesApp({ token }: { token: string }) {
  const [rail, setRail] = useState<Rail>("tables");
  const [cat, setCat] = useState<TgCatalogue | null>(null);
  const [tables, setTables] = useState<TgTable[]>([]);
  const [balance, setBalance] = useState(0);
  const [gameFilter, setGameFilter] = useState<string>("all");
  const [live, setLive] = useState<TgMatch[]>([]);
  const [fame, setFame] = useState<TgFame | null>(null);
  const [fameGame, setFameGame] = useState<string>("");
  const [watch, setWatch] = useState<TgMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rulesFor, setRulesFor] = useState<string | null>(null);

  // Create-a-table form state.
  const [cGame, setCGame] = useState("");
  const [cVenue, setCVenue] = useState("");
  const [cStake, setCStake] = useState(5000);
  const [cVariant, setCVariant] = useState<string>("");
  const [cInvite, setCInvite] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await gamesApi.catalogue(token);
      setCat(c);
      setBalance(c.myBalance);
      if (!cGame && c.games.length) setCGame(c.games[0].key);
      if (!cVenue && c.venues.length) setCVenue(c.venues[0].key);
      if (!fameGame && c.games.length) setFameGame(c.games[0].key);
      const t = await gamesApi.tables(token);
      setTables(t.tables);
      setBalance(t.myBalance);
      const l = await gamesApi.live(token);
      setLive(l.live);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const loadFame = useCallback(
    async (g: string) => {
      try {
        setFame(await gamesApi.fame(token, g));
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [token]
  );

  useEffect(() => {
    if (rail === "fame" && fameGame) loadFame(fameGame);
    if (rail === "watch") gamesApi.live(token).then((l) => setLive(l.live)).catch(() => {});
  }, [rail, fameGame, loadFame, token]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function act(label: string, fn: () => Promise<{ myBalance: number } | void>) {
    setBusy(label);
    try {
      const r = await fn();
      if (r && typeof r.myBalance === "number") setBalance(r.myBalance);
      const t = await gamesApi.tables(token, gameFilter === "all" ? undefined : gameFilter);
      setTables(t.tables);
      setBalance(t.myBalance);
    } catch (e) {
      setToast(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const join = (id: number) => act(`join-${id}`, () => gamesApi.join(token, id));
  const leave = (id: number) => act(`leave-${id}`, () => gamesApi.leave(token, id));

  async function start(id: number) {
    setBusy(`start-${id}`);
    try {
      const r = await gamesApi.start(token, id);
      setBalance(r.myBalance);
      setWatch(r.match);
      const t = await gamesApi.tables(token, gameFilter === "all" ? undefined : gameFilter);
      setTables(t.tables);
      const l = await gamesApi.live(token);
      setLive(l.live);
      if (fameGame) loadFame(fameGame);
    } catch (e) {
      setToast(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    if (!cGame || !cVenue) return;
    setBusy("create");
    try {
      const r = await gamesApi.create(token, {
        game: cGame,
        venue: cVenue,
        stake: cStake,
        variant: cVariant || null,
        friendInvite: cInvite.trim() ? cInvite.trim().replace(/^@/, "") : null,
      });
      setBalance(r.myBalance);
      setCInvite("");
      setRail("tables");
      const t = await gamesApi.tables(token);
      setTables(t.tables);
      setToast("Table is open — your stake is held. Start when ready.");
    } catch (e) {
      setToast(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const filtered = useMemo(
    () => (gameFilter === "all" ? tables : tables.filter((t) => t.game.key === gameFilter)),
    [tables, gameFilter]
  );

  if (loading) return <div className="eko-gm"><p className="eko-gm__muted">Loading the games hall…</p></div>;
  if (error || !cat)
    return (
      <div className="eko-gm">
        <p className="eko-gm__muted">{error ?? "Could not load the games hall."}</p>
        <button className="eko-gm__btn" onClick={load}>Retry</button>
      </div>
    );

  const game = cat.games.find((g) => g.key === cGame);
  const winnerTakes = game ? Math.floor(((cStake * 2 * (100 - cat.houseCutPct)) / 100)) : 0;

  return (
    <div className="eko-gm">
      <div className="eko-gm__head">
        <div>
          <h2 className="eko-gm__h">🎱 Games Hall</h2>
          <p className="eko-gm__muted">
            Parlor games for game coins. Winner takes {100 - cat.houseCutPct}% of the pot — the house keeps {cat.houseCutPct}%.
          </p>
        </div>
        <div className="eko-gm__pill" title="Your game-coins balance">{fmt(balance)}</div>
      </div>

      <div className="eko-gm__chips" role="tablist" aria-label="Games hall">
        {([["tables", "🪑 Tables"], ["watch", "👀 Watch"], ["fame", "🏛️ Hall of Fame"], ["create", "➕ Create"]] as [Rail, string][]).map(
          ([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={rail === id}
              className={rail === id ? "eko-gm__chip eko-gm__chip--on" : "eko-gm__chip"}
              onClick={() => setRail(id)}
            >
              {label}
            </button>
          )
        )}
      </div>

      {toast && <p className="eko-gm__toast" role="status">{toast}</p>}

      {rail === "tables" && (
        <>
          <div className="eko-gm__chips eko-gm__chips--sub" aria-label="Filter by game">
            <button
              className={gameFilter === "all" ? "eko-gm__chip eko-gm__chip--on" : "eko-gm__chip"}
              onClick={() => setGameFilter("all")}
            >
              All
            </button>
            {cat.games.map((g) => (
              <button
                key={g.key}
                className={gameFilter === g.key ? "eko-gm__chip eko-gm__chip--on" : "eko-gm__chip"}
                onClick={() => setGameFilter(g.key)}
              >
                {g.icon} {g.name}
              </button>
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="eko-gm__muted">No open tables{gameFilter === "all" ? "" : " for this game"} — create one and set the stakes. 🪑</p>
          )}
          <div className="eko-gm__list">
            {filtered.map((t) => {
              const cant = (t.needMore ?? 0) > 0;
              return (
                <div key={t.id} className="eko-gm__card">
                  <div className="eko-gm__row">
                    <div>
                      <div className="eko-gm__title">
                        {t.game.icon} {t.game.name}
                      </div>
                      <div className="eko-gm__muted">
                        {t.venue.icon} {t.venue.name}
                        {t.variant && <> · {t.variant.icon} {t.variant.name}</>}
                      </div>
                    </div>
                    <div className="eko-gm__stake">{fmt(t.stake)}</div>
                  </div>
                  <SeatDots taken={t.seatsTaken} total={t.seatsTotal} />
                  <div className="eko-gm__muted eko-gm__small">
                    {t.stake === 0
                      ? "Friendly table — no coins on the line."
                      : <>Winner takes {fmt(t.winnerTakes)} · a draw refunds both stakes.</>}
                    {t.friendInvite && <> · @{t.friendInvite} was invited.</>}
                  </div>
                  <div className="eko-gm__actions">
                    <button
                      className="eko-gm__btn eko-gm__btn--primary"
                      disabled={cant || busy === `join-${t.id}`}
                      onClick={() => join(t.id)}
                      title={cant ? `You need ${fmt(t.needMore ?? 0)} more` : "Take a seat"}
                    >
                      {busy === `join-${t.id}` ? "…" : cant ? `Need ${fmt(t.needMore ?? 0)} more` : "Join"}
                    </button>
                    <button
                      className="eko-gm__btn"
                      disabled={busy === `leave-${t.id}`}
                      onClick={() => leave(t.id)}
                    >
                      Leave
                    </button>
                    <button
                      className="eko-gm__btn eko-gm__btn--go"
                      disabled={busy === `start-${t.id}`}
                      onClick={() => start(t.id)}
                    >
                      {busy === `start-${t.id}` ? "…" : "▶ Start match"}
                    </button>
                    <button
                      className="eko-gm__link"
                      onClick={() => setRulesFor(rulesFor === t.game.key ? null : t.game.key)}
                    >
                      📜 House rules
                    </button>
                  </div>
                  {rulesFor === t.game.key && (
                    <ul className="eko-gm__rules">
                      {cat.games.find((g) => g.key === t.game.key)?.rules.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          <p className="eko-gm__muted eko-gm__small">
            v1 note: matches play out instantly against {cat.cpuName} (placeholder AI). Real-time multiplayer arrives in a later update.
          </p>
        </>
      )}

      {rail === "watch" && (
        <>
          {live.length === 0 && (
            <p className="eko-gm__muted">No matches on the tables right now — start one and it will show up here. 👀</p>
          )}
          <div className="eko-gm__list">
            {live.map((m) => (
              <div key={m.id} className="eko-gm__card">
                <div className="eko-gm__row">
                  <div>
                    <div className="eko-gm__title">{m.game.icon} {m.game.name}</div>
                    <div className="eko-gm__muted">
                      Stake {fmt(m.stake)} · Pot {fmt(m.pot)} · Winner: <strong>{m.winner ?? "—"}</strong>
                    </div>
                  </div>
                  <button
                    className="eko-gm__btn eko-gm__btn--primary"
                    onClick={async () => {
                      try {
                        setWatch(await gamesApi.watch(token, m.id));
                      } catch (e) {
                        setToast(errMsg(e));
                      }
                    }}
                  >
                    Watch
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {rail === "fame" && (
        <>
          <div className="eko-gm__chips eko-gm__chips--sub" aria-label="Hall of fame game">
            {cat.games.map((g) => (
              <button
                key={g.key}
                className={fameGame === g.key ? "eko-gm__chip eko-gm__chip--on" : "eko-gm__chip"}
                onClick={() => { setFameGame(g.key); loadFame(g.key); }}
              >
                {g.icon} {g.name}
              </button>
            ))}
          </div>
          {!fame && <p className="eko-gm__muted">Loading…</p>}
          {fame && (
            <>
              {fame.leaders.length === 0 && (
                <p className="eko-gm__muted">No champions yet — the crown is up for grabs. 👑</p>
              )}
              <div className="eko-gm__list">
                {fame.leaders.map((l) => (
                  <div key={l.username} className={l.isYou ? "eko-gm__card eko-gm__card--you" : "eko-gm__card"}>
                    <div className="eko-gm__row">
                      <div>
                        <div className="eko-gm__title">
                          {l.rank === 1 ? "👑 " : `#${l.rank} `}@{l.username}
                          {l.isYou && <span className="eko-gm__you">you</span>}
                        </div>
                        <div className="eko-gm__muted">
                          {l.games} games · {l.winPct}% won · best pot {fmt(l.bestPot)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {!fame.me && <p className="eko-gm__muted">{fame.emptyCopy}</p>}
              {fame.me && (
                <p className="eko-gm__muted">
                  Your record: {fame.me.games} games · {fame.me.winPct}% won · best pot {fmt(fame.me.bestPot)}.
                </p>
              )}
            </>
          )}
        </>
      )}

      {rail === "create" && (
        <div className="eko-gm__card">
          <div className="eko-gm__title">Create a table</div>
          <label className="eko-gm__label">Game</label>
          <div className="eko-gm__chips">
            {cat.games.map((g) => (
              <button
                key={g.key}
                className={cGame === g.key ? "eko-gm__chip eko-gm__chip--on" : "eko-gm__chip"}
                onClick={() => { setCGame(g.key); setCVariant(""); }}
              >
                {g.icon} {g.name}
              </button>
            ))}
          </div>
          {game && <p className="eko-gm__muted eko-gm__small">{game.tagline}</p>}
          <label className="eko-gm__label">Venue</label>
          <div className="eko-gm__chips">
            {cat.venues.map((v) => (
              <button
                key={v.key}
                className={cVenue === v.key ? "eko-gm__chip eko-gm__chip--on" : "eko-gm__chip"}
                onClick={() => setCVenue(v.key)}
              >
                {v.icon} {v.name}
              </button>
            ))}
          </div>
          <label className="eko-gm__label">Stake (each player)</label>
          <div className="eko-gm__chips">
            {cat.stakes.map((s) => (
              <button
                key={s}
                className={cStake === s ? "eko-gm__chip eko-gm__chip--on" : "eko-gm__chip"}
                onClick={() => setCStake(s)}
              >
                {s === 0 ? "Friendly" : fmt(s)}
              </button>
            ))}
          </div>
          {game && game.variants.length > 0 && (
            <>
              <label className="eko-gm__label">Variant (optional)</label>
              <div className="eko-gm__chips">
                <button
                  className={cVariant === "" ? "eko-gm__chip eko-gm__chip--on" : "eko-gm__chip"}
                  onClick={() => setCVariant("")}
                >
                  Classic
                </button>
                {game.variants.map((vk) => {
                  const v = cat.variants[vk];
                  return v ? (
                    <button
                      key={vk}
                      className={cVariant === vk ? "eko-gm__chip eko-gm__chip--on" : "eko-gm__chip"}
                      onClick={() => setCVariant(vk)}
                      title={v.blurb}
                    >
                      {v.icon} {v.name}
                    </button>
                  ) : null;
                })}
              </div>
            </>
          )}
          <label className="eko-gm__label" htmlFor="eko-gm-invite">Play a friend (optional)</label>
          <input
            id="eko-gm-invite"
            className="eko-gm__input"
            placeholder="@username"
            value={cInvite}
            onChange={(e) => setCInvite(e.target.value)}
          />
          <p className="eko-gm__muted eko-gm__small">
            {cStake === 0
              ? "Friendly table — no coins move."
              : <>You put in {fmt(cStake)}; the winner takes {fmt(winnerTakes)} (the house keeps {cat.houseCutPct}%). A draw gives both stakes back.</>}
          </p>
          <button
            className="eko-gm__btn eko-gm__btn--primary eko-gm__btn--big"
            disabled={busy === "create" || !cGame || !cVenue}
            onClick={create}
          >
            {busy === "create" ? "…" : `🎱 Create · ${cStake === 0 ? "Free" : fmt(cStake)}`}
          </button>
        </div>
      )}

      {watch && <Scoreboard match={watch} onClose={() => setWatch(null)} />}
    </div>
  );
}
