import { useCallback, useEffect, useState } from "react";
import { authGet, authPost } from "../../lib/api";
import { Button, Card, StatBar, useToast, EmptyState } from "../../components";
import "./vitality.css";

/* ------------------------------------------------------------------ */
/* P1 — Sim-panel tabs (Character panel: Needs, Mood, Skills, Perks,    */
/* Goals, Quests). All reads go through /api/vitality/* REST; perk     */
/* purchases and hustle claim/swap go through WS acts (server-validated)*/
/* exactly like DailyTab does. Visual language: current tokens only.   */
/* ------------------------------------------------------------------ */

export interface SimSend {
  (a: string, params?: Record<string, unknown>): void;
}

interface NeedVals { [k: string]: number }
interface Moodlet { key: string; label: string; effects: unknown[]; expiresInMs: number }
interface Trait { id: string; name: string; blurb: string }
interface SkillRow {
  id: string; name: string; icon: string; level: number; xp: number;
  effective: number; rust: number; rusty: boolean; lastUsed: number;
}
interface Wish { id: string; name: string; icon: string; text: string; gems: number; done: boolean; claimed: boolean }
interface GoalInfo { id: string; name: string; icon: string; text: string; money: number; rep: number; done: boolean }
interface DreamInfo { id: string; text: string; setAt: number; progress: number | null; changeInMs: number }
interface RepInfo { level: number; title: string; icon: string; xp: number; xpIntoLevel: number; xpForNext: number; nextTitle: string | null; maxed: boolean }
interface StreakInfo { count: number; claimedToday: boolean; next: { money: number; rep: number }; resetsInMs: number }
interface SleepMode { id: string; name: string; icon: string; secs: number; energy: number; fun: number; blurb: string }
interface TimerState { sleep: { mode: string; endsAt: number; startedAt: number } | null; cook: { recipeId: string; endsAt: number; startedAt: number } | null }

export interface SimState {
  needs: NeedVals;
  moodlets: Moodlet[];
  traits: Trait[];
  kitchen: { items: Record<string, number>; guestsOk: boolean; hasKitchen: boolean };
  timers: TimerState;
  sleepModes: SleepMode[];
  hasBed: boolean;
  dream: (DreamInfo & { progress: number | null }) | null;
  dreams: { id: string; text: string }[];
  rep: RepInfo;
  streak: StreakInfo;
  wishes: Wish[];
  wishSwapLeft: number;
  goal: GoalInfo;
  gems: number;
  skills: SkillRow[];
  netWorth: number;
}

/* Shared fetch hook: one in-flight request per token, 15s cache. */
const simCache = new Map<string, { at: number; data: SimState | null; promise: Promise<SimState> | null }>();

