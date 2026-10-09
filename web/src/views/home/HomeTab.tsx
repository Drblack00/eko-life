import { useEffect, useRef, useState } from "react";
import {
  asList,
  priceOf,
  speedOf,
  type GameConfig,
} from "../../lib/api";
import {
  furnitureItemId,
  furnitureKey,
  naira,
  refId,
  refName,
  type ActName,
  type FurnitureEntry,
  type You,
} from "../../game/types";
import { Button, Card, Dialog, Sheet } from "../../components";
import "./Home.css";

export type HomeFocus = "housing" | "bank" | null;

/** Server "nothing owned" sentinel (property/vehicle default to "none"). */
const NONE = "none";

function ownedId(ref: string | { id?: string; name?: string } | null | undefined): string | null {
  const id = refId(ref);
  return id && id !== NONE ? id : null;
}

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  run: () => void;
}

/** Shared confirm dialog for expensive purchases (property / business / vehicle). */
function useConfirm() {
  const [c, setC] = useState<ConfirmState | null>(null);
  const dialog = (
    <Dialog
      open={c !== null}
      onClose={() => setC(null)}
      title={c?.title ?? "Confirm"}
    >
      {c && (
        <div className="eko-confirm">
          <p className="eko-confirm__body">{c.body}</p>
          <div className="eko-confirm__actions">
            <Button variant="ghost" onClick={() => setC(null)}>
              Keep my money
            </Button>
            <Button
              onClick={() => {
                c.run();
                setC(null);
              }}
            >
              {c.confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
  return { ask: setC, dialog };
}

/** Affordability: every purchase button shows price + the exact shortfall. */
function afford(you: You, price: number): { ok: boolean; short: number } {
  const p = Math.max(0, Math.round(price || 0));
  return { ok: you.money >= p, short: Math.max(0, p - you.money) };
}

function BuyButton({
  price,
  you,
  onBuy,
  label,
}: {
  price: number;
  you: You;
  onBuy: () => void;
  label?: string;
}) {
  const { ok, short } = afford(you, price);
  return (
    <Button
      size="md"
      disabled={!ok}
      onClick={onBuy}
      aria-label={ok ? `${label ?? "Buy"} for ${naira(price)}` : `Cannot afford: need ${naira(short)} more`}
    >
      {ok ? `${label ?? "Buy"} · ${naira(price)}` : `Need ${naira(short)} more`}
    </Button>
  );
}

function Section({
  id,
  emoji,
  title,
  children,
}: {
  id: string;
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="eko-home__section" id={`home-${id}`} aria-label={title}>
      <h2 className="eko-home__h">
        <span aria-hidden="true">{emoji}</span> {title}
      </h2>
      {children}
    </section>
  );
}

/* ---------------- Housing ---------------- */

function HousingSection({
  you,
  config,
  sendAct,
  travelTo,
}: {
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  travelTo: (locationId: string) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const tiers = asList(config.housing).filter((h) => h.id !== "bridge");
  const current = config.housing?.[you.housing];
  const propId = ownedId(you.property);
  const prop = (config.properties ?? []).find((p) => p.id === propId);
  const propIncome = prop ? (prop.incomeDaily ?? prop.income ?? 0) : 0;
  const propHappy = prop?.happy ?? 0;
  // The server only signs leases at a housing office — gate the sheet.
  const office = asList(config.locations).find((l) =>
    (l.tags ?? []).includes("housing_office")
  );
  const atOffice = office != null && you.locationId === office.id;
  const { ask, dialog } = useConfirm();

  return (
    <Section id="housing" emoji="🏠" title="Housing">
      <Card className="eko-home__card">
        <div className="eko-home__row">
          <div className="eko-home__meta">
            <strong>Current rental</strong>
            <span className="eko-home__sub">
              {current ? `${current.icon} ${current.name}` : you.housing} ·{" "}
              {naira(current?.rent ?? 0)}/day
            </span>
          </div>
          <Button size="md" variant="accent" onClick={() => setSheet(true)}>
            Change
          </Button>
        </div>
      </Card>

      {propId && (
        <Card className="eko-home__card eko-home__card--own">
          <div className="eko-home__meta">
            <strong>🏘️ Your property</strong>
            <span className="eko-home__sub">
              {prop?.icon ? `${prop.icon} ` : ""}
              {prop?.name ?? refName(you.property)}
              {propIncome > 0 && ` · earns ${naira(propIncome)}/day`}
              {propHappy > 0 && ` · +${propHappy} happiness`}
            </span>
          </div>
        </Card>
      )}

      {(config.properties ?? []).length > 0 && (
        <>
          <h3 className="eko-home__subh">
            {propId ? "Upgrade property" : "Buy property"}
          </h3>
          {(config.properties ?? []).map((p) => {
            const isOwn = p.id === propId;
            const price = priceOf(p);
            const income = p.incomeDaily ?? p.income ?? 0;
            return (
              <Card key={p.id} className="eko-home__card">
                <div className="eko-home__row">
                  <div className="eko-home__meta">
                    <strong>
                      {p.icon ? `${p.icon} ` : ""}{p.name}
                      {isOwn && " · yours"}
                    </strong>
                    <span className="eko-home__sub">
                      {income > 0
                        ? `Earns ${naira(income)}/day`
                        : (p.happy ?? 0) > 0
                          ? `+${p.happy} happiness`
                          : (p.desc ?? "A place of your own.")}
                    </span>
                  </div>
                  {isOwn ? (
                    <span className="eko-home__sub">Owned ✓</span>
                  ) : (
                    <BuyButton
                      price={price}
                      you={you}
                      label={propId ? "Upgrade" : "Buy"}
                      onBuy={() =>
                        ask({
                          title: propId ? "Upgrade property?" : "Buy property?",
                          body: propId
                            ? `Upgrade to ${p.name} for ${naira(price)}? Your current property is replaced (no refund).`
                            : `Buy ${p.name} for ${naira(price)}? This moves real money out of your wallet.`,
                          confirmLabel: `${propId ? "Upgrade" : "Buy"} for ${naira(price)}`,
                          run: () => sendAct("buy_property", { property: p.id }),
                        })
                      }
                    />
                  )}
                </div>
              </Card>
            );
          })}
        </>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)} label="Change rental">
        <div className="eko-home__sheet">
          <h2 className="eko-home__h">Pick a rental</h2>
          <p className="eko-home__note">
            Rent is charged every game day. Miss it 3 days in a row and you're
            out on the street.
          </p>
          {!atOffice && office && (
            <Card className="eko-home__card">
              <div className="eko-home__row">
                <div className="eko-home__meta">
                  <strong>🏢 Housing office required</strong>
                  <span className="eko-home__sub">
                    Leases are only signed at the housing office.
                  </span>
                </div>
                <Button
                  size="md"
                  variant="accent"
                  onClick={() => {
                    setSheet(false);
                    travelTo(office.id);
                  }}
                >
                  Go to {office.name}
                </Button>
              </div>
            </Card>
          )}
          {tiers.map((h) => {
            const isHere = h.id === you.housing;
            return (
              <Card key={h.id} className="eko-home__card">
                <div className="eko-home__row">
                  <div className="eko-home__meta">
                    <strong>
                      {h.icon} {h.name}
                      {isHere && " · current"}
                    </strong>
                    <span className="eko-home__sub">{naira(h.rent)}/day</span>
                  </div>
                  <Button
                    size="md"
                    variant={isHere ? "ghost" : "accent"}
                    disabled={isHere || !atOffice}
                    onClick={() => {
                      sendAct("rent", { housing: h.id });
                      setSheet(false);
                    }}
                    aria-label={
                      isHere
                        ? `${h.name}: current rental`
                        : !atOffice
                          ? `${h.name}: go to the housing office first`
                          : `Move to ${h.name}`
                    }
                  >
                    {isHere ? "Current" : "Move in"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </Sheet>
      {dialog}
    </Section>
  );
}

/* ---------------- Bank ---------------- */

const BANK_CHIPS = [1000, 5000, 20000];

function BankSection({
  you,
  config,
  sendAct,
}: {
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
}) {
  const [amount, setAmount] = useState("");
  const [loanAmt, setLoanAmt] = useState("");
  const amt = Math.max(0, Math.floor(Number(amount) || 0));
  const loanAmount = Math.max(0, Math.floor(Number(loanAmt) || 0));
  const loanMax = config.bank?.loanMax ?? 100000;
  const savingsRate = config.bank?.savingsRate;
  const starterLoan =
    config.classes?.[you.class]?.starterLoan ??
    (you.starter_loan_available ? 10000 : 0);

  const depOk = amt > 0 && amt <= you.money;
  const wdOk = amt > 0 && amt <= you.savings;
  const borrowOk = loanAmount > 0 && loanAmount <= loanMax && you.loan <= 0;

  return (
    <Section id="bank" emoji="🏦" title="Bank">
      <Card className="eko-home__card">
        <div className="eko-home__row">
          <div className="eko-home__meta">
            <strong>Savings</strong>
            <span className="eko-home__sub">{naira(you.savings)}</span>
          </div>
          <div className="eko-home__meta eko-home__meta--right">
            <strong>Wallet</strong>
            <span className="eko-home__sub">{naira(you.money)}</span>
          </div>
        </div>
        {typeof savingsRate === "number" && savingsRate > 0 && (
          <p className="eko-home__note">
            Savings earn {Math.round(savingsRate * 100)}% every game day.
          </p>
        )}
        <label className="eko-home__label" htmlFor="bank-amount">
          Amount
        </label>
        <input
          id="bank-amount"
          className="eko-home__input"
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="₦0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <div className="eko-home__chips" role="group" aria-label="Quick amounts">
          {BANK_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              className="eko-home__chip"
              onClick={() => setAmount(String(c))}
            >
              {naira(c)}
            </button>
          ))}
          <button
            type="button"
            className="eko-home__chip"
            onClick={() => setAmount(String(Math.max(you.money, you.savings)))}
          >
            Max
          </button>
        </div>
        <div className="eko-home__btnrow">
          <Button
            size="md"
            disabled={!depOk}
            onClick={() => {
              sendAct("bank", { op: "deposit", amount: amt });
              setAmount("");
            }}
            aria-label={depOk ? `Deposit ${naira(amt)}` : "Deposit: enter an amount you can afford"}
          >
            {depOk ? `Deposit ${naira(amt)}` : "Deposit"}
          </Button>
          <Button
            size="md"
            variant="accent"
            disabled={!wdOk}
            onClick={() => {
              sendAct("bank", { op: "withdraw", amount: amt });
              setAmount("");
            }}
            aria-label={wdOk ? `Withdraw ${naira(amt)}` : "Withdraw: enter an amount within savings"}
          >
            {wdOk ? `Withdraw ${naira(amt)}` : "Withdraw"}
          </Button>
        </div>
      </Card>

      <Card className="eko-home__card">
        <div className="eko-home__row">
          <div className="eko-home__meta">
            <strong>Loan</strong>
            <span className="eko-home__sub">
              {you.loan > 0 ? `You owe ${naira(you.loan)}` : "No active loan"}
            </span>
          </div>
        </div>
        {you.loan > 0 ? (
          <>
            <label className="eko-home__label" htmlFor="repay-amount">
              Repay amount
            </label>
            <input
              id="repay-amount"
              className="eko-home__input"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder={naira(Math.min(you.loan, you.money))}
              value={loanAmt}
              onChange={(e) => setLoanAmt(e.target.value)}
            />
            <Button
              size="md"
              className="eko-home__full"
              disabled={loanAmount <= 0 || loanAmount > you.money}
              onClick={() => {
                sendAct("repay", { amount: Math.min(loanAmount, you.loan) });
                setLoanAmt("");
              }}
            >
              {loanAmount > 0 && loanAmount <= you.money
                ? `Repay ${naira(Math.min(loanAmount, you.loan))}`
                : loanAmount > you.money
                  ? `Need ${naira(loanAmount - you.money)} more`
                  : "Repay loan"}
            </Button>
          </>
        ) : (
          <>
            {you.starter_loan_available && starterLoan > 0 && (
              <Button
                size="md"
                variant="accent"
                onClick={() => sendAct("loan", { amount: starterLoan })}
                className="eko-home__full"
              >
                Claim {naira(starterLoan)} starter loan
              </Button>
            )}
            <label className="eko-home__label" htmlFor="borrow-amount">
              Borrow up to {naira(loanMax)}
            </label>
            <input
              id="borrow-amount"
              className="eko-home__input"
              type="number"
              inputMode="numeric"
              min={0}
              max={loanMax}
              placeholder={naira(loanMax)}
              value={loanAmt}
              onChange={(e) => setLoanAmt(e.target.value)}
            />
            <Button
              size="md"
              className="eko-home__full"
              disabled={!borrowOk}
              onClick={() => {
                sendAct("loan", { amount: loanAmount });
                setLoanAmt("");
              }}
              aria-label={
                borrowOk
                  ? `Borrow ${naira(loanAmount)}`
                  : loanAmount > loanMax
                    ? `Borrow: max is ${naira(loanMax)}`
                    : "Borrow: enter an amount"
              }
            >
              {borrowOk
                ? `Borrow ${naira(loanAmount)}`
                : loanAmount > loanMax
                  ? `Max ${naira(loanMax)}`
                  : "Borrow"}
            </Button>
            <p className="eko-home__note">
              Loans charge {Math.round((config.bank?.loanRate ?? 0.1) * 100)}%
              interest every game day — repay fast.
            </p>
          </>
        )}
      </Card>
    </Section>
  );
}

/* ---------------- Vehicles ---------------- */

function VehicleSection({
  you,
  config,
  sendAct,
}: {
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
}) {
  const vId = ownedId(you.vehicle);
  const owned = (config.vehicles ?? []).find((v) => v.id === vId);
  // The "none" sentinel (Trek on foot) is the default, not a purchase.
  const forSale = (config.vehicles ?? []).filter((v) => v.id !== NONE);
  const { ask, dialog } = useConfirm();

  return (
    <Section id="vehicles" emoji="🚗" title="Vehicles">
      {vId && owned ? (
        <Card className="eko-home__card eko-home__card--own">
          <div className="eko-home__meta">
            <strong>
              {owned.icon ? `${owned.icon} ` : ""}
              {owned.name}
            </strong>
            <span className="eko-home__sub">
              {speedOf(owned)}× travel speed
            </span>
          </div>
        </Card>
      ) : (
        <p className="eko-home__note">
          You're trekking on foot. A ride gets you around the city faster.
        </p>
      )}
      {vId && <h3 className="eko-home__subh">Upgrade ride</h3>}
      {forSale.map((v) => {
        if (v.id === vId) return null;
        const price = priceOf(v);
        return (
          <Card key={v.id} className="eko-home__card">
            <div className="eko-home__row">
              <div className="eko-home__meta">
                <strong>
                  {v.icon ? `${v.icon} ` : ""}{v.name}
                </strong>
                <span className="eko-home__sub">
                  {speedOf(v)}× travel speed{v.desc ? ` · ${v.desc}` : ""}
                </span>
              </div>
              <BuyButton
                price={price}
                you={you}
                label={vId ? "Upgrade" : "Buy"}
                onBuy={() =>
                  ask({
                    title: "Buy vehicle?",
                    body: `Buy ${v.name} for ${naira(price)}? This moves real money out of your wallet.`,
                    confirmLabel: `Buy for ${naira(price)}`,
                    run: () => sendAct("buy_vehicle", { v: v.id }),
                  })
                }
              />
            </div>
          </Card>
        );
      })}
      {forSale.length === 0 && (
        <p className="eko-home__note">
          No vehicles for sale yet — the car lots are still stocking up.
        </p>
      )}
      {dialog}
    </Section>
  );
}

/* ---------------- Business ---------------- */

function BusinessSection({
  you,
  config,
  sendAct,
}: {
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
}) {
  const bId = ownedId(you.biz);
  const owned = (config.businesses ?? []).find((b) => b.id === bId);
  const { ask, dialog } = useConfirm();
  const income = (b: { dailyIncome?: number; income?: number }) =>
    b.dailyIncome ?? b.income ?? 0;

  return (
    <Section id="business" emoji="🏪" title="Business">
      {bId ? (
        <Card className="eko-home__card eko-home__card--own">
          <div className="eko-home__meta">
            <strong>
              {owned?.icon ? `${owned.icon} ` : ""}
              {owned?.name ?? refName(you.biz)}
            </strong>
            <span className="eko-home__sub">
              {income(owned ?? {}) > 0
                ? `Earns ${naira(income(owned ?? {}))}/day`
                : "Open for business"}
            </span>
          </div>
        </Card>
      ) : (
        <>
          {(config.businesses ?? []).map((b) => {
            const price = priceOf(b);
            return (
              <Card key={b.id} className="eko-home__card">
                <div className="eko-home__row">
                  <div className="eko-home__meta">
                    <strong>
                      {b.icon ? `${b.icon} ` : ""}{b.name}
                    </strong>
                    <span className="eko-home__sub">
                      {income(b) > 0
                        ? `Earns ${naira(income(b))}/day`
                        : (b.desc ?? "Be your own boss.")}
                    </span>
                  </div>
                  <BuyButton
                    price={price}
                    you={you}
                    label="Buy"
                    onBuy={() =>
                      ask({
                        title: "Buy business?",
                        body: `Buy ${b.name} for ${naira(price)}? This moves real money out of your wallet.`,
                        confirmLabel: `Buy for ${naira(price)}`,
                        run: () => sendAct("buy_biz", { biz: b.id }),
                      })
                    }
                  />
                </div>
              </Card>
            );
          })}
          {(config.businesses ?? []).length === 0 && (
            <p className="eko-home__note">
              No businesses for sale yet — investors are still negotiating.
            </p>
          )}
        </>
      )}
      {dialog}
    </Section>
  );
}

/* ---------------- Furniture ---------------- */

function FurnitureSection({
  you,
  config,
  sendAct,
}: {
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
}) {
  const owned: FurnitureEntry[] = Array.isArray(you.furniture) ? you.furniture : [];
  const catalog = config.furniture ?? [];
  const maxPlaced = typeof config.homeSlots === "number" ? config.homeSlots : 6;
  const placedCount = owned.filter((f) => f.placed).length;
  const full = placedCount >= maxPlaced;

  const catalogById = (id: string) => catalog.find((c) => c.id === id);

  return (
    <Section id="furniture" emoji="🛋️" title="Furniture">
      <p className="eko-home__note">
        Placed furniture boosts your daily vibes. {placedCount}/{maxPlaced}{" "}
        slots used — tap an item to place or remove it.
      </p>
      {owned.length === 0 ? (
        <p className="eko-home__note">
          Your place is empty — buy something from the catalog below.
        </p>
      ) : (
        <div className="eko-furn__grid">
          {owned.map((f) => {
            const c = catalogById(furnitureItemId(f));
            return (
              <button
                key={furnitureKey(f)}
                type="button"
                className={`eko-furn__item ${f.placed ? "eko-furn__item--placed" : ""}`}
                onClick={() =>
                  sendAct("place_furniture", {
                    id: furnitureKey(f),
                    placed: !f.placed,
                  })
                }
                aria-label={`${c?.name ?? f.name ?? "Furniture"}: ${f.placed ? "placed, tap to remove" : full ? "no free slots" : "tap to place"}`}
                disabled={!f.placed && full}
              >
                <span className="eko-furn__icon" aria-hidden="true">
                  {c?.icon ?? f.icon ?? "🪑"}
                </span>
                <span className="eko-furn__name">
                  {c?.name ?? f.name ?? "Furniture"}
                </span>
                <span className="eko-furn__state">
                  {f.placed ? "Placed ✓" : "Tap to place"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <h3 className="eko-home__subh">Catalog</h3>
      {catalog.map((f) => {
        const ownedCount = owned.filter(
          (o) => furnitureItemId(o) === f.id
        ).length;
        return (
          <Card key={f.id} className="eko-home__card">
            <div className="eko-home__row">
              <div className="eko-home__meta">
                <strong>
                  {f.icon ? `${f.icon} ` : ""}{f.name}
                  {ownedCount > 0 && ` ×${ownedCount}`}
                </strong>
                <span className="eko-home__sub">
                  {f.desc ?? f.effect ?? "Makes the place feel like home."}
                </span>
              </div>
              <BuyButton
                price={f.price}
                you={you}
                label="Buy"
                onBuy={() => sendAct("buy_furniture", { item: f.id })}
              />
            </div>
          </Card>
        );
      })}
      {catalog.length === 0 && (
        <p className="eko-home__note">
          The furniture catalog hasn't arrived yet.
        </p>
      )}
    </Section>
  );
}

/* ---------------- Home tab ---------------- */

export function HomeTab({
  you,
  config,
  sendAct,
  travelTo,
  focus,
  onClearFocus,
}: {
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  travelTo: (locationId: string) => void;
  focus: HomeFocus;
  onClearFocus: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Scroll a section into view when another tab links here (e.g. bank pin).
  useEffect(() => {
    if (!focus) return;
    const el = rootRef.current?.querySelector(`#home-${focus}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = window.setTimeout(onClearFocus, 1200);
    return () => window.clearTimeout(t);
  }, [focus, onClearFocus]);

  return (
    <div className="eko-tabpad eko-home" ref={rootRef}>
      <HousingSection you={you} config={config} sendAct={sendAct} travelTo={travelTo} />
      <BankSection you={you} config={config} sendAct={sendAct} />
      <VehicleSection you={you} config={config} sendAct={sendAct} />
      <BusinessSection you={you} config={config} sendAct={sendAct} />
      <FurnitureSection you={you} config={config} sendAct={sendAct} />
    </div>
  );
}
