import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, Loading } from "../../components";
import { ApiError, investApi, type InvestDef, type InvestHolding } from "../../lib/api";
import { naira } from "../../game/types";
import "./InvestApp.css";

/**
 * PORT-P2 — the Invest phone app (gameplay coins only).
 *
 * Three asset classes: land parcels (weekly yield + weekly dispute risk),
 * businesses (daily yield by tier), haulage (fixed weekly income).
 * Buy / collect / sell flows; yields accrue on the day tick.
 */
function yieldLabel(kind: string, def: InvestDef): string {
  if (kind === "land" && def.weeklyYield)
    return `${(def.weeklyYield * 100).toFixed(1)}%/week`;
  if (kind === "business" && def.dailyYield)
    return `${(def.dailyYield * 100).toFixed(1)}%/day`;
  if (kind === "haulage" && def.weeklyIncome)
    return `${naira(def.weeklyIncome)}/week`;
  return "";
}

export function InvestApp({ token, you }: { token: string; you: { money: number; is_admin?: boolean } }) {
  const [defs, setDefs] = useState<{ land: InvestDef[]; business: InvestDef[]; haulage: InvestDef[] } | null>(null);
  const [holdings, setHoldings] = useState<InvestHolding[] | null>(null);
  const [balance, setBalance] = useState(0);
  const [totalAccrued, setTotalAccrued] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [tab, setTab] = useState<"land" | "business" | "haulage">("land");

  const refresh = useCallback(async () => {
    try {
      const d = await investApi.overview(token);
      setDefs(d.defs);
      setHoldings(d.holdings);
      setBalance(d.balance);
      setTotalAccrued(d.totalAccrued);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load investments.");
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setOk(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const doBuy = (kind: string, def: InvestDef) =>
    run(`buy-${def.id}`, async () => {
      if (!you.is_admin && def.price > you.money) throw new ApiError(400, "You don't have that much cash.");
      const r = await investApi.buy(token, kind, def.id);
      setOk(`${def.icon} ${def.name} acquired for ${naira(def.price)}.`);
      void r;
    });

  const doCollect = (h: InvestHolding) =>
    run(`collect-${h.id}`, async () => {
      const r = await investApi.collect(token, h.id);
      setOk(`Collected ${naira(r.collected)} from ${h.name}.`);
    });

  const doSell = (h: InvestHolding) =>
    run(`sell-${h.id}`, async () => {
      const r = await investApi.sell(token, h.id);
      setOk(`Sold ${h.name} for ${naira(r.payout)} (value + accrued).`);
    });

  const tabs: Array<{ id: "land" | "business" | "haulage"; label: string; emoji: string }> = [
    { id: "land", label: "Land", emoji: "🟫" },
    { id: "business", label: "Business", emoji: "🏪" },
    { id: "haulage", label: "Haulage", emoji: "🚚" },
  ];

  return (
    <div className="eko-invest">
      <div className="eko-invest__head">
        <h2 className="eko-invest__title">Invest</h2>
        <p className="eko-invest__sub">Put your coins to work. Gameplay coins only.</p>
      </div>

      <div className="eko-invest__cards">
        <div className="eko-invest__card">
          <span className="eko-invest__label">Coin balance</span>
          <strong className="eko-invest__big">{naira(balance)}</strong>
        </div>
        <div className="eko-invest__card">
          <span className="eko-invest__label">Uncollected yield</span>
          <strong className="eko-invest__big eko-invest__in">+{naira(totalAccrued)}</strong>
        </div>
      </div>

      {error && <p className="eko-invest__error-text">{error}</p>}
      {ok && <p className="eko-invest__ok-text">{ok}</p>}

      {!defs || !holdings ? (
        <Loading message="Opening the market…" />
      ) : (
        <>
          {holdings.length > 0 && (
            <section className="eko-invest__section" aria-label="Your holdings">
              <h3 className="eko-invest__h">📁 Your holdings ({holdings.length})</h3>
              <ol className="eko-invest__list">
                {holdings.map((h) => (
                  <li key={h.id} className="eko-invest__row">
                    <div className="eko-invest__meta">
                      <strong>
                        <span aria-hidden="true">{h.icon}</span> {h.name}
                      </strong>
                      <span className="eko-invest__hint">
                        Value {naira(h.value)}
                        {h.accrued > 0 && (
                          <>
                            {" "}· <span className="eko-invest__in">+{naira(h.accrued)} ready</span>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="eko-invest__btnrow">
                      <Button
                        size="md"
                        variant="accent"
                        disabled={h.accrued <= 0 || busy === `collect-${h.id}`}
                        onClick={() => doCollect(h)}
                      >
                        {busy === `collect-${h.id}` ? "…" : "Collect"}
                      </Button>
                      <Button
                        size="md"
                        variant="ghost"
                        disabled={busy === `sell-${h.id}`}
                        onClick={() => doSell(h)}
                      >
                        {busy === `sell-${h.id}` ? "…" : "Sell"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="eko-invest__section" aria-label="Buy assets">
            <h3 className="eko-invest__h">🛒 Buy assets</h3>
            <div className="eko-invest__btnrow" role="group" aria-label="Asset class">
              {tabs.map((t) => (
                <Button
                  key={t.id}
                  size="md"
                  variant={tab === t.id ? "accent" : "ghost"}
                  onClick={() => setTab(t.id)}
                >
                  {t.emoji} {t.label}
                </Button>
              ))}
            </div>
            {tab === "land" && (
              <p className="eko-invest__hint">
                Land pays weekly. Each parcel rolls a small weekly dispute risk
                that can dent its value — buy wide, not just big.
              </p>
            )}
            <ol className="eko-invest__list">
              {defs[tab].map((d) => (
                <li key={d.id} className="eko-invest__row">
                  <div className="eko-invest__meta">
                    <strong>
                      <span aria-hidden="true">{d.icon}</span> {d.name}
                    </strong>
                    <span className="eko-invest__hint">
                      {naira(d.price)} · {yieldLabel(tab, d)}
                    </span>
                  </div>
                  <div className="eko-invest__nums">
                    <Button
                      size="md"
                      disabled={busy === `buy-${d.id}` || (!you.is_admin && d.price > you.money)}
                      onClick={() => doBuy(tab, d)}
                    >
                      {busy === `buy-${d.id}` ? "Buying…" : "Buy"}
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
            {defs[tab].length === 0 && (
              <EmptyState emoji="📦" title="Nothing here" body="No assets in this class yet." />
            )}
          </section>
        </>
      )}
    </div>
  );
}
