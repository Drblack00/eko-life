import { useState } from "react";
import type { GameSocket } from "../../hooks/useGameSocket";
import type { GameConfig } from "../../lib/api";
import type { ActName, You } from "../../game/types";
import { HomeRoomSection } from "./HomeRoom";
import { NeedsBar } from "./NeedsBar";
import { GoalsCard } from "./GoalsCard";
import { Greeting, StatCards, QuickActions } from "./Dashboard";
import "./Home.css";

/**
 * Home tab (nav restructure): dashboard greeting + stat cards + quick
 * actions (Home 2 layout), the hustle card, then the 3D home room with
 * NO buy sheet (buyMode off — the sheet lives on the dedicated Buy tab
 * now), plus an overlaid needs bar with a detail panel.
 */
export function HomeView({
  you,
  config,
  token,
  sock,
  sendAct,
  onBuySheetOpen,
  onOpenApp,
  onTab,
}: {
  you: You;
  config: GameConfig;
  token: string;
  sock: GameSocket;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  /** Workstream B: fires when the Buy sheet opens/closes (half/full = open). */
  onBuySheetOpen?: (open: boolean) => void;
  /** Opens a phone app (jobs for the Work quick action). */
  onOpenApp?: (app: string) => void;
  /** Switches the bottom-dock tab (map for the Travel quick action). */
  onTab?: (t: "home" | "buy" | "map" | "phone") => void;
}) {
  const [needsOpen, setNeedsOpen] = useState(false);
  return (
    <div className="eko-tabpad eko-home">
      <Greeting username={you.username} day={sock.day ?? null} />
      <StatCards you={you} />
      <QuickActions
        onWork={() => onOpenApp?.("jobs")}
        onTravel={() => onTab?.("map")}
        onEat={() => setNeedsOpen(true)}
        onSleep={() => sendAct("sleep")}
      />
      <GoalsCard token={token} sendAct={sendAct} />
      <div className="eko-home__roomwrap">
        <HomeRoomSection
          you={you}
          config={config}
          sendAct={sendAct}
          onBuySheetOpen={onBuySheetOpen}
        />
        <NeedsBar
          you={you}
          sock={sock}
          config={config}
          open={needsOpen}
          onOpenChange={setNeedsOpen}
        />
      </div>
    </div>
  );
}
