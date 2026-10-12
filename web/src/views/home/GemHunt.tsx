import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { gemApi, type GemState } from "../../lib/api";
import { naira } from "../../game/types";
import { Button, Dialog } from "../../components";
import { blip } from "../../lib/sound";

/* ------------------------------------------------------------------ */
/* Daily Gem Hunt — home-screen card + dialog (Phase 9).                */
/* One gem hides somewhere in the city each game day; the card shows   */
/* the countdown and today's riddle, and the dialog lets the player    */
/* search their current location. The gem's location never reaches     */
/* the client — only the riddle clue does.                             */
/* ------------------------------------------------------------------ */

export function useGemHunt(token: string) {
  const [gem, setGem] = useState<GemState | null>(null);
  const load = useCallback(async () => {
    try {
      const g = await gemApi.state(token);
      if (g && typeof g.clue === "string") setGem(g);
    } catch {
      /* card stays hidden on failure */
    }
  }, [token]);
  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);
  return { gem, reload: load };
}

/** "New gem in 18h 14m" style countdown. Exported for tests. */
export function gemCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `New gem in ${h}h ${m}m`;
  if (m > 0) return `New gem in ${m}m`;
  return `New gem in ${s}s`;
}

export function GemDialog({
  gem,
  token,
  onClose,
  onSearched,
}: {
  gem: GemState;
  token: string;
  onClose: () => void;
  onSearched: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [found, setFound] = useState(false);
  // Tick the countdown locally so it stays live between polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  const doSearch = async () => {
    setBusy(true);
    setResult(null);
    setFound(false);
    blip("tap");
    try {
      const r = await gemApi.search(token);
      setFound(true);
      setResult(
        `💎 JACKPOT! You found the gem — +${naira(r.prize)} (rank #${r.rank})`
      );
      blip("coin");
      onSearched();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Search failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <Dialog open onClose={onClose} title="💎 Daily Gem Hunt">
      <div className="eko-gem">
        <p className="eko-gem__countdown" data-testid="gem-countdown">
          {gemCountdown(gem.nextGemInMs)}
        </p>
        <p className="eko-gem__clue-label">TODAY&apos;S CLUE</p>
        <blockquote className="eko-gem__clue" data-testid="gem-clue">
          {gem.clue}
        </blockquote>

        <p className="eko-gem__section">🏆 Prize ladder</p>
        <ul className="eko-gem__ladder">
          {gem.prizeLadder.map((p) => (
            <li key={p.label}>
              <span>{p.label}</span>
              <strong>{naira(p.prize)}</strong>
            </li>
          ))}
        </ul>

        <p className="eko-gem__section">👥 {gem.foundCount} found it today</p>
        {gem.firstFinders.length > 0 ? (
          <p className="eko-gem__finders" data-testid="gem-finders">
            First finders: {gem.firstFinders.map((u) => `@${u}`).join(", ")}
          </p>
        ) : (
          <p className="eko-gem__finders">
            Nobody has found it yet — be the first!
          </p>
        )}

        {gem.myFound ? (
          <p className="eko-gem__mine" data-testid="gem-mine">
            ✅ You found today&apos;s gem! +{naira(gem.myPrize ?? 0)} (rank #
            {gem.myRank})
          </p>
        ) : (
          <div className="eko-gem__search">
            <Button onClick={doSearch} disabled={busy} loading={busy}>
              🔍 Search this location
            </Button>
            {result && (
              <p
                className={
                  found
                    ? "eko-gem__result eko-gem__result--win"
                    : "eko-gem__result"
                }
                data-testid="gem-result"
                role="status"
              >
                {result}
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>,
    document.body
  );
}

export function GemHuntCard({ token }: { token: string }) {
  const { gem, reload } = useGemHunt(token);
  const [open, setOpen] = useState(false);
  if (!gem) return null;
  return (
    <>
      <button
        type="button"
        className="eko-sidecard glass"
        data-testid="gem-card"
        onClick={() => {
          blip("tap");
          setOpen(true);
        }}
        aria-label="Open the daily gem hunt"
      >
        <span className="eko-sidecard__icon" aria-hidden="true">
          💎
        </span>
        <span className="eko-sidecard__body">
          <strong>Gem Hunt</strong>
          {gem.myFound ? (
            <span className="eko-sidecard__text" data-testid="gem-card-found">
              Found! +{naira(gem.myPrize ?? 0)}
            </span>
          ) : (
            <span className="eko-sidecard__text">
              {gem.foundCount} found · next prize {naira(gem.nextPrize)}
            </span>
          )}
          <span className="eko-sidecard__sub" data-testid="gem-card-countdown">
            {gemCountdown(gem.nextGemInMs)}
          </span>
        </span>
      </button>
      {open && (
        <GemDialog
          gem={gem}
          token={token}
          onClose={() => setOpen(false)}
          onSearched={reload}
        />
      )}
    </>
  );
}
