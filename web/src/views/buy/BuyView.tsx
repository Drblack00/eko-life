import type { GameConfig } from "../../lib/api";
import type { ActName, You } from "../../game/types";
import { HomeRoomSection } from "../home/HomeRoom";
import "./BuyView.css";

/**
 * Workstream C — standalone BUY tab: the 3D home room with the Buy
 * catalogue as the primary panel. Reuses HomeRoomSection with buyMode
 * enabled: the sheet opens at the half snap, the collapsed snap is
 * disabled (handle tap cycles half → full → half), and the handle shows
 * a "Buy mode" affordance.
 */
export function BuyView({
  you,
  config,
  sendAct,
  onBuySheetOpen,
}: {
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  /** Fires when the Buy sheet opens/closes (half/full = open). */
  onBuySheetOpen?: (open: boolean) => void;
}) {
  return (
    <div className="eko-tabpad eko-buy">
      <header className="eko-buy__head glass">
        <span className="eko-buy__head-icon" aria-hidden="true">
          🛍️
        </span>
        <div className="eko-buy__head-text">
          <h2 className="eko-buy__head-title">Buy</h2>
          <p className="eko-buy__head-sub">
            Furnish your home — browse the catalogue, try walls &amp; floors
            before you pay.
          </p>
        </div>
      </header>
      <HomeRoomSection
        you={you}
        config={config}
        sendAct={sendAct}
        onBuySheetOpen={onBuySheetOpen}
        buyMode
      />
    </div>
  );
}
