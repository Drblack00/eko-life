import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Loading } from "../../../components";
import type { GameSocket } from "../../../hooks/useGameSocket";
import { naira, type You } from "../../../game/types";
import { m10Act, m10Api, type MyShop, type ShopItemRow } from "./m10Api";

interface Props {
  token: string;
  sock: GameSocket;
  you: You;
  refreshKey: number;
  onChanged: () => void;
}

const SHOP_TYPES = [
  { id: "food_spot", name: "Food Spot", icon: "🍲" },
  { id: "salon", name: "Salon", icon: "💇" },
  { id: "provisions", name: "Provisions", icon: "🛒" },
  { id: "fashion", name: "Fashion", icon: "👗" },
  { id: "pharmacy", name: "Pharmacy", icon: "💊" },
  { id: "events", name: "Events", icon: "🎉" },
  { id: "dispatch", name: "Dispatch", icon: "🛵" },
  { id: "tech_repair", name: "Tech Repair", icon: "🔧" },
];
const CREATE_FEE = 20000;

/**
 * My Shop — open your one shop (₦20,000), stock up to 20 different items,
 * watch ratings and today's earnings roll in.
 */
export function MyShopView({ token, sock, you, refreshKey, onChanged }: Props) {
  const [shop, setShop] = useState<MyShop | null | undefined>(undefined);
  const [items, setItems] = useState<ShopItemRow[]>([]);
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await m10Api.mine(token);
      setShop(r.shop);
      setItems(r.items);
      setTodayEarnings(r.todayEarnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your shop.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (error) {
    return (
      <Card className="m10-card">
        <EmptyState emoji="🏪" title="Shop trouble" body={error} />
        <Button variant="ghost" onClick={load}>Try again</Button>
      </Card>
    );
  }
  if (shop === undefined) return <Loading />;
  if (shop === null) {
    return <CreateShopForm sock={sock} you={you} onCreated={() => { load(); onChanged(); }} />;
  }
  return (
    <ShopManager
      token={token}
      sock={sock}
      shop={shop}
      items={items}
      todayEarnings={todayEarnings}
      onChanged={() => { load(); onChanged(); }}
    />
  );
}

function CreateShopForm({ sock, you, onCreated }: { sock: GameSocket; you: You; onCreated: () => void }) {
  const [type, setType] = useState("food_spot");
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("ogba_market");
  const [confirm, setConfirm] = useState(false);

  const open = () => {
    if (!name.trim()) return;
    sock.sendAct(m10Act("shop_create"), { type, name: name.trim(), locationId });
    onCreated();
  };

  return (
    <Card className="m10-card">
      <h3 className="m10-card-title">🏪 Open your shop</h3>
      <p className="m10-card-sub">
        One shop per player. Opening fee {naira(CREATE_FEE)} — then stock it
        free and keep every naira you earn.
      </p>
      <label className="m10-field">
        <span>Shop type</span>
        <div className="m10-type-grid" role="radiogroup" aria-label="Shop type">
          {SHOP_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={type === t.id}
              className={`m10-type${type === t.id ? " m10-type--on" : ""}`}
              onClick={() => setType(t.id)}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </label>
      <label className="m10-field">
        <span>Shop name (max 30 characters)</span>
        <input
          className="m10-input"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Mama's Kitchen"
        />
      </label>
      <label className="m10-field">
        <span>Location</span>
        <input
          className="m10-input"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          placeholder="Location id (e.g. ogba_market)"
        />
      </label>
      {!confirm ? (
        <Button
          variant="primary"
          size="lg"
          disabled={!name.trim() || you.money < CREATE_FEE}
          onClick={() => setConfirm(true)}
        >
          Open shop — {naira(CREATE_FEE)}
        </Button>
      ) : (
        <div className="m10-confirm">
          <p>Open “{name.trim()}” for {naira(CREATE_FEE)}?</p>
          <div className="m10-confirm-btns">
            <Button variant="primary" onClick={open}>Yes, open it</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {you.money < CREATE_FEE && (
        <p className="m10-warn">You need {naira(CREATE_FEE)} to open a shop.</p>
      )}
    </Card>
  );
}

function ShopManager({
  sock,
  shop,
  items,
  todayEarnings,
  onChanged,
}: {
  token: string;
  sock: GameSocket;
  shop: MyShop;
  items: ShopItemRow[];
  todayEarnings: number;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("");

  const stock = () => {
    const p = Math.floor(Number(price));
    const q = Math.floor(Number(qty));
    if (!name.trim() || !p || !q) return;
    sock.sendAct(m10Act("shop_stock"), { name: name.trim(), price: p, qty: q });
    setName("");
    setPrice("");
    setQty("");
    onChanged();
  };

  return (
    <div className="m10-myshop">
      <Card className="m10-card">
        <h3 className="m10-card-title">
          {shop.icon} {shop.name}
        </h3>
        <p className="m10-card-sub">
          {shop.typeName} · {shop.locationName}
        </p>
        <div className="m10-stat-row">
          <div className="m10-stat">
            <span className="m10-stat-v">{naira(todayEarnings)}</span>
            <span className="m10-stat-l">earned today</span>
          </div>
          <div className="m10-stat">
            <span className="m10-stat-v">
              {shop.rating_count > 0 ? `⭐ ${shop.rating.toFixed(1)}` : "—"}
            </span>
            <span className="m10-stat-l">{shop.rating_count} rating{shop.rating_count === 1 ? "" : "s"}</span>
          </div>
          <div className="m10-stat">
            <span className="m10-stat-v">{items.length}/20</span>
            <span className="m10-stat-l">shelf slots</span>
          </div>
        </div>
      </Card>

      <Card className="m10-card">
        <h3 className="m10-card-title">📦 Stock the shelves</h3>
        <p className="m10-card-sub">
          Stocking is free — price what the street will pay (₦1 – ₦1,000,000).
        </p>
        <div className="m10-stock-form">
          <input
            className="m10-input"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            aria-label="Item name"
          />
          <input
            className="m10-input"
            value={price}
            inputMode="numeric"
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Price ₦"
            aria-label="Price in naira"
          />
          <input
            className="m10-input"
            value={qty}
            inputMode="numeric"
            onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Qty"
            aria-label="Quantity"
          />
          <Button onClick={stock} disabled={!name.trim() || !price || !qty}>
            Stock it
          </Button>
        </div>
        {items.length === 0 ? (
          <EmptyState emoji="📦" title="Shelves empty" body="Stock your first item above." />
        ) : (
          <ul className="m10-item-list">
            {items.map((it) => (
              <li key={it.id} className="m10-item-row">
                <span className="m10-item-main">
                  <span className="m10-item-name">{it.name}</span>
                  <span className="m10-item-sub">
                    {naira(it.price)} · {it.stock} in stock
                    {it.stock === 0 && " · SOLD OUT"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
