import { useState } from "react";
import { worldApi } from "../../lib/api";
import { Button } from "../../components/Button";
import { WorldHead, WorldNotice, WorldLoading, useWorldState, naira } from "./worldShared";

/**
 * Give — charity fund. The fund is seed + real donations with sane
 * math (no absurd trillions). Donor count + project list included.
 */
export function CharityView({ token }: { token: string }) {
  const { state, loading, error, busy, notice, noticeKind, run } = useWorldState(
    worldApi.charity,
    token
  );
  const [amount, setAmount] = useState("1000");
  const [project, setProject] = useState("");

  if (loading) return <div className="world-app"><WorldLoading /></div>;
  if (error || !state) {
    return (
      <div className="world-app">
        <WorldHead title="💝 Give" />
        <WorldNotice kind="error">{error ?? "Couldn't load the fund."}</WorldNotice>
      </div>
    );
  }

  const give = () =>
    run(async () => {
      const n = Math.floor(Number(amount) || 0);
      if (!(n >= 100)) throw new Error("Minimum donation is ₦100.");
      await worldApi.charityGive(token, n, project);
    }, "Èkó thanks you. 🙏");

  return (
    <div className="world-app">
      <WorldHead title="💝 Give" sub="Every naira goes straight into the fund." />
      <WorldNotice kind={noticeKind}>{notice}</WorldNotice>

      <div className="world-card world-card--full" style={{ textAlign: "center" }}>
        <div className="world-muted">THE FUND</div>
        <div className="world-big">{naira(state.fund)}</div>
        <div className="world-muted">{state.donors.toLocaleString("en-NG")} donors</div>
      </div>

      <div className="world-grid">
        {state.projects.map((p) => (
          <div key={p.id} className="world-card">
            <h3>{p.icon} {p.name}</h3>
            <p className="sub">{p.desc}</p>
            <span className="world-pill">{p.tag}</span>{" "}
            <span className="world-muted">goal {naira(p.goal)}</span>
          </div>
        ))}
      </div>

      <div className="world-card">
        <h3>🤲 Make a donation</h3>
        <p className="sub">{state.note}</p>
        <label className="world-label" htmlFor="give-amt">Amount (₦)</label>
        <input
          id="give-amt"
          className="world-input"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <label className="world-label" htmlFor="give-proj">Project (optional)</label>
        <select id="give-proj" className="world-select" value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">Whole fund</option>
          {state.projects.map((p) => (
            <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
          ))}
        </select>
        <div className="world-btnrow">
          <Button onClick={give} disabled={busy}>{busy ? "…" : "Donate"}</Button>
        </div>
      </div>
    </div>
  );
}
