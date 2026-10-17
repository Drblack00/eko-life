import { useState } from "react";
import { worldApi } from "../../lib/api";
import { Button } from "../../components/Button";
import {
  WorldHead, WorldNotice, WorldLoading, WorldTabs, useWorldState, naira, countdown,
} from "./worldShared";

/**
 * Civic — police record + report-a-crime, the court (hears only
 * game-recorded events), Assurance Plus, and the Bus Company.
 */
type Tab = "police" | "court" | "assurance" | "busco";

export function CivicView({ token }: { token: string }) {
  const [tab, setTab] = useState<Tab>("police");
  const { state, loading, error, busy, notice, noticeKind, run } = useWorldState(
    async (t) => {
      const [police, court, assurance, busco] = await Promise.all([
        worldApi.police(t),
        worldApi.court(t),
        worldApi.assurance(t),
        worldApi.busco(t),
      ]);
      return { police, court, assurance, busco };
    },
    token
  );
  const [against, setAgainst] = useState("");
  const [offence, setOffence] = useState("theft");
  const [description, setDescription] = useState("");
  const [lossId, setLossId] = useState("");

  if (loading) return <div className="world-app"><WorldLoading /></div>;
  if (error || !state) {
    return (
      <div className="world-app">
        <WorldHead title="⚖️ Civic" />
        <WorldNotice kind="error">{error ?? "Couldn't load civic services."}</WorldNotice>
      </div>
    );
  }

  const report = () =>
    run(async () => {
      if (!against.trim()) throw new Error("Name the player you are reporting.");
      await worldApi.reportCrime(token, against.trim(), offence, description.trim());
      setAgainst(""); setDescription("");
    }, "Report filed. The court hears the case in 2 days. 🚔");

  const claim = () =>
    run(async () => {
      const id = Number(lossId);
      if (!Number.isFinite(id)) throw new Error("Pick a loss to claim.");
      await worldApi.assuranceClaim(token, id);
      setLossId("");
    });

  const { police, court, assurance, busco } = state;

  return (
    <div className="world-app">
      <WorldHead title="⚖️ Civic" sub="Police, courts, assurance, and the bus park — the city's backbone." />
      <WorldNotice kind={noticeKind}>{notice}</WorldNotice>
      <WorldTabs
        tabs={[
          { id: "police", label: "🚔 Police" },
          { id: "court", label: "⚖️ Court" },
          { id: "assurance", label: "🛡️ Assurance" },
          { id: "busco", label: "🚌 Bus Co." },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "police" && (
        <>
          {police.jailed && (
            <div className="world-banner world-banner--bad">
              🔒 You are in a cell — free in {countdown(police.jailed.msLeft)}. No waka till then.
            </div>
          )}
          <div className="world-card">
            <h3>📋 Your record</h3>
            {police.clean ? (
              <div className="world-banner world-banner--good">✨ Clean record. Keep it that way.</div>
            ) : (
              police.record.map((o) => (
                <div key={o.id} className="world-row">
                  <span className="grow">
                    {o.icon} <strong>{o.name}</strong>
                    <br />
                    <span className="world-muted">{o.detail} · {new Date(o.recordedAt).toLocaleDateString("en-NG")}</span>
                  </span>
                </div>
              ))
            )}
            <p className="world-muted">{police.robberyNote}</p>
          </div>
          <div className="world-card">
            <h3>🚨 Report a crime</h3>
            <p className="sub">The offence lands on their game record and goes to court.</p>
            <label className="world-label" htmlFor="rep-against">Player (@username)</label>
            <input id="rep-against" className="world-input" value={against} onChange={(e) => setAgainst(e.target.value)} placeholder="@username" />
            <label className="world-label" htmlFor="rep-offence">Offence</label>
            <select id="rep-offence" className="world-select" value={offence} onChange={(e) => setOffence(e.target.value)}>
              {police.offenceTypes.map((o) => (
                <option key={o.id} value={o.id}>{o.icon} {o.name}</option>
              ))}
            </select>
            <label className="world-label" htmlFor="rep-desc">What happened?</label>
            <input id="rep-desc" className="world-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} placeholder="Short and true." />
            <div className="world-btnrow">
              <Button onClick={report} disabled={busy}>{busy ? "…" : "File report"}</Button>
            </div>
          </div>
        </>
      )}

      {tab === "court" && (
        <>
          <WorldNotice>{court.note}</WorldNotice>
          {court.cases.length === 0 && <WorldNotice>No cases. The court is quiet — good.</WorldNotice>}
          {court.cases.map((c) => (
            <div key={c.id} className="world-card">
              <div className="world-row">
                <span className="grow">
                  <strong>{c.icon} {c.name}</strong>
                  <br />
                  <span className="world-muted">
                    {c.status === "pending" ? `Hearing in ~${Math.max(0, c.hearingDay)} days of game time` : `Decided ${c.decidedAt ? new Date(c.decidedAt).toLocaleDateString("en-NG") : ""}`}
                  </span>
                </span>
                {c.status === "pending"
                  ? <span className="world-pill world-pill--warn">Pending</span>
                  : <span className="world-pill">{c.outcome?.verdict}</span>}
              </div>
              {c.outcome && <p className="world-muted">{c.outcome.note}</p>}
            </div>
          ))}
        </>
      )}

      {tab === "assurance" && (
        <>
          <div className="world-card">
            <h3>🛡️ Assurance Plus</h3>
            <p className="sub">
              {naira(assurance.premium)}/week · deductible {naira(assurance.deductible)} · max payout {naira(assurance.maxPayout)}
            </p>
            {assurance.policy?.active ? (
              <>
                <span className="world-pill world-pill--live">Active</span>
                <div className="world-row" style={{ marginTop: 8 }}>
                  <span className="grow">House condition</span>
                  <strong>{assurance.policy.condition}%</strong>
                </div>
                <div className="world-progress">
                  <i style={{ width: `${assurance.policy.condition}%` }} />
                </div>
                <div className="world-btnrow">
                  <Button
                    onClick={() => run(() => worldApi.assuranceFix(token).then(() => undefined), "Repairs done — 100%.")}
                    disabled={busy || assurance.policy.condition >= 100}
                  >
                    Fix up · {naira(assurance.fixCost)}
                  </Button>
                </div>
              </>
            ) : (
              <div className="world-btnrow">
                <Button onClick={() => run(() => worldApi.assuranceBuy(token).then(() => undefined), "Assurance Plus active — covered from today. 🛡️")} disabled={busy}>
                  {busy ? "…" : `Get Plus · ${naira(assurance.premium)}/week`}
                </Button>
              </div>
            )}
            <div className="world-row" style={{ marginTop: 8 }}>
              <span className="world-muted">Weekly risks: {assurance.risks.map((r) => `${r.icon} ${r.name} ${r.weeklyChance}`).join(" · ")}</span>
            </div>
          </div>
          <div className="world-card">
            <h3>📝 Loss events & claims</h3>
            {assurance.losses.length === 0 && <p className="world-muted">No losses recorded. May it stay so.</p>}
            {assurance.losses.map((l) => (
              <div key={l.id} className="world-row">
                <span className="grow">
                  {l.icon} <strong>{l.name}</strong> — lost {naira(l.loss)}
                  <br />
                  <span className="world-muted">Payout {naira(l.payout)} · expires in {countdown(l.expiresAt - Date.now())}</span>
                </span>
                {l.claimed ? (
                  <span className="world-pill world-pill--live">Claimed</span>
                ) : (
                  <Button onClick={() => { setLossId(String(l.id)); }} disabled={busy}>
                    Select
                  </Button>
                )}
              </div>
            ))}
            {lossId && (
              <div className="world-btnrow">
                <Button onClick={claim} disabled={busy}>{busy ? "…" : "File claim"}</Button>
                <Button onClick={() => setLossId("")}>Cancel</Button>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "busco" && (
        <div className="world-card">
          <h3>🚌 Èkó Bus Company</h3>
          <p className="sub">{busco.blurb}</p>
          {busco.company ? (
            <>
              <div className="world-row">
                <span className="grow">Buses on the road</span>
                <strong>{busco.company.buses} 🚌</strong>
              </div>
              <div className="world-row">
                <span className="grow">Weekly yield</span>
                <span className="world-price">{naira(busco.company.weeklyYield)}</span>
              </div>
              <div className="world-row">
                <span className="grow">Payback</span>
                <strong>~{busco.company.paybackWeeks} weeks</strong>
              </div>
              <div className="world-btnrow">
                <Button
                  onClick={() => run(() => worldApi.buscoStart(token).then(() => undefined), "Another bus hits the road! 🚌")}
                  disabled={busy}
                >
                  {busy ? "…" : `Add a bus · ${naira(busco.startCost)}`}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="world-row">
                <span className="grow">Startup cost</span>
                <span className="world-price">{naira(busco.startCost)}</span>
              </div>
              <div className="world-row">
                <span className="grow">Weekly yield</span>
                <span className="world-price">+{naira(busco.weeklyYield)}</span>
              </div>
              <div className="world-row">
                <span className="grow">Payback</span>
                <strong>~{busco.paybackWeeks} weeks</strong>
              </div>
              <div className="world-btnrow">
                <Button onClick={() => run(() => worldApi.buscoStart(token).then(() => undefined), "Your bus hits the road! 🚌")} disabled={busy}>
                  {busy ? "…" : "Start the company"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
