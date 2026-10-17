import { worldApi } from "../../lib/api";
import { Button } from "../../components/Button";
import { WorldHead, WorldNotice, WorldLoading, useWorldState, naira, countdown } from "./worldShared";

/**
 * Clinic — illness states, chemist (₦1,500) vs hospital (₦8,000)
 * treatment. Untreated illness makes needs decay faster.
 */
export function HealthView({ token }: { token: string }) {
  const { state, loading, error, busy, notice, noticeKind, run } = useWorldState(
    worldApi.health,
    token
  );

  if (loading) return <div className="world-app"><WorldLoading /></div>;
  if (error || !state) {
    return (
      <div className="world-app">
        <WorldHead title="🏥 Clinic" />
        <WorldNotice kind="error">{error ?? "Couldn't load the clinic."}</WorldNotice>
      </div>
    );
  }

  const treat = (provider: string) =>
    run(async () => {
      const r = await worldApi.treat(token, provider);
      if (!r.cured) throw new Error(r.note);
    }, "Treatment worked. You feel yourself again. 💪");

  return (
    <div className="world-app">
      <WorldHead title="🏥 Clinic" sub="Body no be firewood — treat it well." />
      <WorldNotice kind={noticeKind}>{notice}</WorldNotice>

      {state.illness ? (
        <div className="world-banner world-banner--sick">
          {state.illness.icon} <strong>{state.illness.name}</strong> — {state.illness.desc}
          <br />
          <span className="world-muted">
            Needs drain ×{state.decayMult} while sick · clears in ~{countdown(state.illness.msLeft)}
          </span>
        </div>
      ) : (
        <div className="world-banner world-banner--good">
          💪 <strong>You feel fine.</strong> No treatment needed — stay that way.
        </div>
      )}

      <div className="world-grid">
        {state.providers.map((p) => (
          <div key={p.id} className="world-card">
            <h3>{p.icon} {p.name}</h3>
            <p className="sub">{p.note}</p>
            <div className="world-price">{naira(p.fee)}</div>
            <div className="world-btnrow">
              <Button
                onClick={() => treat(p.id)}
                disabled={busy || !state.illness}
              >
                {busy ? "…" : "Get treated"}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className="world-muted">
        Chemist is cheap and fast; the hospital cures everything, guaranteed.
      </p>
    </div>
  );
}
