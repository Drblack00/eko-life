import type { GameSocket } from "../../hooks/useGameSocket";
import type { GameConfig } from "../../lib/api";
import type { ActName, You } from "../../game/types";
import { HomeRoomSection } from "./HomeRoom";
import { NeedsBar } from "./NeedsBar";
import { GoalsCard } from "./GoalsCard";
import "./Home.css";

/**
 * Home tab (nav restructure): the 3D home room with NO buy sheet
 * (buyMode off — the sheet lives on the dedicated Buy tab now), plus a
 * compact goals card and an overlaid needs bar with a detail panel.
 */
export function HomeView({
  you,
  config,
  token,
  sock,
  sendAct,
  onBuySheetOpen,
}: {
  you: You;
  config: GameConfig;
  token: string;
  sock: GameSocket;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  /** Workstream B: fires when the Buy sheet opens/closes (half/full = open). */
  onBuySheetOpen?: (open: boolean) => void;
}) {
  return (
    <div className="eko-tabpad eko-home">
      <GoalsCard token={token} sendAct={sendAct} />
      <div className="eko-home__roomwrap">
        <HomeRoomSection
          you={you}
          config={config}
          sendAct={sendAct}
          onBuySheetOpen={onBuySheetOpen}
        />
        <NeedsBar you={you} sock={sock} config={config} />
      </div>
    </div>
  );
}
