import { useState } from "react";
import { worldApi } from "../../lib/api";
import { Button } from "../../components/Button";
import { WorldHead, WorldNotice, WorldLoading, useWorldState, naira, countdown } from "./worldShared";

/**
 * Rise — IPO-style investment rounds. Time-limited, countdown timer,
 * buy in with game money, fixed payout when the round closes.
 * Game money only; no real securities, no real companies.
 */
export function PromoView({ token }: { token: string }) {
  const { state, loading, error, busy, notice, noticeKind, run } = useWorldState(
    worldApi.promos,
    token
  );
  const [amounts, setAmounts] = useState<Record<number, string>>({});

  if (loading) return <div className="world-app"><WorldLoading /></div>;
  if (error || !state) {
    return (
      <div className="world-app">
        <WorldHead title="📈 Rise" />
        <WorldNotice kind="error">{error ?? "Couldn't load rounds."}</WorldNotice>
      </div>
    );
  }

  const invest = (id: number, min: number, max: number) =>
    run(async () => {
      const n = Math.floor(Number(amounts[id]) || 0);
      if (!(n >= min)) throw new Error(`Minimum is ${naira(min)}.`);
      if (n > max) throw new Error(`Maximum is ${naira(max)} per round.`);
      await worldApi.promoInvest(token, id, n);
    }, "Locked in. Payout lands when the round closes. 💰");

  const claim = (id: number) =>
    run(async () => {
      await worldApi.promoClaim(token, id);
    }, "Payout claimed! 💰");

  return (
    <div className="world-app">
      <WorldHead title="📈 Rise" sub="Back the city's big builds. Fixed payout at close — game money only." />
      <WorldNotice kind={noticeKind}>{notice}</WorldNotice>
      {state.promos.length === 0 && <WorldNotice>No rounds right now. Check back soon.</WorldNotice>}
      {state.promos.map((p) => {
        const open = p.status === "open";
        const payoutAt = (n: number) => Math.floor(n * p.payoutMult);
        return (
          <div key={p.id} className="world-card">
            <div className="world-row">
              <span className="grow">
                <h3 style={{ margin: 0 }}>🏗️ {p.name}</h3>
                <p className="sub">{p.blurb}</p>
              </span>
              {open ? (
                <span className="world-pill world-pill--live">⏳ {countdown(p.msLeft)}</span>
              ) : (
                <span className="world-pill">Closed</span>
              )}
            </div>
            <div className="world-row">
              <span className="world-muted">
                Pays ×{p.payoutMult} at close · {naira(p.minInvest)}–{naira(p.maxInvest)}
              </span>
            </div>
            {p.mine.invested > 0 && (
              <div className="world-banner" style={{ margin: "8px 0" }}>
                💼 You put in <strong>{naira(p.mine.invested)}</strong> → pays{" "}
                <strong>{naira(payoutAt(p.mine.invested))}</strong> at close.
                {!open && !p.mine.claimed && (
                  <div className="world-btnrow">
                    <Button onClick={() => claim(p.id)} disabled={busy}>
                      {busy ? "…" : `Claim ${naira(payoutAt(p.mine.invested))}`}
                    </Button>
                  </div>
                )}
                {!open && p.mine.claimed && (
                  <div style={{ marginTop: 6 }}><span className="world-pill world-pill--live">Claimed ✓</span></div>
                )}
              </div>
            )}
            {open && (
              <div className="world-row">
                <input
                  className="world-input"
                  inputMode="numeric"
                  placeholder={`${naira(p.minInvest)}–${naira(p.maxInvest)}`}
                  value={amounts[p.id] ?? ""}
                  onChange={(e) => setAmounts((m) => ({ ...m, [p.id]: e.target.value }))}
                  aria-label="Investment amount"
                  style={{ maxWidth: 200 }}
                />
                <Button onClick={() => invest(p.id, p.minInvest, p.maxInvest)} disabled={busy}>
                  {busy ? "…" : "Invest"}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
