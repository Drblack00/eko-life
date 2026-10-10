import { useEffect, useRef, useState } from "react";
import type { GameSocket } from "../../../hooks/useGameSocket";
import type { You } from "../../../game/types";
import { MarketView } from "./MarketView";
import { MyShopView } from "./MyShopView";
import { HousingPanel } from "./HousingPanel";
import { LapoPanel } from "./LapoPanel";
import { TaxCard } from "./TaxCard";
import "./m10.css";

interface Props {
  token: string;
  sock: GameSocket;
  you: You;
}

type Section = "market" | "myshop" | "money";

/**
 * EconomyTab — M10 economy hub. Market (browse + buy), My Shop (create +
 * stock), and Money (rent-to-own housing, LAPO loans, weekly tax).
 * Mounted by the coordinator as a main tab (see MOUNT in the M10 report).
 */
export function EconomyTab({ token, sock, you }: Props) {
  const [section, setSection] = useState<Section>("market");
  const [refreshKey, setRefreshKey] = useState(0);
  const lastMoney = useRef(you.money);

  // Any server-confirmed money move re-pulls the REST reads.
  useEffect(() => {
    if (you.money !== lastMoney.current) {
      lastMoney.current = you.money;
      setRefreshKey((k) => k + 1);
    }
  }, [you.money]);

  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="m10-tab">
      <div className="m10-seg" role="tablist" aria-label="Economy sections">
        {(
          [
            ["market", "🛒 Market"],
            ["myshop", "🏪 My Shop"],
            ["money", "💰 Money"],
          ] as [Section, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            className={`m10-seg-btn${section === id ? " m10-seg-btn--on" : ""}`}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "market" && (
        <MarketView token={token} sock={sock} you={you} refreshKey={refreshKey} />
      )}
      {section === "myshop" && (
        <MyShopView token={token} sock={sock} you={you} refreshKey={refreshKey} onChanged={bump} />
      )}
      {section === "money" && (
        <div className="m10-money">
          <HousingPanel sock={sock} you={you} />
          <LapoPanel token={token} sock={sock} you={you} refreshKey={refreshKey} />
          <TaxCard token={token} refreshKey={refreshKey} />
        </div>
      )}
    </div>
  );
}
