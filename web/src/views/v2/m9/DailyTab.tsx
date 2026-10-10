import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, useToast } from "../../../components";

/* ------------------------------------------------------------------ */
/* M9 — Daily tab: treasure hunt + Today's Hustle + perks shop.        */
/* Self-contained: all reads go through the `api.get` REST helper;     */
/* all mutations go through `send` (WS acts, server-validated).        */
/* Props:                                                              */
/*   you  — authoritative snapshot (perk_stars after coordinator's      */
/*          youSnapshot extension; falls back to REST)                 */
/*   send — (a, params) => void, wired to sock.sendAct                 */
/*   api  — { get(path): Promise<any> }, authed fetch (Bearer token)   */
/* ------------------------------------------------------------------ */

export interface DailyApi {
  get: (path: string) => Promise<any>;
}

interface DailyTabProps {
  you: { perk_stars?: number; location_id?: string } | null;
  send: (a: string, params?: Record<string, unknown>) => void;
  api: DailyApi;
}

interface HuntRound { id: number; riddle: string; endsAt: number; claims: number }
interface HuntData {
  round: HuntRound | null;
  myPlace: number;
  leaders: { place: number; username: string }[];
  prizes: { label: string; amount: number }[];
}
interface Mission { id: string; label: string; reward: number; done: boolean; claimed: boolean }
interface HustleData { dayKey: string; missions: Mission[]; stars: number }
interface Perk {
  id: string; name: string; icon: string; cost: number;
  effect: { type: string; need?: string; pct: number };
  desc: string;
}
interface PerksData { stars: number; owned: string[]; perks: Perk[] }

const naira = (n: number) => "₦" + Number(n).toLocaleString("en-NG");

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "ending…";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

export function DailyTab({ you, send, api }: DailyTabProps) {
  const { toast } = useToast();
  const [hunt, setHunt] = useState<HuntData | null>(null);
  const [hustle, setHustle] = useState<HustleData | null>(null);
  const [perks, setPerks] = useState<PerksData | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, hu, p] = await Promise.all([
        api.get("/api/v2/m9/hunt").catch(() => null),
        api.get("/api/v2/m9/hustle").catch(() => null),
        api.get("/api/v2/m9/perks").catch(() => null),
      ]);
      if (h) setHunt(h);
      if (hu) setHustle(hu);
      if (p) setPerks(p);
    } catch {
      /* offline — keep last state */
    }
  }, [api]);

  useEffect(() => {
    load();
    const iv = setInterval(() => setNow(Date.now()), 1000);
    const slow = setInterval(load, 60000);
    return () => { clearInterval(iv); clearInterval(slow); };
  }, [load]);

  // Server processes the WS act quickly; refetch shortly after.
  const act = useCallback((a: string, params?: Record<string, unknown>, key?: string) => {
    if (key) setBusy(key);
    send(a, params);
    setTimeout(() => { load(); setBusy(null); }, 900);
  }, [send, load]);

  const stars = useMemo(
    () => (typeof you?.perk_stars === "number" ? you.perk_stars : perks?.stars ?? 0),
    [you, perks]
  );

  return (
    <div className="m9-daily">
      {/* ---------------- Treasure hunt ---------------- */}
      <Card className="m9-card">
        <div className="m9-card-head">
          <h2>🗺️ Treasure Hunt</h2>
          {hunt?.round && (
            <span className="m9-countdown" aria-live="off">
              ⏳ {fmtCountdown(hunt.round.endsAt - now)}
            </span>
          )}
        </div>
        {!hunt ? (
          <p className="m9-muted">Loading the riddle…</p>
        ) : !hunt.round ? (
          <p className="m9-muted">No riddle live yet — check back soon.</p>
        ) : (
          <>
            <p className="m9-riddle">“{hunt.round.riddle}”</p>
            <p className="m9-muted">{hunt.round.claims} finder{hunt.round.claims === 1 ? "" : "s"} so far</p>
            {hunt.myPlace > 0 ? (
              <p className="m9-found">✅ You found it — #{hunt.myPlace}!</p>
            ) : (
              <Button
                variant="accent"
                size="lg"
                className="m9-cta"
                disabled={busy === "hunt"}
                onClick={() => {
                  act("hunt_claim", {}, "hunt");
                  toast("🗺️ Claiming… stand at the riddle's spot!");
                }}
              >
                {busy === "hunt" ? "Claiming…" : "Claim the treasure"}
              </Button>
            )}
            <details className="m9-details">
              <summary>Prize tiers</summary>
              <ul className="m9-tiers">
                {hunt.prizes.map(p => (
                  <li key={p.label}><span>{p.label}</span><strong>{naira(p.amount)}</strong></li>
                ))}
              </ul>
            </details>
            {hunt.leaders.length > 0 && (
              <div className="m9-leaders">
                <h3>🏆 Top finders</h3>
                <ol>
                  {hunt.leaders.map(l => (
                    <li key={l.place}>
                      <span className="m9-place">#{l.place}</span>
                      <span className="m9-who">{l.username}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ---------------- Today's Hustle ---------------- */}
      <Card className="m9-card">
        <div className="m9-card-head">
          <h2>💪 Today's Hustle</h2>
          <span className="m9-stars" title="Perk stars">✨ {stars}</span>
        </div>
        {!hustle ? (
          <p className="m9-muted">Loading today's missions…</p>
        ) : (
          <ul className="m9-missions">
            {hustle.missions.map(m => (
              <li key={m.id} className={`m9-mission ${m.claimed ? "is-claimed" : ""} ${m.done ? "is-done" : ""}`}>
                <div className="m9-mission-main">
                  <span className="m9-mission-check" aria-hidden="true">
                    {m.claimed ? "✅" : m.done ? "☑️" : "⬜"}
                  </span>
                  <div>
                    <p className="m9-mission-label">{m.label}</p>
                    <p className="m9-muted">+{m.reward} ✨</p>
                  </div>
                </div>
                {!m.claimed && (
                  <Button
                    variant={m.done ? "primary" : "ghost"}
                    disabled={!m.done || busy === m.id}
                    onClick={() => act("hustle_claim", { missionId: m.id }, m.id)}
                  >
                    {busy === m.id ? "…" : m.done ? "Claim" : "Locked"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------- Perks shop ---------------- */}
      <Card className="m9-card">
        <div className="m9-card-head">
          <h2>🌟 Perks Shop</h2>
          <span className="m9-stars" title="Perk stars">✨ {stars}</span>
        </div>
        <p className="m9-muted">Spend stars earned from Today's Hustle. Perks apply automatically.</p>
        {!perks ? (
          <p className="m9-muted">Loading perks…</p>
        ) : (
          <div className="m9-perk-grid">
            {perks.perks.map(p => {
              const owned = perks.owned.includes(p.id);
              const afford = stars >= p.cost;
              return (
                <div key={p.id} className={`m9-perk ${owned ? "is-owned" : ""}`}>
                  <div className="m9-perk-icon" aria-hidden="true">{p.icon}</div>
                  <div className="m9-perk-body">
                    <p className="m9-perk-name">{p.name}</p>
                    <p className="m9-perk-desc">{p.desc}</p>
                    <div className="m9-perk-foot">
                      <span className="m9-perk-cost">✨ {p.cost}</span>
                      {owned ? (
                        <span className="m9-owned">Owned</span>
                      ) : (
                        <Button
                          variant="primary"
                          disabled={!afford || busy === p.id}
                          onClick={() => act("perk_buy", { perk: p.id }, p.id)}
                        >
                          {busy === p.id ? "…" : afford ? "Buy" : "Need ✨"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
