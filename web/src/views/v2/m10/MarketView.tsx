import { useCallback, useEffect, useState } from "react";
import { Button, Card, Dialog, EmptyState, Loading } from "../../../components";
import type { GameSocket } from "../../../hooks/useGameSocket";
import { naira, type You } from "../../../game/types";
import { m10Act, m10Api, type ShopItemRow, type ShopRow } from "./m10Api";

interface Props {
  token: string;
  sock: GameSocket;
  you: You;
  refreshKey: number;
}

/**
 * Market — browse every player-run shop in the city, open a shop to see
 * its shelves, and buy straight from other players. Money moves
 * buyer → owner, server-side.
 */
export function MarketView({ token, sock, refreshKey }: Props) {
  const [shops, setShops] = useState<ShopRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openShop, setOpenShop] = useState<ShopRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await m10Api.shops(token);
      setShops(r.shops);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the market.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (error) {
    return (
      <Card className="m10-card">
        <EmptyState emoji="🏪" title="Market is closed" body={error} />
        <Button variant="ghost" onClick={load}>Try again</Button>
      </Card>
    );
  }
  if (!shops) return <Loading />;

  return (
    <div className="m10-market">
      {shops.length === 0 ? (
        <EmptyState emoji="🏪" title="No shops yet" body="Be the first to open one — the city needs sellers." />
      ) : (
        <ul className="m10-shop-list">
          {shops.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="m10-shop-row"
                onClick={() => setOpenShop(s)}
                aria-label={`${s.name}, ${s.typeName}`}
              >
                <span className="m10-shop-icon" aria-hidden="true">{s.icon}</span>
                <span className="m10-shop-main">
                  <span className="m10-shop-name">{s.name}</span>
                  <span className="m10-shop-sub">
                    {s.typeName} · {s.locationName} · by {s.owner}
                  </span>
                  <span className="m10-shop-meta">
                    {s.rating_count > 0 ? `⭐ ${s.rating.toFixed(1)} (${s.rating_count})` : "No ratings yet"}
                    {" · "}
                    {s.items > 0
                      ? `${s.items} item${s.items === 1 ? "" : "s"}${s.from_price != null ? ` from ${naira(s.from_price)}` : ""}`
                      : "Shelves empty"}
                  </span>
                </span>
                <span className="m10-shop-chev" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={openShop !== null} onClose={() => setOpenShop(null)}>
        {openShop && (
          <ShopDetail
            token={token}
            sock={sock}
            shop={openShop}
            onBought={load}
          />
        )}
      </Dialog>
    </div>
  );
}

function ShopDetail({
  token,
  sock,
  shop,
  onBought,
}: {
  token: string;
  sock: GameSocket;
  shop: ShopRow;
  onBought: () => void;
}) {
  const [items, setItems] = useState<ShopItemRow[] | null>(null);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [stars, setStars] = useState(5);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/v2/m10/shops/${shop.id}/items`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("shelf unavailable");
        const body = (await res.json()) as { items: ShopItemRow[] };
        if (live) setItems(body.items ?? []);
      } catch {
        if (live) setItems([]);
      }
    })();
    return () => { live = false; };
  }, [token, shop.id]);

  const buy = (item: ShopItemRow) => {
    const q = Math.max(1, Math.min(item.stock, qty[item.id] || 1));
    sock.sendAct(m10Act("shop_buy"), { shopId: shop.id, itemId: item.id, qty: q });
    setNote(`Buying ${q} × ${item.name}…`);
    onBought();
  };

  const rate = () => {
    sock.sendAct(m10Act("shop_rate"), { shopId: shop.id, stars });
    setNote(`Rated ${stars}/5 — thank you!`);
  };

  return (
    <div className="m10-shop-detail">
      <h3 className="m10-dialog-title">
        {shop.icon} {shop.name}
      </h3>
      <p className="m10-dialog-sub">
        {shop.typeName} · {shop.locationName} · by {shop.owner}
        {shop.rating_count > 0 && ` · ⭐ ${shop.rating.toFixed(1)} (${shop.rating_count})`}
      </p>
      {note && <p className="m10-note" aria-live="polite">{note}</p>}
      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState emoji="📭" title="Shelves empty" body="This shop is sold out — check back later." />
      ) : (
        <ul className="m10-item-list">
          {items.map((it) => (
            <li key={it.id} className="m10-item-row">
              <span className="m10-item-main">
                <span className="m10-item-name">{it.name}</span>
                <span className="m10-item-sub">
                  {naira(it.price)} · {it.stock} left
                </span>
              </span>
              <span className="m10-buy-ctl">
                <button
                  type="button"
                  className="m10-stepper"
                  aria-label="Decrease quantity"
                  onClick={() => setQty((p) => ({ ...p, [it.id]: Math.max(1, (p[it.id] || 1) - 1) }))}
                >−</button>
                <span className="m10-qty" aria-live="polite">{qty[it.id] || 1}</span>
                <button
                  type="button"
                  className="m10-stepper"
                  aria-label="Increase quantity"
                  onClick={() => setQty((p) => ({ ...p, [it.id]: Math.min(it.stock, (p[it.id] || 1) + 1) }))}
                >+</button>
                <Button size="md" onClick={() => buy(it)}>Buy</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="m10-rate-row">
        <span className="m10-rate-label">Rate this shop:</span>
        <span className="m10-stars" role="radiogroup" aria-label="Star rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className={`m10-star${stars >= n ? " m10-star--on" : ""}`}
              onClick={() => setStars(n)}
            >★</button>
          ))}
        </span>
        <Button variant="ghost" size="md" onClick={rate}>Send</Button>
      </div>
    </div>
  );
}
