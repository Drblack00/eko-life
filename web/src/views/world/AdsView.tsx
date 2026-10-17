import { useState } from "react";
import { worldApi } from "../../lib/api";
import { Button } from "../../components/Button";
import { WorldHead, WorldNotice, WorldLoading, useWorldState, naira, countdown } from "./worldShared";

/**
 * My Ads — billboard (₦250k/7 days) and map plots (₦500/7 days).
 * Live ads appear on the city map via /api/world/ads/feed.
 */
export function AdsView({ token }: { token: string }) {
  const { state, loading, error, busy, notice, noticeKind, run } = useWorldState(
    worldApi.ads,
    token
  );
  const [kind, setKind] = useState("billboard");
  const [title, setTitle] = useState("");
  const [blurb, setBlurb] = useState("");

  if (loading) return <div className="world-app"><WorldLoading /></div>;
  if (error || !state) {
    return (
      <div className="world-app">
        <WorldHead title="📢 My Ads" />
        <WorldNotice kind="error">{error ?? "Couldn't load ads."}</WorldNotice>
      </div>
    );
  }

  const buy = () =>
    run(async () => {
      if (!title.trim()) throw new Error("Give your ad a headline.");
      await worldApi.adsBuy(token, kind, title.trim(), blurb.trim());
      setTitle(""); setBlurb("");
    }, "Your ad is live on the map! 📢");

  return (
    <div className="world-app">
      <WorldHead title="📢 My Ads" sub={`Ads run ${state.durationDays} days, then fade off the map.`} />
      <WorldNotice kind={noticeKind}>{notice}</WorldNotice>

      <div className="world-grid">
        {state.prices.map((p) => (
          <button
            key={p.kind}
            type="button"
            className="world-card"
            style={kind === p.kind ? { borderColor: "var(--primary-strong)", borderWidth: 2 } : undefined}
            onClick={() => setKind(p.kind)}
            aria-pressed={kind === p.kind}
          >
            <h3>{p.icon} {p.name}</h3>
            <p className="sub">{p.note}</p>
            <div className="world-price">{naira(p.cost)}</div>
            <div className="world-muted">per {state.durationDays} days</div>
          </button>
        ))}
      </div>

      <div className="world-card">
        <h3>✍️ Your ad copy</h3>
        <label className="world-label" htmlFor="ad-title">Headline (≤ 40 chars)</label>
        <input id="ad-title" className="world-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="e.g. Amala Shitta — Best in Yaba" />
        <label className="world-label" htmlFor="ad-blurb">Blurb (≤ 90 chars)</label>
        <input id="ad-blurb" className="world-input" value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={90} placeholder="e.g. Hot amala, cold drinks, open till late." />
        <div className="world-btnrow">
          <Button onClick={buy} disabled={busy}>
            {busy ? "…" : `Publish · ${naira(state.prices.find((p) => p.kind === kind)?.cost ?? 0)}`}
          </Button>
        </div>
      </div>

      <div className="world-card">
        <h3>📻 Live ads</h3>
        {state.mine.length === 0 && <p className="world-muted">No live ads yet.</p>}
        {state.mine.map((a) => (
          <div key={a.id} className="world-row">
            <span className="grow">
              <strong>{a.kind === "billboard" ? "🪧" : "📍"} {a.title}</strong>
              <br />
              <span className="world-muted">{a.blurb} · expires in {countdown(a.expiresAt - Date.now())}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
