import type { GameConfig } from "../../lib/api";
import type { ActName, You } from "../../game/types";
import { HomeRoomSection } from "../home/HomeRoom";
import "./BuyView.css";

/**
 * Shop-in-place Buy tab (picked 2026-10-14, design H): the room itself is
 * the shop. Hotspot pills on the room pick a surface (wall/floor/furniture
 * category) and the inline tray below the room shows its options. No
 * bottom sheet, no popups.
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
  /** Kept for API compatibility; unused in shop-in-place mode. */
  onBuySheetOpen?: (open: boolean) => void;
}) {
  return (
    <div className="eko-tabpad eko-buy">
      <HomeRoomSection
        you={you}
        config={config}
        sendAct={sendAct}
        onBuySheetOpen={onBuySheetOpen}
        shopInPlace
      />
    </div>
  );
}
