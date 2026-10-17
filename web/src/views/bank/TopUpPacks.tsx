import { useEffect, useState } from "react";
import { Button, EmptyState, Loading } from "../../components";
import { topupApi, type TopupPack } from "../../lib/api";
import { naira } from "../../game/types";
import "./BankApp.css";

/**
 * PORT-P2 — top-up pack selection. STRUCTURE ONLY: the purchase button is
 * disabled behind REAL_MONEY_ENABLED=false with clear "available after
 * compliance" messaging. No payment code paths are active.
 */
export function TopUpPacks() {
  const [packs, setPacks] = useState<TopupPack[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"NGN" | "USD">("NGN");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    topupApi
      .packs()
      .then((d) => {
        setPacks(d.packs);
        setNotice(d.notice);
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return <EmptyState emoji="💳" title="Packs unavailable" body="Couldn't load the top-up packs right now." />;
  }
  if (!packs) return <Loading message="Loading packs…" />;

  const price = (p: TopupPack) =>
    currency === "NGN" ? naira(p.ngn) : `$${p.usd}`;

  return (
    <div>
      <div className="eko-bank__btnrow" role="group" aria-label="Currency">
        {(["NGN", "USD"] as const).map((c) => (
          <Button
            key={c}
            size="md"
            variant={currency === c ? "accent" : "ghost"}
            onClick={() => setCurrency(c)}
          >
            {c === "NGN" ? "₦ Naira" : "$ USD"}
          </Button>
        ))}
      </div>
      <ol className="eko-bank__list">
        {packs.map((p) => (
          <li key={p.id} className="eko-bank__row">
            <div className="eko-bank__meta">
              <strong>
                <span aria-hidden="true">{p.icon}</span> {p.name}
                {p.bestValue && (
                  <span className="eko-bank__pill">Best value</span>
                )}
              </strong>
              <span className="eko-bank__hint">{p.tagline}</span>
              <span className="eko-bank__hint">
                {price(p)} → <strong className="eko-bank__in">+{naira(p.coins)}</strong> gameplay coins
              </span>
            </div>
            <div className="eko-bank__nums">
              <Button
                size="md"
                disabled
                title="Top-ups open after the real-money compliance chain is complete."
              >
                Buy
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {notice && <p className="eko-bank__hint">{notice}</p>}
      <p className="eko-bank__hint">
        Gameplay coins only — they can never be withdrawn or converted back.
      </p>
    </div>
  );
}
