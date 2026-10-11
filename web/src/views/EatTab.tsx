import { useMemo } from "react";
import { asList, type FoodInfo, type FunInfo, type GameConfig } from "../lib/api";
import { naira, type You } from "../game/types";
import { Button, Card, EmptyState, Skeleton } from "../components";

/**
 * Eat / fun / study actions — extracted from Game.tsx (nav restructure).
 * Reused by the Home needs-bar detail panel so food, fun and study stay
 * reachable after the old Needs dock tab was removed.
 */
export function EatTab({
  you,
  config,
  onEat,
  onFun,
  onStudy,
}: {
  you: You;
  config: GameConfig | null;
  onEat: (item: FoodInfo) => void;
  onFun: (item: FunInfo) => void;
  onStudy: () => void;
}) {
  const campus = useMemo(
    () =>
      asList(config?.locations).find((l) => (l.tags ?? []).includes("campus")),
    [config]
  );
  const atCampus = !!campus && you.locationId === campus.id;
  const studyCost = config?.studyCost ?? 5000;
  const canStudy = atCampus && you.cert <= 0 && you.money >= studyCost;

  if (!config) {
    return (
      <div className="eko-tabpad" aria-label="Loading food">
        <Skeleton height={72} rounded={16} />
        <Skeleton height={72} rounded={16} />
        <Skeleton height={40} />
        <Skeleton height={72} rounded={16} />
      </div>
    );
  }
  const food = asList(config.food);
  const fun = asList(config.fun);
  const locName = (id: string) =>
    asList(config.locations).find((l) => l.id === id)?.name ?? "Lagos";

  return (
    <div className="eko-tabpad eko-eat">
      {campus && (
        <Card className="eko-eat__study">
          <div className="eko-food__head">
            <span className="eko-food__icon" aria-hidden="true">
              📚
            </span>
            <div className="eko-food__meta">
              <strong>Study at {campus.name}</strong>
              <span className="eko-food__fx">
                Earn a certificate — unlocks corporate jobs
              </span>
            </div>
          </div>
          <Button
            size="md"
            variant="accent"
            disabled={!canStudy}
            onClick={onStudy}
            aria-label={
              you.cert > 0
                ? "Certificate already earned"
                : !atCampus
                  ? `Study: travel to ${campus!.name} first`
                  : you.money < studyCost
                    ? `Study costs ${naira(studyCost)}`
                    : `Study for certificate, ${naira(studyCost)}`
            }
          >
            {you.cert > 0
              ? "🎓 Certificate earned"
              : !atCampus
                ? `Go to ${campus.name}`
                : you.money < studyCost
                  ? `Need ${naira(studyCost - you.money)} more`
                  : `Study now · ${naira(studyCost)}`}
          </Button>
        </Card>
      )}

      <h2 className="eko-tabh">Chop &amp; refuel</h2>
      {food.length === 0 ? (
        <EmptyState emoji="🍲" title="Kitchen's closed" body="No food on the menu right now." />
      ) : (
        food.map((f) => {
          const afford = you.money >= f.cost;
          return (
            <Card key={f.id} className="eko-food">
              <div className="eko-food__head">
                <span className="eko-food__icon" aria-hidden="true">
                  {f.icon}
                </span>
                <div className="eko-food__meta">
                  <strong>{f.name}</strong>
                  <span className="eko-food__fx">
                    +{f.hunger} hunger · +{f.energy} energy · +{f.happy} happy
                  </span>
                </div>
                <span className="eko-food__cost">{naira(f.cost)}</span>
              </div>
              <Button
                size="md"
                disabled={!afford}
                onClick={() => onEat(f)}
                aria-label={afford ? `Eat ${f.name}` : `Eat ${f.name}: need ${naira(f.cost)}`}
              >
                {afford ? "Eat" : `Need ${naira(f.cost)}`}
              </Button>
            </Card>
          );
        })
      )}

      <h2 className="eko-tabh">Have fun</h2>
      {fun.length === 0 ? (
        <EmptyState emoji="🎉" title="Nothing planned" body="The city hasn't scheduled any fun yet." />
      ) : (
        fun.map((f) => {
          const here = you.locationId === f.locationId;
          const afford = you.money >= f.cost;
          const disabled = !here || !afford;
          const reason = !here
            ? `📍 Go to ${locName(f.locationId)}`
            : !afford
              ? `Need ${naira(f.cost)}`
              : `Enjoy (+${f.happy} happy)`;
          return (
            <Card key={f.id} className="eko-food">
              <div className="eko-food__head">
                <span className="eko-food__icon" aria-hidden="true">
                  {f.icon}
                </span>
                <div className="eko-food__meta">
                  <strong>{f.name}</strong>
                  <span className="eko-food__fx">
                    +{f.happy} happiness
                    {f.energyDelta < 0 && ` · ${f.energyDelta} energy`}
                  </span>
                </div>
                <span className="eko-food__cost">{naira(f.cost)}</span>
              </div>
              <Button
                size="md"
                disabled={disabled}
                onClick={() => onFun(f)}
                aria-label={disabled ? `${f.name}: ${reason}` : `${f.name}: ${reason}`}
              >
                {reason}
              </Button>
            </Card>
          );
        })
      )}
    </div>
  );
}
