import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Loading } from "../../../components";
import type { GameSocket } from "../../../hooks/useGameSocket";
import { naira, type You } from "../../../game/types";
import { m10Act, m10Api, type LapoLoan, type LapoTerms } from "./m10Api";

interface Props {
  token: string;
  sock: GameSocket;
  you: You;
  refreshKey: number;
}

/**
 * LAPO panel — bigger loans than the bank (₦50k–₦500k), repaid in 4 weekly
 * auto-debits with 5% flat interest. One at a time; "pay now" any time.
 */
export function LapoPanel({ token, sock, you, refreshKey }: Props) {
  const [loan, setLoan] = useState<LapoLoan | null | undefined>(undefined);
  const [terms, setTerms] = useState<LapoTerms | null>(null);
  const [amount, setAmount] = useState("");
  const [repayAmt, setRepayAmt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await m10Api.lapo(token);
      setLoan(r.loan);
      setTerms(r.terms);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load LAPO.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const borrow = () => {
    const a = Math.floor(Number(amount));
    if (!a) return;
    sock.sendAct(m10Act("lapo_borrow"), { amount: a });
    setAmount("");
  };
  const repay = () => {
    const a = Math.floor(Number(repayAmt));
    if (!a) return;
    sock.sendAct(m10Act("lapo_repay"), { amount: a });
    setRepayAmt("");
  };

  if (error) {
    return (
      <Card className="m10-card">
        <EmptyState emoji="💵" title="LAPO is busy" body={error} />
        <Button variant="ghost" onClick={load}>Try again</Button>
      </Card>
    );
  }
  if (loan === undefined || !terms) return <Loading />;

  const weeklyDueFor = (a: number) => Math.ceil((a * 1.05) / 4);

  return (
    <Card className="m10-card">
      <h3 className="m10-card-title">💵 LAPO loans</h3>
      {loan ? (
        <>
          <div className="m10-stat-row">
            <div className="m10-stat">
              <span className="m10-stat-v">{naira(loan.balance)}</span>
              <span className="m10-stat-l">balance left</span>
            </div>
            <div className="m10-stat">
              <span className="m10-stat-v">{naira(loan.weekly_due)}</span>
              <span className="m10-stat-l">weekly auto-debit</span>
            </div>
            <div className="m10-stat">
              <span className="m10-stat-v">{loan.weeks_left}</span>
              <span className="m10-stat-l">weeks left</span>
            </div>
          </div>
          <p className="m10-card-sub">
            Borrowed {naira(loan.principal)} · auto-debited every 7 game days.
            Miss a debit and the balance carries over — no wahala, just pay.
          </p>
          <div className="m10-stock-form">
            <input
              className="m10-input"
              value={repayAmt}
              inputMode="numeric"
              onChange={(e) => setRepayAmt(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Amount ₦"
              aria-label="Repayment amount in naira"
            />
            <Button onClick={repay} disabled={!repayAmt}>Pay now</Button>
            <Button
              variant="accent"
              onClick={() => sock.sendAct(m10Act("lapo_repay_all"), {})}
              disabled={!you.is_admin && you.money < loan.balance}
            >
              Pay it all ({naira(loan.balance)})
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="m10-card-sub">
            Need bigger money? Borrow {naira(terms.min)} – {naira(terms.max)},
            repay in {terms.weeks} weekly auto-debits (5% flat interest). One
            loan at a time.
          </p>
          <div className="m10-stock-form">
            <input
              className="m10-input"
              value={amount}
              inputMode="numeric"
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder={`Amount ₦ (${naira(terms.min)}–${naira(terms.max)})`}
              aria-label="Loan amount in naira"
            />
            <Button variant="primary" size="lg" onClick={borrow} disabled={!amount}>
              Borrow
            </Button>
          </div>
          {amount && Number(amount) >= terms.min && Number(amount) <= terms.max && (
            <p className="m10-card-sub">
              You'd repay {naira(Math.round(Number(amount) * 1.05))} as{" "}
              {terms.weeks} × {naira(weeklyDueFor(Number(amount)))} weekly.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
