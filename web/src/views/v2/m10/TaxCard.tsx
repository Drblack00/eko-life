import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Loading } from "../../../components";
import { naira } from "../../../game/types";
import { m10Api, type TaxInfo } from "./m10Api";

interface Props {
  token: string;
  refreshKey: number;
}

/**
 * Tax card — this week's earnings from the ledger, the projected bill
 * under the progressive brackets, and any governor tax holiday.
 */
export function TaxCard({ token, refreshKey }: Props) {
  const [tax, setTax] = useState<TaxInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTax(await m10Api.tax(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tax info.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (error) {
    return (
      <Card className="m10-card">
        <EmptyState emoji="🧾" title="Tax office closed" body={error} />
        <Button variant="ghost" onClick={load}>Try again</Button>
      </Card>
    );
  }
  if (!tax) return <Loading />;

  return (
    <Card className="m10-card">
      <h3 className="m10-card-title">🧾 Weekly income tax</h3>
      {tax.holiday ? (
        <p className="m10-card-sub">
          🎉 <strong>Tax holiday!</strong> The governor set the rate to zero —
          this week's bill is {naira(0)}.
        </p>
      ) : (
        <p className="m10-card-sub">
          First {naira(tax.free)}/week free · 20% on the next {naira(tax.band2)} ·
          30% above {naira(tax.free + tax.band2)}. Auto-debited at the week boundary.
        </p>
      )}
      <div className="m10-stat-row">
        <div className="m10-stat">
          <span className="m10-stat-v">{naira(tax.weekEarnings)}</span>
          <span className="m10-stat-l">earned this week</span>
        </div>
        <div className="m10-stat">
          <span className="m10-stat-v">{naira(tax.bill)}</span>
          <span className="m10-stat-l">projected bill</span>
        </div>
        <div className="m10-stat">
          <span className="m10-stat-v">{tax.bracket.label}</span>
          <span className="m10-stat-l">your bracket</span>
        </div>
      </div>
    </Card>
  );
}
