import type { GameConfig } from "../../lib/api";
import type { ActName, You } from "../../game/types";
import { HomeRoomSection } from "./HomeRoom";
import "./Home.css";

/**
 * M15 standalone HOME tab: the 3D home room + buy mode, moved out of the
 * Me tab into its own first-class tab.
 */
export function HomeView({
  you,
  config,
  sendAct,
}: {
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
}) {
  return (
    <div className="eko-tabpad eko-home">
      <HomeRoomSection you={you} config={config} sendAct={sendAct} />
    </div>
  );
}
