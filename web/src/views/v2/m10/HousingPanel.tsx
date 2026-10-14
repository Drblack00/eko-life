import { useState } from "react";
import { Button, Card } from "../../../components";
import type { GameSocket } from "../../../hooks/useGameSocket";
import { naira, type You } from "../../../game/types";
import { m10Act } from "./m10Api";

/** Mirrors server HOUSING_BUY (authoritative values live server-side). */
const BUY_PRICES: Record<string, { name: string; rent: number; buy: number; icon: string }> = {
  face_me: { name: "Face-me-I-face-you", rent: 5000, buy: 1680000, icon: "🏘️" },
  selfcon: { name: "Self-Contain", rent: 12000, buy: 4032000, icon: "🏠" },
  flat: { name: "2-Bedroom Flat", rent: 25000, buy: 8400000, icon: "🏡" },
  duplex: { name: "Duplex", rent: 60000, buy: 20160000, icon: "🏰" },
};

interface Props {
  sock: GameSocket;
  you: You;
}

/**
 * Rent-to-own — buy the place you rent outright (≈48× the weekly rent)
 * and never pay rent again. Buying happens at a Housing Office.
 */
export function HousingPanel({ sock, you }: Props) {
  const [confirm, setConfirm] = useState(false);
  const owned = Number((you as unknown as { housing_owned?: number }).housing_owned) === 1;
  const tier = BUY_PRICES[you.housing];

  const buy = () => {
    sock.sendAct(m10Act("buy_rental"), {});
    setConfirm(false);
  };

  return (
    <Card className="m10-card">
      <h3 className="m10-card-title">🏠 Rent-to-own</h3>
      {owned ? (
        <p className="m10-card-sub">
          You <strong>own</strong> this place — no more rent, ever. Moving out
          starts the rent clock again.
        </p>
      ) : !tier ? (
        <p className="m10-card-sub">
          This place isn't for sale — sign a proper lease at a Housing Office
          first, then buy it outright.
        </p>
      ) : (
        <>
          <p className="m10-card-sub">
            {tier.icon} {tier.name} — rent {naira(tier.rent)}/day.
            Buy it outright for <strong>{naira(tier.buy)}</strong> (≈48 weeks
            of rent) and never pay rent again.
          </p>
          {!confirm ? (
            <Button
              variant="primary"
              size="lg"
              disabled={!you.is_admin && you.money < tier.buy}
              onClick={() => setConfirm(true)}
            >
              Buy outright — {naira(tier.buy)}
            </Button>
          ) : (
            <div className="m10-confirm">
              <p>
                Buy the {tier.name} for {naira(tier.buy)}? No more rent, ever.
              </p>
              <div className="m10-confirm-btns">
                <Button variant="primary" onClick={buy}>Yes, it's mine</Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
              </div>
            </div>
          )}
          {!you.is_admin && you.money < tier.buy && (
            <p className="m10-warn">
              You need {naira(tier.buy - you.money)} more. Visit a Housing Office to buy.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