export function useVitality(token: string) {
  const [state, setState] = useState<SimState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState(Date.now());

  const refresh = useCallback(async () => {
    const d = await authGet<SimState>("/api/vitality/state", token);
    simCache.set(token, { at: Date.now(), data: d, promise: null });
    setState(d);
    setFetchedAt(Date.now());
    setLoading(false);
    return d;
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const c = simCache.get(token);
    if (c && c.data && Date.now() - c.at < 15000) {
      setState(c.data);
      setFetchedAt(c.at);
      setLoading(false);
      return;
    }
    const p = c && c.promise ? c.promise : refresh().catch(() => null);
    if (c && !c.promise) simCache.set(token, { at: 0, data: null, promise: p as Promise<SimState> });
    p.then((d) => { if (!cancelled && d) { setState(d); setFetchedAt(Date.now()); setLoading(false); } })
     .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, refresh]);

  return { state, loading, refresh, fetchedAt };
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return "done";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function fmtHours(ms: number): string {
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function useNowTick(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const NEED_DEFS = [
  { id: "hunger", label: "Hunger", icon: "🍲" },
  { id: "energy", label: "Energy", icon: "⚡" },
  { id: "fun", label: "Fun", icon: "🎮" },
  { id: "social", label: "Social", icon: "🗣️" },
  { id: "hygiene", label: "Hygiene", icon: "🚿" },
  { id: "bladder", label: "Bladder", icon: "🚻" },
];

/* ------------------------------ Needs ------------------------------ */
export function SimNeedsTab({ token }: { token: string }) {
  const { toast } = useToast();
  const { state, loading, refresh } = useVitality(token);
  const [busy, setBusy] = useState<string | null>(null);
  const hasTimer = !!(state && (state.timers.sleep || state.timers.cook));
  const now = useNowTick(hasTimer);

  const post = useCallback(async (path: string, body: unknown, busyKey: string) => {
    setBusy(busyKey);
    try {
      const r = (await authPost<any>(`/api/vitality${path}`, token, body)) as any;
      if (r && r.error) toast(r.error);
      else toast("Done ✓");
      await refresh();
      return r;
    } catch (e: any) {
      toast(e?.message || "Something went wrong.");
      return null;
    } finally {
      setBusy(null);
    }
  }, [token, toast, refresh]);

  if (loading || !state) return <p className="vit-muted">Loading your Sim…</p>;

  const sleep = state.timers.sleep;
  const cook = state.timers.cook;
  const sleepMode = sleep ? state.sleepModes.find((m) => m.id === sleep.mode) : null;

  return (
    <div className="vit-stack">
      <Card>
        <h3 className="vit-h">💚 Needs</h3>
        <div className="vit-needs">
          {NEED_DEFS.map((n) => (
            <StatBar key={n.id} label={n.label} icon={n.icon} value={state.needs[n.id] ?? 100} />
          ))}
        </div>
        <p className="vit-muted vit-small">Needs drift down slowly in real time — about 1–2 points every 15 minutes. Eat, sleep, baff and have fun to keep them green.</p>
      </Card>

      <Card>
        <h3 className="vit-h">🛏️ Bed</h3>
        {!state.hasBed && (
          <EmptyState emoji="🛏️" title="No bed yet" body="Place a bed at home (Buy mode) to unlock proper rest." />
        )}
        {state.hasBed && !sleep && (
          <div className="vit-row3">
            {state.sleepModes.map((m) => (
              <div key={m.id} className="vit-action">
                <div className="vit-action__icon" aria-hidden="true">{m.icon}</div>
                <strong>{m.name}</strong>
                <small className="vit-muted">{m.blurb}</small>
                <small className="vit-muted">+{m.energy} energy{m.fun ? ` · +${m.fun} fun` : ""} · {m.secs}s · free</small>
                <Button disabled={busy === m.id} onClick={() => post("/sleep/start", { mode: m.id }, m.id)}>
                  {busy === m.id ? "…" : "Start"}
                </Button>
              </div>
            ))}
          </div>
        )}
        {state.hasBed && sleep && sleepMode && (
          <div className="vit-timer">
            <div><strong>{sleepMode.icon} {sleepMode.name}</strong> — {fmtCountdown(sleep.endsAt - now)} left</div>
            <div className="vit-btnrow">
              <Button disabled={busy === "sleepdone"} onClick={() => post("/sleep/finish", {}, "sleepdone")}>Wake up</Button>
              <Button variant="ghost" disabled={busy === "sleepcancel"} onClick={() => post("/sleep/cancel", {}, "sleepcancel")}>Cancel (half rest)</Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="vit-h">🍳 Kitchen</h3>
        {!state.kitchen.hasKitchen && (
          <EmptyState emoji="🍳" title="No kitchen setup" body="Place a kitchen item (stove, fridge…) at home to start cooking." />
        )}
        {state.kitchen.hasKitchen && (
          <CookPanel
            token={token}
            cook={cook}
            now={now}
            busy={busy}
            onAction={post}
          />
        )}
      </Card>
    </div>
  );
}

interface RecipeInfo {
  id: string; name: string; icon: string; secs: number;
  needs: Record<string, number>; hunger: number; fun: number;
  favorite: boolean; xp: number; blurb: string;
  missing: Record<string, number>;
}
interface IngredientInfo { id: string; name: string; icon: string; price: number }

function CookPanel({ token, cook, now, busy, onAction }: {
  token: string;
  cook: TimerState["cook"];
  now: number;
  busy: string | null;
  onAction: (path: string, body: unknown, busyKey: string) => Promise<any>;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<{ recipes: RecipeInfo[]; ingredients: IngredientInfo[]; pantry: Record<string, number>; guestsOk: boolean } | null>(null);
  const [showShop, setShowShop] = useState(false);
  const naira = (n: number) => "₦" + Number(n).toLocaleString("en-NG");

  useEffect(() => {
    let cancelled = false;
    authGet<any>("/api/vitality/recipes", token)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, cook]);

  const buyMissing = async (r: RecipeInfo) => {
    const items: Record<string, number> = {};
    for (const [id, qty] of Object.entries(r.missing || {})) items[id] = qty;
    if (!Object.keys(items).length) return;
    const res = await onAction("/kitchen/buy", { items }, `buy-${r.id}`);
    if (res && res.ok) {
      const d = await authGet<any>("/api/vitality/recipes", token).catch(() => null);
      if (d) setData(d);
    }
  };

  const toggleGuests = async () => {
    try {
      const r = await authPost<any>("/api/vitality/kitchen/guests", token, { allow: !data?.guestsOk });
      if (r && typeof r.guestsOk === "boolean") {
        setData((d) => (d ? { ...d, guestsOk: r.guestsOk } : d));
        toast(r.guestsOk ? "Guests can use your kitchen 🍳" : "Kitchen is private again 🔒");
      }
    } catch { toast("Could not update the toggle."); }
  };

  if (!data) return <p className="vit-muted">Loading recipes…</p>;

  return (
    <div className="vit-stack">
      {cook && (
        <div className="vit-timer">
          <div><strong>🔥 Cooking…</strong> {fmtCountdown(cook.endsAt - now)} left</div>
          <div className="vit-btnrow">
            <Button disabled={busy === "cookdone"} onClick={() => onAction("/cook/finish", {}, "cookdone")}>Serve it</Button>
            <Button variant="ghost" disabled={busy === "cookcancel"} onClick={() => onAction("/cook/cancel", {}, "cookcancel")}>Abandon pot</Button>
          </div>
        </div>
      )}
      <label className="vit-switchrow">
        <span><strong>🍳 Guests can use my kitchen</strong><small className="vit-muted">Let visitors cook here</small></span>
        <button type="button" role="switch" aria-checked={data.guestsOk}
          className={`eko-switch${data.guestsOk ? " eko-switch--on" : ""}`} onClick={toggleGuests}>
          <span className="eko-switch__knob" aria-hidden="true" />
        </button>
      </label>
      <div className="vit-recipes">
        {data.recipes.map((r) => {
          const missingIds = Object.keys(r.missing || {});
          const locked = missingIds.length > 0;
          return (
            <div key={r.id} className={`vit-recipe${locked ? " vit-recipe--locked" : ""}`}>
              <div className="vit-recipe__head">
                <span aria-hidden="true">{r.icon}</span>
                <strong>{r.name}</strong>
                {r.favorite && <span className="vit-pill" title="Extra fun">⭐ fave</span>}
              </div>
              <small className="vit-muted">{r.blurb}</small>
              <small className="vit-muted">+{r.hunger} hunger{r.fun ? ` · +${r.fun} fun` : ""} · {r.secs}s · +{r.xp} cooking XP</small>
              {locked && (
                <small className="vit-warn">Missing: {missingIds.map((id) => {
                  const ing = data.ingredients.find((i) => i.id === id);
                  return `${ing ? ing.icon + " " + ing.name : id}×${r.missing[id]}`;
                }).join(", ")}</small>
              )}
              <div className="vit-btnrow">
                {locked ? (
                  <Button variant="ghost" disabled={busy === `buy-${r.id}`} onClick={() => buyMissing(r)}>
                    {busy === `buy-${r.id}` ? "…" : "🛵 Buy missing"}
                  </Button>
                ) : (
                  <Button disabled={!!cook || busy === `cook-${r.id}`} onClick={() => onAction("/cook/start", { recipeId: r.id }, `cook-${r.id}`)}>
                    {busy === `cook-${r.id}` ? "…" : "Cook"}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Button variant="ghost" onClick={() => setShowShop((s) => !s)}>
        {showShop ? "Hide grocery shop ▴" : "🛒 Grocery shop ▾"}
      </Button>
      {showShop && (
        <div className="vit-shop">
          {data.ingredients.map((ing) => (
            <div key={ing.id} className="vit-shop__row">
              <span>{ing.icon} {ing.name} <small className="vit-muted">×{data.pantry[ing.id] || 0}</small></span>
              <Button variant="ghost" disabled={busy === `ing-${ing.id}`}
                onClick={() => onAction("/kitchen/buy", { items: { [ing.id]: 1 } }, `ing-${ing.id}`).then(async (res) => {
                  if (res && res.ok) {
                    const d = await authGet<any>("/api/vitality/recipes", token).catch(() => null);
                    if (d) setData(d);
                  }
                })}>
                {naira(ing.price)}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Mood ------------------------------ */
export function SimMoodTab({ token }: { token: string }) {
  const { state, loading, fetchedAt } = useVitality(token);
  const [catalog, setCatalog] = useState<{ key: string; label: string; cause: string; modifier: string; durationMs: number }[] | null>(null);
  const now = useNowTick(!!(state && state.moodlets.length));

  useEffect(() => {
    authGet<any>("/api/vitality/feelings", token).then((d) => setCatalog(d.feelings)).catch(() => {});
  }, [token]);

  if (loading || !state) return <p className="vit-muted">Loading feelings…</p>;
  return (
    <div className="vit-stack">
      <Card>
        <h3 className="vit-h">✨ Active feelings</h3>
        {state.moodlets.length === 0 && <p className="vit-muted">No strong feelings right now. Eat good food, party, or call your people.</p>}
        <ul className="vit-list">
          {state.moodlets.map((m) => (
            <li key={m.key} className="vit-list__row">
              <div><strong>{m.label}</strong><small className="vit-muted"> · fades in {fmtCountdown(Math.max(0, m.expiresInMs - (now - fetchedAt)))}</small></div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3 className="vit-h">🧠 Your traits</h3>
        <p className="vit-muted vit-small">Just flavour — traits never change your numbers.</p>
        <div className="vit-traits">
          {state.traits.map((t) => (
            <span key={t.id} className="vit-pill" title={t.blurb}>{t.name}</span>
          ))}
        </div>
      </Card>
      <Card>
        <h3 className="vit-h">📖 Feelings guide</h3>
        <p className="vit-muted vit-small">What life in Èkó can make you feel — and what each feeling does.</p>
        <ul className="vit-list">
          {(catalog || []).map((f) => (
            <li key={f.key} className="vit-list__row">
              <div>
                <strong>{f.label}</strong>
                <div><small className="vit-muted">{f.cause}</small></div>
                <div><small className="vit-accent">{f.modifier} · lasts {fmtHours(f.durationMs)}</small></div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------ Skills ------------------------------ */
function Pips({ level }: { level: number }) {
  const pips = [];
  for (let i = 1; i <= 10; i++) {
    pips.push(<span key={i} className={`vit-pip${i <= level ? " vit-pip--on" : ""}`} aria-hidden="true" />);
  }
  return (
    <span className="vit-pips" role="img" aria-label={`Level ${level} of 10`}>
      {pips}
    </span>
  );
}

export function SimSkillsTab({ token }: { token: string }) {
  const { state, loading } = useVitality(token);
  if (loading || !state) return <p className="vit-muted">Loading skills…</p>;
  return (
    <div className="vit-stack">
      <Card>
        <h3 className="vit-h">💪 Skills</h3>
        <p className="vit-muted vit-small">Train around the city to level up. Ignore a skill for 7+ days and it gets rusty — about a level every 20 days, never more than 2 under your best, never under level 1. Using it stops the rust.</p>
        <ul className="vit-list">
          {state.skills.map((s) => (
            <li key={s.id} className="vit-list__row vit-skill">
              <div className="vit-skill__head">
                <span aria-hidden="true">{s.icon}</span>
                <strong>{s.name}</strong>
                {s.rusty && <span className="vit-pill vit-pill--warn" title="Use it to stop the fade">🧹 rusty −{s.rust}</span>}
              </div>
              <div className="vit-skill__pips">
                <Pips level={Math.min(10, s.effective)} />
                <small className="vit-muted">Lv {s.effective}{s.effective !== s.level ? ` (base ${s.level})` : ""}</small>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------ Perks ------------------------------ */
interface PerkDef {
  id: string; name: string; icon: string; cost: number;
  effect: { type: string; need?: string; pct: number }; desc: string;
}

export function SimPerksTab({ token, send }: { token: string; send?: SimSend }) {
  const { toast } = useToast();
  const { state, refresh } = useVitality(token);
  const [perks, setPerks] = useState<{ stars: number; owned: string[]; perks: PerkDef[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await authGet<any>("/api/v2/m9/perks", token);
      setPerks(d);
    } catch { /* offline */ }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const buy = (p: PerkDef) => {
    if (!send) { toast("Connect to buy perks."); return; }
    setBusy(p.id);
    send("perk_buy", { perk: p.id });
    toast(`${p.icon} Buying ${p.name}…`);
    window.setTimeout(async () => { await load(); await refresh(); setBusy(null); }, 1200);
  };

  return (
    <div className="vit-stack">
      <Card>
        <h3 className="vit-h">✨ Perks <small className="vit-muted">· {perks ? perks.stars : state?.gems ?? 0}✨</small></h3>
        <p className="vit-muted vit-small">One-time unlocks bought with ✨ gems. Earn gems from wishes, quests and stories.</p>
        <ul className="vit-list">
          {(perks?.perks || []).map((p) => {
            const owned = perks?.owned.includes(p.id);
            const afford = (perks?.stars ?? 0) >= p.cost;
            return (
              <li key={p.id} className="vit-list__row">
                <div className="vit-perk">
                  <span aria-hidden="true" className="vit-perk__icon">{p.icon}</span>
                  <div>
                    <strong>{p.name}</strong>
                    <div><small className="vit-muted">{p.desc}</small></div>
                  </div>
                </div>
                <div className="vit-btnrow">
                  {owned ? (
                    <span className="vit-pill">Owned ✓</span>
                  ) : (
                    <Button disabled={!afford || busy === p.id || !send} onClick={() => buy(p)}>
                      {busy === p.id ? "…" : `${p.cost}✨`}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

/* ------------------------------ Goals ------------------------------ */
export function SimGoalsTab({ token }: { token: string }) {
  const { toast } = useToast();
  const { state, loading, refresh } = useVitality(token);
  const [busy, setBusy] = useState<string | null>(null);
  const [dreamPick, setDreamPick] = useState("");

  const post = useCallback(async (path: string, body: unknown, busyKey: string, doneMsg: string) => {
    setBusy(busyKey);
    try {
      const r = (await authPost<any>(`/api/vitality${path}`, token, body)) as any;
      if (r && r.error) toast(r.error);
      else toast(doneMsg);
      await refresh();
      return r;
    } catch (e: any) {
      toast(e?.message || "Something went wrong.");
      return null;
    } finally {
      setBusy(null);
    }
  }, [token, toast, refresh]);

  if (loading || !state) return <p className="vit-muted">Loading goals…</p>;
  const naira = (n: number) => "₦" + Number(n).toLocaleString("en-NG");

  return (
    <div className="vit-stack">
      <Card>
        <h3 className="vit-h">🎯 Goal card</h3>
        <div className="vit-goal">
          <div><span aria-hidden="true">{state.goal.icon}</span> <strong>{state.goal.name}</strong></div>
          <p className="vit-muted">{state.goal.text}</p>
          <small className="vit-muted">Reward: {naira(state.goal.money)} · +{state.goal.rep} rep</small>
          <div className="vit-btnrow">
            <Button disabled={!state.goal.done || busy === "goal"} onClick={() => post("/goals/claim", {}, "goal", "🎯 Goal complete!")}>
              {busy === "goal" ? "…" : state.goal.done ? "Claim 🎉" : "Not done yet"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="vit-h">🌠 Wishes <small className="vit-muted">· {state.gems}✨</small></h3>
        <p className="vit-muted vit-small">Complete a wish for ✨ gems. One free swap per day.</p>
        <ul className="vit-list">
          {state.wishes.map((w) => (
            <li key={w.id} className="vit-list__row">
              <div>
                <span aria-hidden="true">{w.icon}</span> <strong>{w.name}</strong>
                <div><small className="vit-muted">{w.text} · +{w.gems}✨</small></div>
              </div>
              <div className="vit-btnrow">
                {w.done ? (
                  <Button disabled={busy === `wish-${w.id}`} onClick={() => post("/wishes/claim", { id: w.id }, `wish-${w.id}`, `🌠 Wish granted! +${w.gems}✨`)}>
                    {busy === `wish-${w.id}` ? "…" : "Claim"}
                  </Button>
                ) : (
                  <Button variant="ghost" disabled={state.wishSwapLeft < 1 || busy === `swap-${w.id}`}
                    onClick={() => post("/wishes/swap", { id: w.id }, `swap-${w.id}`, "🔄 Wish swapped")}>
                    Swap
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <small className="vit-muted">Swaps left today: {state.wishSwapLeft}</small>
      </Card>

      <Card>
        <h3 className="vit-h">🏆 Lifetime dream</h3>
        {state.dream ? (
          <div>
            <p><strong>{state.dream.text}</strong></p>
            {state.dream.progress != null && (
              <div className="vit-progress">
                <div className="vit-progress__fill" style={{ width: `${Math.round(state.dream.progress * 100)}%` }} />
              </div>
            )}
            <small className="vit-muted">
              {state.dream.progress != null ? `${Math.round(state.dream.progress * 100)}% there` : ""}
              {state.dream.changeInMs > 0 ? ` · changeable in ${fmtHours(state.dream.changeInMs)}` : " · can change now"}
            </small>
          </div>
        ) : (
          <p className="vit-muted">No dream yet — pick one that scares you a little.</p>
        )}
        <div className="vit-btnrow" style={{ marginTop: 8 }}>
          <select className="vit-select" value={dreamPick} onChange={(e) => setDreamPick(e.target.value)} aria-label="Pick a dream">
            <option value="">Choose a dream…</option>
            {state.dreams.map((d) => (
              <option key={d.id} value={d.id}>{d.text}</option>
            ))}
          </select>
          <Button disabled={!dreamPick || busy === "dream"} onClick={() => post("/dream", { id: dreamPick }, "dream", "🏆 Dream set!")}>
            {busy === "dream" ? "…" : "Set dream"}
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="vit-h">{state.rep.icon} Lagos Rep — Lv {state.rep.level} {state.rep.title}</h3>
        <div className="vit-progress">
          <div className="vit-progress__fill" style={{ width: state.rep.maxed ? "100%" : `${Math.round((state.rep.xpIntoLevel / Math.max(1, state.rep.xpForNext)) * 100)}%` }} />
        </div>
        <small className="vit-muted">
          {state.rep.xp} XP{state.rep.maxed ? " · maxed out 👑" : ` · ${state.rep.nextTitle} at Lv ${state.rep.level + 1}`}
        </small>
      </Card>
    </div>
  );
}

/* ------------------------------ Quests ------------------------------ */
interface HustleMission { id: string; label: string; reward: number; prize: { tier: string; money: number; rep: number }; done: boolean; claimed: boolean }
interface HustleData { dayKey: string; missions: HustleMission[]; stars: number; resetsInMs: number; swapLeft: number; allDoneBonus: { money: number; gems: number; rep: number }; bonusClaimed: boolean }
interface GemData { clue: string; nextGemInMs: number; count: number; mine: { prize: number; rank: number } | null; nextPrize: number }
interface StoryItem { id: number; title: string; synopsis: string; coverEmoji: string; locked: boolean; netWorthReq: number; rewardRep: number; rewardGems: number; completed: boolean; progress: { chapterNo: number; sceneNo: number } | null }

export function SimQuestsTab({ token, send }: { token: string; send?: SimSend }) {
  const { toast } = useToast();
  const { state, loading, refresh } = useVitality(token);
  const [hustle, setHustle] = useState<HustleData | null>(null);
  const [gem, setGem] = useState<GemData | null>(null);
  const [stories, setStories] = useState<StoryItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const naira = (n: number) => "₦" + Number(n).toLocaleString("en-NG");

  const load = useCallback(async () => {
    try {
      const [h, g, s] = await Promise.all([
        authGet<any>("/api/v2/m9/hustle", token),
        authGet<any>("/api/gem", token),
        authGet<any>("/api/stories", token),
      ]);
      setHustle(h); setGem(g);
      setStories(s.stories || []);
    } catch { /* offline */ }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const wsThenReload = (a: string, params: Record<string, unknown>, msg: string, busyKey: string) => {
    if (!send) { toast("Connect to do that."); return; }
    setBusy(busyKey);
    send(a, params);
    toast(msg);
    window.setTimeout(async () => { await load(); await refresh(); setBusy(null); }, 1500);
  };

  const claimStreak = async () => {
    setBusy("streak");
    try {
      const r = (await authPost<any>("/api/vitality/streak/claim", token, {})) as any;
      toast(r && r.error ? r.error : `🔥 Day ${r.count} streak! +${naira(r.money)} +${r.rep} rep`);
      await refresh();
    } catch (e: any) { toast(e?.message || "Check-in failed."); }
    finally { setBusy(null); }
  };

  if (loading || !state) return <p className="vit-muted">Loading quests…</p>;

  return (
    <div className="vit-stack">
      <Card>
        <h3 className="vit-h">🔥 Daily check-in <small className="vit-muted">· {state.streak.count}-day streak</small></h3>
        <p className="vit-muted vit-small">
          Next check-in: +{naira(state.streak.next.money)} +{state.streak.next.rep} rep · new day in {fmtHours(state.streak.resetsInMs)}
        </p>
        <Button disabled={state.streak.claimedToday || busy === "streak"} onClick={claimStreak}>
          {busy === "streak" ? "…" : state.streak.claimedToday ? "Checked in ✓" : "Check in"}
        </Button>
      </Card>

      <Card>
        <h3 className="vit-h">💪 Today's Hustle <small className="vit-muted">· new missions in {fmtHours(hustle?.resetsInMs ?? 0)}</small></h3>
        {!hustle && <p className="vit-muted">Loading missions…</p>}
        <ul className="vit-list">
          {(hustle?.missions || []).map((m) => (
            <li key={m.id} className="vit-list__row">
              <div>
                <strong>{m.done ? "✅ " : ""}{m.label}</strong>
                <div><small className="vit-muted">+{m.reward}✨ · +{naira(m.prize?.money ?? 0)} · +{m.prize?.rep ?? 0} rep</small></div>
              </div>
              <div className="vit-btnrow">
                {m.claimed ? <span className="vit-pill">Claimed ✓</span> : m.done ? (
                  <Button disabled={busy === `h-${m.id}`}
                    onClick={() => wsThenReload("hustle_claim", { missionId: m.id }, "Claiming… 🎉", `h-${m.id}`)}>
                    {busy === `h-${m.id}` ? "…" : "Claim"}
                  </Button>
                ) : (
                  <Button variant="ghost" disabled={(hustle?.swapLeft ?? 0) < 1 || busy === `s-${m.id}`}
                    onClick={() => wsThenReload("hustle_swap", { missionId: m.id }, "Swapping… 🔄", `s-${m.id}`)}>
                    Swap
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {hustle && (
          <small className="vit-muted">
            Swaps left: {hustle.swapLeft} · All-three bonus: +{naira(hustle.allDoneBonus.money)} +{hustle.allDoneBonus.gems}✨ +{hustle.allDoneBonus.rep} rep
            {hustle.bonusClaimed ? " (claimed ✓)" : ""}
          </small>
        )}
      </Card>

      <Card>
        <h3 className="vit-h">💎 Daily gem hunt</h3>
        {!gem && <p className="vit-muted">Loading hunt…</p>}
        {gem && (
          <div>
            <p><em>“{gem.clue}”</em></p>
            <small className="vit-muted">
              {gem.count} found today · next prize {naira(gem.nextPrize)} · next gem in {fmtHours(gem.nextGemInMs)}
              {gem.mine ? ` · you found it (#${gem.mine.rank}, +${naira(gem.mine.prize)}) ✓` : ""}
            </small>
            <p className="vit-muted vit-small">Travel to the hiding place and search from the Map tab.</p>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="vit-h">📖 Èkó Stories</h3>
        {!stories && <p className="vit-muted">Loading stories…</p>}
        <ul className="vit-list">
          {(stories || []).map((s) => (
            <li key={s.id} className="vit-list__row">
              <div>
                <span aria-hidden="true">{s.coverEmoji}</span> <strong>{s.title}</strong>
                {s.locked && <span className="vit-pill vit-pill--warn">🔒 {naira(s.netWorthReq)} net worth</span>}
                {s.completed && <span className="vit-pill">Done ✓</span>}
                <div><small className="vit-muted">{s.synopsis}</small></div>
                <div><small className="vit-accent">Finish: +{s.rewardRep} rep +{s.rewardGems}✨</small></div>
              </div>
            </li>
          ))}
        </ul>
        <p className="vit-muted vit-small">Read and play stories from the Stories app on your phone tab.</p>
      </Card>
    </div>
  );
}
