import { useState } from "react";
import type { GameSocket } from "../../hooks/useGameSocket";
import type { GameConfig } from "../../lib/api";
import type { ActName, You } from "../../game/types";
import { NeedsBar } from "./NeedsBar";
import { GoalsCard } from "./GoalsCard";
import {
  Greeting,
  StatRings,
  QuickActions,
  HomeTip,
  TrendingNews,
} from "./Dashboard";
import "./Home.css";

/**
 * Home tab — G1 "Ocean Glass" (picked 2026-10-12): liquid-glass hero,
 * progress-ring stats (shown once), glass quick actions, tip, hustle,
 * trending news. The 3D room editor moved to the Phone app.
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
  const [needsOpen, setNeedsOpen] = useState(false);
  return (
    <div className="eko-tabpad eko-home eko-home--g1">
      <Greeting
        username={you.username}
        day={sock.day ?? null}
        online={sock.online}
        onWallet={onTopUp}
        onBell={onOpenNotifications}
        onGov={onGovOpen}
        hasUnread={sock.unreadNotifications > 0}
      />
      <StatRings you={you} />
      <QuickActions
        onWork={() => onOpenApp?.("jobs")}
        onTravel={() => onTab?.("map")}
        onEat={() => setNeedsOpen(true)}
        onSleep={() => sendAct("sleep")}
      />
      <HomeTip text={tip ?? null} />
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
