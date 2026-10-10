// ============================================================
// v2/m11.js — M11: Governance with teeth (INTENTS + module surface)
// The winner's policy and the commissioners cabinet live in
// server/src/game/elections.js (M11 may edit it directly); this
// module owns the milestone contract surface: schema exports,
// pure logic, and the three WS `act` intents the coordinator wires
// into actions.js's handleAct (see the INTEGRATION SPEC in the
// milestone report).
// api = { conn, send, broadcast, youSnapshot, err, commit, now,
//         getDay, getGovernorId, pushNews, pushElectionAll }
//   conn: { user, character, cds, pos, furniture }
//   err(text) → {t:'err'} toast — used for ALL rejections
// ============================================================
import {
  POLICIES, PICKABLE_POLICIES, POLICY_PICK_WINDOW_MS, DEFAULT_POLICY_ID,
  COMMISSIONER_TITLES,
  COMMISSIONERS_SCHEMA_SQLITE, COMMISSIONERS_SCHEMA_PG,
  ensureGovernanceSchema, applyPolicy, getPolicyMultipliers,
  appointCommissioner, dismissCommissioner, listCommissioners, isCommissioner,
} from '../elections.js';
import { getMeta, setMeta, getUserByName } from '../../db.js';

// ---- 1. Storage — our own table (elections.js-owned) ----
export const SCHEMA_SQLITE = COMMISSIONERS_SCHEMA_SQLITE;
export const SCHEMA_PG = COMMISSIONERS_SCHEMA_PG;
export async function ensureSchema() {
  await ensureGovernanceSchema();
}

// ---- 2. Pure logic — no DB, no I/O ----
export function isPickablePolicy(id) {
  return PICKABLE_POLICIES.includes(String(id));
}
export function policyWindowOpen(wonAt, now = Date.now()) {
  const w = Number(wonAt) || 0;
  return w > 0 && now - w < POLICY_PICK_WINDOW_MS;
}
export function isKnownTitle(title) {
  return COMMISSIONER_TITLES.some(t => t.title === String(title).trim());
}
export function titleIcon(title) {
  const t = COMMISSIONER_TITLES.find(x => x.title === String(title).trim());
  return t ? t.icon : '🎖️';
}
// Human-readable effect line for a policy's multiplier map (client aid).
export function policyEffectLine(mults) {
  const parts = [];
  if (mults.wage_mult !== 1) parts.push(`pay ×${mults.wage_mult}`);
  if (mults.tax_mult === 0) parts.push('zero income tax');
  else if (mults.tax_mult !== 1) parts.push(`tax ×${mults.tax_mult}`);
  if (mults.market_mult !== 1) parts.push(`shop prices ×${mults.market_mult}`);
  if (mults.event_mult !== 1) parts.push(`city events ×${mults.event_mult}`);
  if (mults.decay_mult !== 1) parts.push(`needs drain ×${mults.decay_mult}`);
  return parts.length ? parts.join(' · ') : 'no economic effect';
}

// Re-export the policy/cabinet surface other milestones need.
export {
  POLICIES, PICKABLE_POLICIES, POLICY_PICK_WINDOW_MS, DEFAULT_POLICY_ID,
  COMMISSIONER_TITLES, getPolicyMultipliers, isCommissioner,
};

// ---- 3. INTENTS ----

// Governor gate — server-derived from the live governor id, never trusted
// from the client.
function governorOnly(api) {
  const govId = Number(api.getGovernorId ? api.getGovernorId() : 0);
  if (!govId || Number(api.conn.user.id) !== govId) {
    api.err('Only the sitting Governor can do that.');
    return false;
  }
  return true;
}

export const INTENTS = {
  // gov_policy {policy} — the winner signs ONE policy per term, within
  // 48h of the tally. Re-pick is allowed inside the window; afterwards
  // the standing policy (or the automatic default) is locked in.
  gov_policy: async (api, msg) => {
    if (!governorOnly(api)) return;
    const { conn, broadcast, err, pushNews, pushElectionAll } = api;
    const id = String(msg.policy || '');
    if (!isPickablePolicy(id)) { err('Unknown policy. Pick one from the State House list.'); return; }
    const wonAt = Number(await getMeta('gov_policy_won_at')) || 0;
    if (!policyWindowOpen(wonAt)) { err('The policy window has closed — the standing policy now applies.'); return; }
    await applyPolicy(id);
    await setMeta('gov_policy_picked', '1');
    const p = POLICIES[id];
    broadcast({ t: 'sys', text: `🏛️ Governor ${conn.user.username} signed the "${p.name}" policy! ${p.desc}` });
    if (pushNews) pushNews('governor', `🏛️ Governor ${conn.user.username} signed "${p.name}" — ${p.desc}`);
    if (pushElectionAll) await pushElectionAll();
    console.log(`[m11] ${conn.user.username} signed policy ${id}`);
  },

  // gov_appoint {username, title} — governor appoints (or re-appoints) a
  // commissioner. One holder per title; appointing replaces the holder.
  gov_appoint: async (api, msg) => {
    if (!governorOnly(api)) return;
    const { conn, broadcast, err, pushNews, pushElectionAll } = api;
    const title = String(msg.title || '').trim();
    if (!isKnownTitle(title)) { err('Unknown commissioner title.'); return; }
    const username = String(msg.username || '').trim().replace(/^@/, '');
    if (!username) { err('Name the player to appoint.'); return; }
    const u = await getUserByName(username);
    if (!u) { err(`No player called @${username}.`); return; }
    await appointCommissioner(title, Number(u.id));
    const icon = titleIcon(title);
    broadcast({ t: 'sys', text: `${icon} Governor ${conn.user.username} appointed @${u.username} — ${title}!` });
    if (pushNews) pushNews('governor', `${icon} @${u.username} appointed ${title} by Governor ${conn.user.username}.`);
    if (pushElectionAll) await pushElectionAll();
    console.log(`[m11] ${conn.user.username} appointed ${u.username} as ${title}`);
  },

  // gov_dismiss {title} — governor vacates a commissioner seat.
  gov_dismiss: async (api, msg) => {
    if (!governorOnly(api)) return;
    const { conn, broadcast, err, pushNews, pushElectionAll } = api;
    const title = String(msg.title || '').trim();
    if (!isKnownTitle(title)) { err('Unknown commissioner title.'); return; }
    const seat = (await listCommissioners()).find(c => c.title === title);
    if (!seat) { err('That seat is already empty.'); return; }
    await dismissCommissioner(title);
    broadcast({
      t: 'sys',
      text: `🎖️ Governor ${conn.user.username} dismissed the ${title}${seat.username ? ` (@${seat.username})` : ''}.`,
    });
    if (pushNews) pushNews('governor', `🎖️ Governor ${conn.user.username} dismissed the ${title}.`);
    if (pushElectionAll) await pushElectionAll();
    console.log(`[m11] ${conn.user.username} dismissed ${title}`);
  },
};
