import type { GameSocket } from "../../hooks/useGameSocket";
import type { GameConfig } from "../../lib/api";
import type { ActName, You } from "../../game/types";
import { Dashboard } from "./Dashboard";
import "./Home.css";

/**
 * Home tab — liquid-glass redesign (2026-10-13): hero, profile strip,
 * quick-action grid, needs, discover, goals, community pulse. Thin
 * wrapper over Dashboard so Game.tsx keeps its existing props.
 */
export function HomeView({
  you,
  config,
  token,
  sock,
  sendAct,
  onOpenApp,
  onTab,
  onOpenNotifications,
  onGovOpen,
  onTopUp,
  tip,
}: {
  you: You;
  config: GameConfig;
  token: string;
  sock: GameSocket;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  /** Opens a phone app (jobs for the Work quick action). */
  onOpenApp?: (app: string) => void;
  /** Switches the bottom-dock tab (map for the Travel quick action). */
  onTab?: (t: "home" | "buy" | "map" | "phone") => void;
  onOpenNotifications?: () => void;
  onGovOpen?: () => void;
  onTopUp?: () => void;
  tip?: string | null;
}) {
  void onGovOpen; // reserved for the government shortcut row (roadmap)
  return (
    <div className="eko-tabpad eko-home eko-home--liquid">
      <Dashboard
        you={you}
        config={config}
        token={token}
        sock={sock}
        sendAct={sendAct}
        onOpenApp={onOpenApp}
        onTab={onTab}
        onOpenNotifications={onOpenNotifications}
        onTopUp={onTopUp}
        tip={tip}
      />
    </div>
  );
}
