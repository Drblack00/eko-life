import { useState } from "react";
import { Button, Dialog, EmptyState, useToast } from "../../../components";
import type { GameSocket } from "../../../hooks/useGameSocket";
import type { ActName, ElectionState, You } from "../../../game/types";
import "./m11.css";

/* ------------------------------------------------------------------ */
/* M11 — Governance with teeth: policy banner, policy picker (governor */
/* only), commissioners cabinet. Mounted inside the ElectionSheet by   */
/* the coordinator. Server is authoritative; these are pure views +    */
/* intent senders.                                                     */
/* ------------------------------------------------------------------ */

/** Active-policy payload the server merges into every `{t:'election'}`. */
export interface GovPolicyInfo {
  id: string | null;
  name: string | null;
  icon: string;
  desc: string | null;
  mults: {
    wage_mult: number;
    tax_mult: number;
    event_mult: number;
    market_mult: number;
    decay_mult: number;
  };
  picked: boolean;
  defaulted: boolean;
  set_at: number;
  pick_deadline: number;
  can_pick: boolean;
}

export interface CommissionerInfo {
  title: string;
  user_id: number;
  username: string | null;
  appointed_at: number;
}

type ElectionWithGov = ElectionState & {
  policy?: GovPolicyInfo | null;
  commissioners?: CommissionerInfo[];
};

/** The five policies the governor may sign (mirror of server PICKABLE_POLICIES). */
const PICKABLE = [
  { id: "wage_boost_15", name: "Hustle Pay Rise", icon: "💪", desc: "Shift and gig pay rises 15% across the whole city." },
  { id: "tax_free", name: "Tax-Free Season", icon: "🕊️", desc: "No income tax for the whole term. Keep everything you earn." },
  { id: "market_boom", name: "Market Boom", icon: "🛒", desc: "Shop and furniture prices drop 10% for buyers." },
  { id: "event_fever", name: "Owambe Fever", icon: "🥁", desc: "City events happen twice as often. Turn up!" },
  { id: "soft_life", name: "Soft Life Mode", icon: "🛋️", desc: "Needs drain 15% slower — rest easy, Èkó." },
] as const;

const TITLES = [
  { title: "Commissioner for Hustle", icon: "💼" },
  { title: "Commissioner for Enjoyment", icon: "🎉" },
  { title: "Commissioner for Waka", icon: "🛵" },
  { title: "Commissioner for Chop", icon: "🍲" },
  { title: "Commissioner for Soft Life", icon: "🛋️" },
  { title: "Commissioner for Street Matter", icon: "📣" },
] as const;

function effectLine(m: GovPolicyInfo["mults"]): string {
  const parts: string[] = [];
  if (m.wage_mult !== 1) parts.push(`pay ×${m.wage_mult}`);
  if (m.tax_mult === 0) parts.push("zero income tax");
  else if (m.tax_mult !== 1) parts.push(`tax ×${m.tax_mult}`);
  if (m.market_mult !== 1) parts.push(`shop prices ×${m.market_mult}`);
  if (m.event_mult !== 1) parts.push(`city events ×${m.event_mult}`);
  if (m.decay_mult !== 1) parts.push(`needs drain ×${m.decay_mult}`);
  return parts.join(" · ");
}

function isGovernor(sock: GameSocket, you: You): boolean {
  const g = sock.governor;
  return (
    g !== null &&
    g.name !== null &&
    (g.id === you.id || g.name === you.username || g.name === you.name)
  );
}

function hoursLeft(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 3600000));
}

/* ---------------- Active policy banner ---------------- */

