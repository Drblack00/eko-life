import { useState } from "react";
import type { GameSocket } from "../../hooks/useGameSocket";
import type { GameConfig } from "../../lib/api";
import type { ActName, You } from "../../game/types";
import { NeedsBar } from "./NeedsBar";
import { GoalsCard } from "./GoalsCard";
import {
  TopPill,
  GoalsPanel,
  QuickActions,
  HomeTip,
  TrendingNews,
} from "./Dashboard";
import "./Home.css";

/**
 * Home tab — cartoon reference rebuild (2026-10-13): top status pill,
 * goals card with checklist + stat tiles, 2x2 quick actions, tip,
 * today's hustle, news cards. Matches the approved mockup exactly.
 */
export function HomeView({
  you,
  config,
  token,
  sock,
  sendAct,
  onOpenApp,
  onTab,
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
  const [needsOpen, setNeedsOpen] = useState(false);
  return (
    <div className="eko-tabpad eko-home eko-home--g1">
      <TopPill you={you} day={sock.day ?? null} onTopUp={onTopUp} />
      <GoalsPanel you={you} />
      <QuickActions
        onWork={() => onOpenApp?.("jobs")}
        onTravel={() => onTab?.("map")}
        onEat={() => setNeedsOpen(true)}
        onSleep={() => sendAct("sleep")}
      />
      <HomeTip text={tip ?? null} token={token} />
      <GoalsCard token={token} sendAct={sendAct} />
      <TrendingNews onOpenGist={() => onOpenApp?.("gist")} />
      <NeedsBar
        you={you}
        sock={sock}
        config={config}
        open={needsOpen}
        onOpenChange={setNeedsOpen}
      />
    </div>
  );
}
