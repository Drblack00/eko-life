import { useMemo, useState } from "react";
import type { GameConfig } from "../../lib/api";
import type { ActName, You } from "../../game/types";
import { HomeRoomSection } from "../home/HomeRoom";
import { visibleBuyTabs, type BuyTabId } from "../home/catalogue";
import { blip } from "../../lib/sound";
import "./BuyView.css";

/**
 * Workstream C — standalone BUY tab. Option C in Ocean Glass (picked
 * 2026-10-14): quick-access catalogue tiles jump straight to the matching
 * buy-sheet tab; the 3D home room follows below in buyMode.
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
  const tabs = useMemo(
    () =>
      visibleBuyTabs(
        config.furniture ?? [],
        (config.walls?.length ?? 0) + (config.floors?.length ?? 0) > 0
      ),
    [config]
  );
  const [tabSignal, setTabSignal] = useState<{
    tab: BuyTabId;
    n: number;
  } | null>(null);

  const jumpToTab = (tab: BuyTabId) => {
    blip("tap");
    setTabSignal((s) => ({ tab, n: (s?.n ?? 0) + 1 }));
  };

  return (
    <div className="eko-tabpad eko-buy eko-buy--ocean">
      <div className="eko-buy__sechead">
        <h2 className="eko-buy__title">
          <span aria-hidden="true">🛍️</span> Catalogue
        </h2>
        <span className="eko-buy__quick">Quick access</span>
      </div>
      <p className="eko-buy__note">
        Furnish your home — browse the catalogue, try walls &amp; floors before
        you pay.
      </p>
      <div
        className="eko-buy__tiles"
        role="group"
        aria-label="Catalogue categories"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="eko-buy__tile glass"
            onClick={() => jumpToTab(t.id)}
            aria-label={`Open ${t.label} in the catalogue`}
          >
            <span className="eko-buy__tile-icon" aria-hidden="true">
              {t.emoji}
            </span>
            <span className="eko-buy__tile-label">{t.label}</span>
          </button>
        ))}
      </div>
      <HomeRoomSection
        you={you}
        config={config}
        sendAct={sendAct}
        onBuySheetOpen={onBuySheetOpen}
        buyMode
        buyTabSignal={tabSignal}
      />
    </div>
  );
}