export function PolicyBanner({ sock }: { sock: GameSocket }) {
  const ext = (sock.election ?? null) as ElectionWithGov | null;
  const policy = ext?.policy ?? null;

  if (!policy?.id) {
    return (
      <section className="eko-m11__banner eko-m11__banner--empty" aria-label="City policy">
        <span aria-hidden="true">🏛️</span>
        <div>
          <strong>No policy signed yet</strong>
          <p>
            {policy?.can_pick
              ? `You are the Governor — sign a policy below. ⏳ ${hoursLeft(policy.pick_deadline)}h left, or the default kicks in.`
              : "The Governor has 48h after winning to sign one city-wide policy. It lasts the whole term."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="eko-m11__banner" aria-label="Active city policy">
      <span className="eko-m11__banner-icon" aria-hidden="true">
        {policy.icon}
      </span>
      <div>
        <strong>{policy.name}</strong>
        <span className="eko-m11__tag">
          {policy.defaulted ? "automatic default" : "signed by the Governor"} · this term
        </span>
        <p>{policy.desc}</p>
        <p className="eko-m11__effect">{effectLine(policy.mults)}</p>
      </div>
    </section>
  );
}

/* ---------------- Policy picker (governor only) ---------------- */

export function PolicyPicker({ sock, you }: { sock: GameSocket; you: You }) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState<string | null>(null);
  const ext = (sock.election ?? null) as ElectionWithGov | null;
  const policy = ext?.policy ?? null;

  if (!policy?.can_pick || !isGovernor(sock, you)) return null;

  const send = (id: string) => {
    sock.sendAct("gov_policy" as ActName, { policy: id });
    setConfirm(null);
    toast("🏛️ Policy signed — the whole city feels it.", "success");
  };

  return (
    <section aria-label="Sign a city policy">
      <h3 className="eko-m11__h">🏛️ Sign your term's policy</h3>
      <p className="eko-m11__note">
        One policy per term — it shapes the whole city until the next
        election. ⏳ {hoursLeft(policy.pick_deadline)}h left, else the default
        applies automatically.
      </p>
      <div className="eko-m11__policies">
        {PICKABLE.map((p) => (
          <button
            key={p.id}
            type="button"
            className="eko-m11__policy"
            onClick={() => setConfirm(p.id)}
          >
            <span className="eko-m11__policy-icon" aria-hidden="true">
              {p.icon}
            </span>
            <span className="eko-m11__policy-body">
              <strong>{p.name}</strong>
              <span>{p.desc}</span>
            </span>
          </button>
        ))}
      </div>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Sign this policy?"
      >
        <p className="eko-profile__dialog-text">
          {confirm &&
            (() => {
              const p = PICKABLE.find((x) => x.id === confirm)!;
              return (
                <>
                  <strong>
                    {p.icon} {p.name}
                  </strong>
                  <br />
                  {p.desc} It stays active until the next election.
                </>
              );
            })()}
        </p>
        <div className="eko-profile__dialog-actions">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Not yet
          </Button>
          <Button onClick={() => confirm && send(confirm)}>🏛️ Sign it</Button>
        </div>
      </Dialog>
    </section>
  );
}

/* ---------------- Commissioners cabinet ---------------- */

export function Commissioners({ sock, you }: { sock: GameSocket; you: You }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [title, setTitle] = useState<string>(TITLES[0].title);
  const ext = (sock.election ?? null) as ElectionWithGov | null;
  const commissioners = ext?.commissioners ?? [];
  const iAmGov = isGovernor(sock, you);
  const held = new Set(commissioners.map((c) => c.title));

  const appoint = () => {
    const username = name.trim().replace(/^@/, "");
    if (!username) {
      toast("Type the player's username first.", "error");
      return;
    }
    sock.sendAct("gov_appoint" as ActName, { username, title });
    setName("");
    toast(`🎖️ Appointed @${username} — ${title}.`, "success");
  };

  const dismiss = (t: string) => {
    sock.sendAct("gov_dismiss" as ActName, { title: t });
    toast(`🎖️ Dismissed the ${t}.`, "success");
  };

  return (
    <section aria-label="Commissioners">
      <h3 className="eko-m11__h">🎖️ Commissioners</h3>
      {commissioners.length === 0 ? (
        <EmptyState
          emoji="🪑"
          title="No commissioners yet"
          body="The Governor can appoint players to cabinet seats — a badge of honour in City Chat."
        />
      ) : (
        <ul className="eko-m11__cabinet">
          {commissioners.map((c) => {
            const icon = TITLES.find((t) => t.title === c.title)?.icon ?? "🎖️";
            return (
              <li key={c.title} className="eko-m11__seat">
                <span aria-hidden="true">{icon}</span>
                <span className="eko-m11__seat-body">
                  <strong>{c.title}</strong>
                  <span>@{c.holder ?? "vacant"}</span>
                </span>
                {iAmGov && (
                  <button
                    type="button"
                    className="eko-m11__dismiss"
                    onClick={() => dismiss(c.title)}
                    aria-label={`Dismiss the ${c.title}`}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {iAmGov && (
        <form
          className="eko-m11__appoint"
          onSubmit={(e) => {
            e.preventDefault();
            appoint();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="@username to appoint…"
            maxLength={16}
            aria-label="Player username"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <select
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Commissioner title"
          >
            {TITLES.map((t) => (
              <option key={t.title} value={t.title}>
                {t.icon} {t.title}
                {held.has(t.title) ? " (re-appoint)" : ""}
              </option>
            ))}
          </select>
          <Button type="submit" size="md" disabled={!name.trim()}>
            Appoint
          </Button>
        </form>
      )}
    </section>
  );
}
