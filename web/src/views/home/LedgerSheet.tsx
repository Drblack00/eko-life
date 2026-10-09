import { useEffect, useState } from "react";
import { api, type TransactionInfo } from "../../lib/api";
import { naira } from "../../game/types";
import { Button, EmptyState, Loading, Sheet } from "../../components";
import "./Home.css";

/** Human labels for ledger kinds (fallback: prettified kind). */
const KIND_LABELS: Record<string, string> = {
  work: "Work pay",
  work_pay: "Work pay",
  eat: "Food",
  food: "Food",
  fun: "Fun",
  sleep: "Sleep",
  rest: "Rest",
  travel: "Travel",
  rent: "Rent",
  deposit: "Bank deposit",
  withdraw: "Bank withdrawal",
  loan: "Loan received",
  repay: "Loan repayment",
  study: "Study",
  collect: "Street find",
  spawn_cash: "Street find",
  spawn_snack: "Street find",
  spawn_energy: "Street find",
  buy_property: "Property purchase",
  buy_vehicle: "Vehicle purchase",
  buy_biz: "Business purchase",
  buy_furniture: "Furniture",
  place_furniture: "Furniture",
  property_income: "Property income",
  biz_income: "Business income",
  savings_interest: "Savings interest",
  loan_interest: "Loan interest",
  starter_loan: "Starter loan",
  evict: "Eviction",
  class_bonus: "Starter package",
  signup: "Welcome bonus",
  migrate: "Account migration",
};

function kindLabel(kind: string | null | undefined): string {
  const k = String(kind ?? "other");
  return KIND_LABELS[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function balanceOf(tx: TransactionInfo): number | null {
  if (typeof tx.balance_after === "number") return tx.balance_after;
  if (typeof tx.balanceAfter === "number") return tx.balanceAfter;
  return null;
}

function tsOf(tx: TransactionInfo): number {
  if (typeof tx.ts === "number") return tx.ts;
  if (typeof tx.created_at === "number") {
    // Server may send ms epoch or seconds epoch.
    return tx.created_at < 1e12 ? tx.created_at * 1000 : tx.created_at;
  }
  return 0;
}

/**
 * "Money history" — the audit-trail ledger (GET /api/transactions).
 * Fetched when the sheet opens; never computes money, only displays.
 */
export function LedgerSheet({
  token,
  open,
  onClose,
}: {
  token: string;
  open: boolean;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<TransactionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setRows(null);
    setError(null);
    api
      .transactions(token)
      .then((list) => {
        if (!live) return;
        setRows(Array.isArray(list) ? list : []);
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(e?.message ?? "Couldn't load history.");
      });
    return () => {
      live = false;
    };
  }, [open, token]);

  return (
    <Sheet open={open} onClose={onClose} label="Money history">
      <div className="eko-ledger">
        <h2 className="eko-home__h">
          <span aria-hidden="true">💰</span> Money history
        </h2>
        {rows === null && error === null && <Loading message="Loading your ledger…" />}
        {error !== null && (
          <div className="eko-ledger__error">
            <p>Couldn't load your money history: {error}</p>
            <Button
              size="md"
              onClick={() => {
                setError(null);
                setRows(null);
                api
                  .transactions(token)
                  .then((list) => setRows(Array.isArray(list) ? list : []))
                  .catch((e: Error) => setError(e?.message ?? "Couldn't load history."));
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <EmptyState
            emoji="💸"
            title="No transactions yet"
            body="No transactions yet — go hustle!"
          />
        )}
        {rows !== null && rows.length > 0 && (
          <ol className="eko-ledger__list">
            {rows.map((tx) => {
              const amount = Math.round(Number(tx.amount) || 0);
              const bal = balanceOf(tx);
              const ts = tsOf(tx);
              return (
                <li key={tx.id} className="eko-ledger__row">
                  <div className="eko-ledger__meta">
                    <strong className="eko-ledger__kind">{kindLabel(tx.kind)}</strong>
                    <span className="eko-ledger__time">
                      {ts > 0
                        ? new Date(ts).toLocaleString("en-NG", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </div>
                  <div className="eko-ledger__nums">
                    <span
                      className={`eko-ledger__amt ${amount >= 0 ? "eko-ledger__amt--in" : "eko-ledger__amt--out"}`}
                    >
                      {amount >= 0 ? "+" : "−"}
                      {naira(Math.abs(amount))}
                    </span>
                    {bal !== null && (
                      <span className="eko-ledger__bal">bal {naira(bal)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Sheet>
  );
}
