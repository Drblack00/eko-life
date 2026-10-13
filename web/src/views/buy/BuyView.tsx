import { useState } from "react";
import type { ActName, You } from "../../game/types";
import { naira } from "../../game/types";
import "./BuyView.css";

/**
 * Standalone SHOP tab — cartoon storefront matching the approved design.
 *
 * Layout (exact):
 *  - Light blue background with soft clouds
 *  - "Èkó Life" brand header (dark navy, bold)
 *  - White pill: ☀️ Day N · mood · 💰 money · green + button
 *  - Big "Shop" title
 *  - Category chips: 🍔 Food · 🚌 Travel · ✨ Luxury · 🏠 Home
 *  - 2-column product grid; white 24px cards with big emoji art,
 *    bold name, price, green BUY button
 *
 * Purchase logic is unchanged: BUY fires the same `buy_furniture` act
 * the old buy sheet used, with the same affordability gating.
 */

interface ShopProduct {
  id: string;
  name: string;
  price: number;
  icon: string;
  cat: "food" | "travel" | "luxury" | "home";
}

const PRODUCTS: ShopProduct[] = [
  { id: "jollof_rice", name: "Jollof Rice", price: 1500, icon: "🍚", cat: "food" },
  { id: "zobo", name: "Zobo", price: 500, icon: "🥤", cat: "food" },
  { id: "keke_ride", name: "Keke Ride", price: 800, icon: "🛺", cat: "travel" },
  { id: "armchair", name: "Armchair", price: 5000, icon: "🪑", cat: "home" },
  { id: "sneakers", name: "Sneakers", price: 8000, icon: "👟", cat: "luxury" },
  { id: "headphones", name: "Headphones", price: 12000, icon: "🎧", cat: "luxury" },
];

const CATS = [
  { id: "food", label: "Food", icon: "🍔" },
  { id: "travel", label: "Travel", icon: "🚌" },
  { id: "luxury", label: "Luxury", icon: "✨" },
  { id: "home", label: "Home", icon: "🏠" },
] as const;

type CatId = (typeof CATS)[number]["id"];

function moodEmoji(happiness: number): string {
  if (happiness >= 70) return "😊";
  if (happiness >= 40) return "🙂";
  if (happiness >= 20) return "😐";
  return "😟";
}

export function BuyView({
  you,
  sendAct,
  day,
  onTopUp,
  onBuySheetOpen,
}: {
  you: You;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  /** Current game day (from the socket). */
  day?: number | null;
  /** Opens the top-up dialog (green + button). */
  onTopUp?: () => void;
  /** Kept for API compatibility — the standalone shop has no sheet. */
  onBuySheetOpen?: (open: boolean) => void;
}) {
  const [activeCat, setActiveCat] = useState<CatId | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // No sheet in the standalone shop — keep the hint bar visible.
  void onBuySheetOpen;

  const visible = activeCat
    ? PRODUCTS.filter((p) => p.cat === activeCat)
    : PRODUCTS;

  const buy = (p: ShopProduct) => {
    if (you.money < p.price || pendingId) return;
    setPendingId(p.id);
    sendAct("buy_furniture", { item: p.id });
    // Release the button once the server round-trip settles.
    window.setTimeout(() => setPendingId(null), 4000);
  };

  return (
    <div className="eko-shop">
      <div className="eko-shop__brand">Èkó Life</div>

      <div className="eko-shop__pill">
        <span className="eko-shop__pill-sun" aria-hidden="true">
          ☀️
        </span>
        <strong className="eko-shop__pill-day">
          Day {typeof day === "number" ? day : "–"}
        </strong>
        <span className="eko-shop__pill-mood" aria-hidden="true">
          {moodEmoji(you.happiness)}
        </span>
        <span className="eko-shop__pill-mood-label">mood</span>
        <span aria-hidden="true">😊</span>
        <span className="eko-shop__pill-money">
          <span aria-hidden="true">💰</span>{" "}
          {you.money.toLocaleString("en-NG")}
        </span>
        <button
          type="button"
          className="eko-shop__pill-plus"
          onClick={onTopUp}
          aria-label="Top up coins"
        >
          +
        </button>
      </div>

      <h1 className="eko-shop__title">Shop</h1>

      <div
        className="eko-shop__cats"
        role="tablist"
        aria-label="Shop categories"
      >
        {CATS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={activeCat === c.id}
            className={`eko-shop__cat${
              activeCat === c.id ? " eko-shop__cat--active" : ""
            }`}
            onClick={() => setActiveCat(activeCat === c.id ? null : c.id)}
          >
            <span aria-hidden="true">{c.icon}</span> {c.label}
          </button>
        ))}
      </div>

      <div className="eko-shop__grid">
        {visible.map((p) => {
          const ok = you.money >= p.price;
          const short = Math.max(0, p.price - you.money);
          const isPending = pendingId === p.id;
          return (
            <div key={p.id} className="eko-shop__card">
              <div className="eko-shop__img" aria-hidden="true">
                {p.icon}
              </div>
              <div className="eko-shop__name">{p.name}</div>
              <div className="eko-shop__price">{naira(p.price)}</div>
              <button
                type="button"
                className="eko-shop__buy"
                disabled={!ok || !!pendingId}
                onClick={() => buy(p)}
                aria-label={
                  ok
                    ? `Buy ${p.name} for ${naira(p.price)}`
                    : `Cannot afford ${p.name}: need ${naira(short)} more`
                }
              >
                {isPending ? "…" : ok ? "BUY" : "LOCKED"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
