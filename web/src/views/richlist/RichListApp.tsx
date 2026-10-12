import { useCallback, useEffect, useState } from "react";
import { richListApi, type RichListEntry } from "../../lib/api";
import { ProfileSheet, type ProfileTarget } from "../chat/ProfileSheet";
import type { GameSocket } from "../../hooks/useGameSocket";
import "./RichListApp.css";

/** Format coins as ₦ with thousands separators. Exported for tests. */
export function formatNaira(n: number): string {
  return "₦" + Math.floor(Number(n) || 0).toLocaleString("en-NG");
}

/**
 * Competition ranking ("1, 1, 3") from a net-worth-descending list.
 * Exported for tests.
 */
export function rankedLeaders(leaders: RichListEntry[]): Array<RichListEntry & { rank: number }> {
  let rank = 0;
  let lastWorth = Infinity;
  return leaders.map((l, i) => {
    if (l.netWorth < lastWorth) {
      rank = i + 1;
      lastWorth = l.netWorth;
    }
    return { ...l, rank };
  });
}

function AvatarDot({
  avatar,
  color,
  username,
}: {
  avatar: string;
  color: string;
  username: string;
}) {
  return (
    <span
      className="eko-rich__avatar"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {avatar || "🧑"}
      <span className="eko-rich__avatar-letter">
        {username.slice(0, 1).toUpperCase()}
      </span>
    </span>
  );
}

/**
 * Èkó Rich List — top players ranked by net worth
 * (wallet coins + savings + active bond principal).
 * Tapping a row opens the shared player ProfileSheet.
 */
export function RichListApp({
  token,
  youId,
  youUsername,
  sock,
  onStartDm,
}: {
  token: string;
  youId: number;
  youUsername: string;
  sock: GameSocket;
  onStartDm: () => void;
}) {
  const [leaders, setLeaders] = useState<RichListEntry[]>([]);
  const [yourRank, setYourRank] = useState<number | null>(null);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await richListApi.list(token, 50);
      setLeaders(r.leaders);
      setYourRank(r.yourRank);
      setTotalPlayers(r.totalPlayers);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't load the rich list."
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = rankedLeaders(leaders);

  return (
    <div className="eko-rich">
      <header className="eko-rich__head">
        <div>
          <h2 className="eko-rich__title">🏆 Èkó Rich List</h2>
          <p className="eko-rich__sub">
            {yourRank != null && totalPlayers > 0 ? (
              <>
                YOUR RANK <strong>#{yourRank}</strong> of {totalPlayers}
              </>
            ) : (
              "Ranked by net worth"
            )}
          </p>
        </div>
        <button
          type="button"
          className="eko-rich__refresh"
          onClick={() => void load()}
          aria-label="Refresh rich list"
          disabled={loading}
        >
          <span aria-hidden="true">⟳</span>
        </button>
      </header>

      {loading && leaders.length === 0 ? (
        <p className="eko-rich__state">Counting the money…</p>
      ) : error ? (
        <div className="eko-rich__state">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : totalPlayers < 2 ? (
        <p className="eko-rich__state">
          Not enough players yet — invite your friends and start the race to
          the top.
        </p>
      ) : (
        <ol className="eko-rich__list">
          {rows.map((l) => {
            const isYou = l.username === youUsername;
            return (
              <li key={l.id}>
                <button
                  type="button"
                  className={`eko-rich__row${isYou ? " eko-rich__row--you" : ""}`}
                  onClick={() =>
                    setProfile({ playerId: l.id, username: l.username })
                  }
                  aria-label={`View ${l.username}'s profile`}
                >
                  <span className="eko-rich__rank">#{l.rank}</span>
                  <AvatarDot
                    avatar={l.avatar}
                    color={l.color}
                    username={l.username}
                  />
                  <span className="eko-rich__name">
                    @{l.username}
                    {isYou ? (
                      <span className="eko-rich__you">you</span>
                    ) : null}
                    {l.isGovernor ? (
                      <span className="eko-rich__gov" title="Sitting Governor">
                        👑
                      </span>
                    ) : null}
                  </span>
                  <span className="eko-rich__worth">
                    {formatNaira(l.netWorth)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <ProfileSheet
        open={profile !== null}
        target={profile}
        youId={youId}
        sock={sock}
        onClose={() => setProfile(null)}
        onStartDm={() => {
          setProfile(null);
          onStartDm();
        }}
      />
    </div>
  );
}
