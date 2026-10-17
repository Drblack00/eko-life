import { useState } from "react";
import { worldApi, type RideResult } from "../../lib/api";
import { Button } from "../../components/Button";
import { WorldHead, WorldNotice, WorldLoading, useWorldState, naira } from "./worldShared";

/**
 * Waka Ride — intra-city trips. Trek is free; keke/danfo ₦150,
 * okada ₦250, cab ₦700–₦900 (rush ×1.5 at peak hours). Trips take
 * 5–10s; go-slow events add flavor + a small time penalty.
 */
export function RideView({ token }: { token: string }) {
  const { state, loading, error, busy, notice, noticeKind, run } = useWorldState(
    worldApi.rideState,
    token
  );
  const [mode, setMode] = useState<string | null>(null);
  const [dest, setDest] = useState("");
  const [trip, setTrip] = useState<RideResult | null>(null);

  if (loading) return <div className="world-app"><WorldLoading /></div>;
  if (error || !state) {
    return (
      <div className="world-app">
        <WorldHead title="🛵 Waka Ride" />
        <WorldNotice kind="error">{error ?? "Couldn't load rides."}</WorldNotice>
      </div>
    );
  }

  const go = () =>
    run(async () => {
      if (!mode || !dest) throw new Error("Pick a ride and a destination.");
      const r = await worldApi.rideTravel(token, mode, dest);
      setTrip(r);
    });

  return (
    <div className="world-app">
      <WorldHead title="🛵 Waka Ride" sub="Move around the city. Every ride tells a story." />
      {state.rush ? (
        <div className="world-banner world-banner--rush">
          🐢 <strong>Rush hour.</strong> {state.rushNote}
        </div>
      ) : (
        <div className="world-banner">🟢 {state.rushNote}</div>
      )}
      <WorldNotice kind={noticeKind}>{notice}</WorldNotice>

      <div className="world-grid">
        {state.modes.map((m) => (
          <button
            key={m.id}
            type="button"
            className="world-card"
            style={mode === m.id ? { borderColor: "var(--primary-strong)", borderWidth: 2 } : undefined}
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
          >
            <h3>{m.icon} {m.name}</h3>
            <p className="sub">{m.blurb}</p>
            <div className="world-price">{m.fare === 0 ? "FREE" : naira(m.fare)}</div>
            <div className="world-muted">{m.minSec}–{m.maxSec}s trip</div>
          </button>
        ))}
      </div>

      <div>
        <label className="world-label" htmlFor="ride-dest">Destination</label>
        <select
          id="ride-dest"
          className="world-select"
          value={dest}
          onChange={(e) => setDest(e.target.value)}
        >
          <option value="">Where to?</option>
          {state.dests.map((d) => (
            <option key={d.id} value={d.id}>
              {d.icon} {d.name}
            </option>
          ))}
        </select>
      </div>

      <Button onClick={go} disabled={busy || !mode || !dest}>
        {busy ? "Rolling…" : mode ? `Go by ${state.modes.find((m) => m.id === mode)?.name}` : "Pick a ride"}
      </Button>

      {trip && (
        <div className="world-card world-card--full">
          <h3>🧾 Trip complete</h3>
          <p className="sub">
            {trip.travelSecs}s trip · fare {naira(trip.fare)} · balance {naira(trip.balance)}
          </p>
          {trip.goSlow && (
            <div className="world-banner" style={{ marginBottom: 8 }}>
              🐢 <strong>Go-slow!</strong> {trip.goSlow.text} (+{trip.goSlow.extraSec}s)
            </div>
          )}
          {trip.caught && (
            <div className="world-banner world-banner--sick">
              {trip.caught.icon} Uh oh — you caught <strong>{trip.caught.name}</strong> on that
              crowded ride. Visit the Clinic.
            </div>
          )}
          {!trip.goSlow && !trip.caught && <p className="world-muted">Smooth trip. Èkó smiled today.</p>}
        </div>
      )}
    </div>
  );
}
