// ============================================================
// game/actions.js — Èkó Life server-authoritative actions (M3)
// The server is the ONLY writer of money/stats: client values are
// never trusted (every number is re-derived or validated here).
// Flow per action: validate → mutate → ledger row (money moves only)
// → saveCharacter → push updated `you` snapshot + note.
// Unknown action → {t:'err'} toast, never a silent failure.
// ============================================================
import {
  CLASSES, JOBS, FOOD, FUN, LOCATIONS, HOUSING,
  PROPERTIES, BIZ, VEHICLES, FURN, FURN_EFFECTS, HOME_SLOTS,
  BANK, STARTER_LOAN_AMOUNT, TRAVEL_FARES, STUDY_COST, COLLECT_RADIUS,
  cleanText,
} from './data.js';
import { clamp, chargeRent, applyDayEconomy, furnitureEffects, distUnits } from './sim.js';
import {
  RUN_FEE, GOV_BROADCAST_COOLDOWN_MS,
  currentElection, listCandidates, addCandidate, hasVoted, castVote,
  playerElectionState,
} from './elections.js';
import {
  addTransaction, saveCharacter,
  addFurniture, listFurniture, getFurnitureById, setFurniturePlaced, countPlacedFurniture,
} from '../db.js';

const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');

function locName(id) {
  const l = LOCATIONS.find(x => x.id === id);
  return l ? l.name : String(id);
}

function locTags(id) {
  const l = LOCATIONS.find(x => x.id === id);
  return (l && l.tags) || [];
}

// Final safety net before any persist: integers, stats clamped,
// money floored and NEVER negative.
function harden(c) {
  c.money = Math.max(0, Math.floor(Number(c.money) || 0));
  c.energy = clamp(c.energy, 0, 100);
  c.health = clamp(c.health, 0, 100);
  c.happiness = clamp(c.happiness, 0, 100);
  c.hunger = clamp(c.hunger, 0, 100);
  c.savings = Math.max(0, Math.floor(Number(c.savings) || 0));
  c.loan = Math.max(0, Math.floor(Number(c.loan) || 0));
  c.loan_free = Number(c.loan_free) ? 1 : 0;
}

async function refreshFurniture(conn) {
  conn.furniture = await listFurniture(conn.user.id);
}

// Placed furniture effect hooks for this session (ids only).
function placedFurnitureEffects(conn) {
  const placed = (conn.furniture || []).filter(r => Number(r.placed));
  return furnitureEffects(placed, FURN_EFFECTS);
}

// Travel fare between two locations: ₦0 within a region,
// ₦200 mainland↔island ("danfo fare"), ₦500 for any boat crossing.
export function travelFare(fromId, toId) {
  const from = LOCATIONS.find(x => x.id === fromId);
  const to = LOCATIONS.find(x => x.id === toId);
  if (!from || !to) return TRAVEL_FARES.crossRegion;
  if (from.region === to.region) return TRAVEL_FARES.sameRegion;
  if (from.region === 'lagoon' || to.region === 'lagoon') return TRAVEL_FARES.boat;
  return TRAVEL_FARES.crossRegion;
}

// ctx = { conn, send, broadcast, youSnapshot, spawnAPI? }
// conn = { user, character, cds, pos, furniture }
// spawnAPI = { take(id) } — removes a spawn + broadcasts despawn, returns it
export async function handleAct(ctx, msg) {
  const { conn, send, broadcast, youSnapshot } = ctx;
  const c = conn.character;
  const now = Date.now();
  conn.cds = conn.cds || {};

  const err = (text) => send(conn, { t: 'err', text });
  const cdLeft = (key) => {
    const until = conn.cds[key] || 0;
    return until > now ? Math.ceil((until - now) / 1000) : 0;
  };

  // Persist the mutation: sync position, harden, ledger (money moves only),
  // save, then push the authoritative snapshot.
  const commit = async ({ kind = null, amount = 0, meta = null, note = null } = {}) => {
    c.x = conn.pos.lat;
    c.y = conn.pos.lng;
    harden(c);
    if (kind && amount) {
      await addTransaction(conn.user.id, kind, Math.floor(amount), c.money, meta);
    }
    await saveCharacter(c);
    const out = { t: 'you', you: youSnapshot(conn) };
    if (note) out.note = note;
    send(conn, out);
  };

  const a = msg && typeof msg.a === 'string' ? msg.a : null;
  if (!a) { err('Unknown action.'); return; }

  // ---------- work ----------
  if (a === 'work') {
    const job = JOBS.find(j => j.id === String(msg.job));
    if (!job) { err('Unknown job.'); return; }
    if (c.location_id !== job.locationId) {
      err(`Go to ${locName(job.locationId)} to work as ${job.name}.`); return;
    }
    if (job.certRequired && !Number(c.cert)) {
      err('You need a certificate for this job. Study first.'); return;
    }
    const left = cdLeft('work:' + job.id);
    if (left) { err(`Rest small — ${job.name} available in ${left}s.`); return; }
    if (Number(c.energy) < job.energyCost) { err('Too tired. Eat or sleep first.'); return; }
    const mult = (CLASSES[c.class] || CLASSES.street_smart).payMult || 1;
    const pay = Math.floor(job.pay * mult);
    conn.cds['work:' + job.id] = now + job.cooldownSec * 1000;
    c.energy = clamp(Number(c.energy) - job.energyCost, 0, 100);
    c.money = Math.floor(Number(c.money)) + pay;
    console.log(`[act] ${conn.user.username} worked ${job.id} → +${naira(pay)} (mult ${mult})`);
    await commit({ kind: 'work_pay', amount: pay, meta: { job: job.id }, note: `+${naira(pay)} — ${job.name} shift done 💪` });
    return;
  }

  // ---------- eat (fridge hook: +15 hunger) ----------
  if (a === 'eat') {
    const f = FOOD.find(x => x.id === String(msg.item));
    if (!f) { err('Unknown food.'); return; }
    if (Number(c.money) < f.cost) { err("You can't afford that. Hustle first!"); return; }
    const fx = placedFurnitureEffects(conn);
    c.money = Math.floor(Number(c.money)) - f.cost;
    c.hunger = clamp(Number(c.hunger) + f.hunger + fx.eat.hunger, 0, 100);
    c.energy = clamp(Number(c.energy) + f.energy, 0, 100);
    c.happiness = clamp(Number(c.happiness) + f.happy + fx.eat.happiness, 0, 100);
    console.log(`[act] ${conn.user.username} ate ${f.id} (−${naira(f.cost)})`);
    await commit({ kind: 'food', amount: -f.cost, meta: { item: f.id }, note: `${f.icon} ${f.name} devoured.` });
    return;
  }

  // ---------- fun (tv/sofa hooks: +happiness) ----------
  if (a === 'fun') {
    const f = FUN.find(x => x.id === String(msg.what));
    if (!f) { err('Unknown fun.'); return; }
    if (c.location_id !== f.locationId) {
      err(`Go to ${locName(f.locationId)} for ${f.name}.`); return;
    }
    if (Number(c.money) < f.cost) { err("You can't afford that."); return; }
    if (Number(c.energy) + f.energyDelta < 0) { err('Too tired for that. Rest first.'); return; }
    const fx = placedFurnitureEffects(conn);
    c.money = Math.floor(Number(c.money)) - f.cost;
    c.happiness = clamp(Number(c.happiness) + f.happy + fx.fun.happiness, 0, 100);
    c.energy = clamp(Number(c.energy) + f.energyDelta, 0, 100);
    console.log(`[act] ${conn.user.username} did ${f.id} (−${naira(f.cost)})`);
    await commit({ kind: 'fun', amount: -f.cost, meta: { what: f.id }, note: `${f.icon} ${f.name} — vibes restored ✨` });
    return;
  }

  // ---------- sleep (bed hook: +20 health, AC hook: +10 happiness) ----------
  if (a === 'sleep') {
    const left = cdLeft('sleep');
    if (left) { err(`You just slept. Try again in ${left}s.`); return; }
    conn.cds.sleep = now + 60 * 1000;
    const fx = placedFurnitureEffects(conn);
    c.energy = 100;
    c.hunger = clamp(Number(c.hunger) - 15, 0, 100);
    c.health = clamp(Number(c.health) + 10 + fx.sleep.health, 0, 100);
    c.happiness = clamp(Number(c.happiness) + fx.sleep.happiness, 0, 100);
    console.log(`[act] ${conn.user.username} slept (energy → 100)`);
    await commit({ note: '😴 Fully rested.' });
    return;
  }

  // ---------- rest ----------
  if (a === 'rest') {
    const left = cdLeft('rest'); // 30s soft anti-spam cooldown
    if (left) { err(`Catch your breath — rest again in ${left}s.`); return; }
    conn.cds.rest = now + 30 * 1000;
    c.energy = clamp(Number(c.energy) + 15, 0, 100);
    await commit({ note: '😌 Rested a little. (+15 energy)' });
    return;
  }

  // ---------- travel (fares: same-region free, cross-region ₦200, boat ₦500) ----------
  if (a === 'travel') {
    const loc = LOCATIONS.find(x => x.id === String(msg.locationId));
    if (!loc) { err('Unknown location.'); return; }
    if (c.location_id === loc.id) { err('You are already there.'); return; }
    if (Number(c.energy) < 5) { err('Too tired to travel. Rest first.'); return; }
    const fare = travelFare(c.location_id, loc.id);
    if (Number(c.money) < fare) { err(`You need ${naira(fare)} for this trip.`); return; }
    const fromId = c.location_id;
    if (fare > 0) c.money = Math.floor(Number(c.money)) - fare;
    c.energy = clamp(Number(c.energy) - 5, 0, 100);
    c.location_id = loc.id;
    conn.pos = { lat: loc.x, lng: loc.y }; // M1 wire convention: lat=x, lng=y
    conn.lastMove = { x: loc.x, y: loc.y, t: Date.now() }; // anti-cheat baseline
    console.log(`[act] ${conn.user.username} traveled → ${loc.id} (fare ${naira(fare)})`);
    await commit({
      kind: fare > 0 ? 'travel' : null,
      amount: fare > 0 ? -fare : 0,
      meta: fare > 0 ? { from: fromId, to: loc.id } : null,
      note: `🗺️ Traveled to ${loc.name}${fare > 0 ? ` (${naira(fare)} fare)` : ''}.`,
    });
    broadcast({ t: 'mv', id: conn.user.id, lat: loc.x, lng: loc.y });
    return;
  }

  // ---------- study (campus only; grants cert for cert-gated jobs) ----------
  if (a === 'study') {
    if (!locTags(c.location_id).includes('campus')) {
      err('Study at a campus — Unilag, Lagos Poly or Eti-Osa.'); return;
    }
    if (Number(c.cert)) { err('You already hold a certificate.'); return; }
    if (Number(c.money) < STUDY_COST) { err(`Studying costs ${naira(STUDY_COST)}.`); return; }
    const left = cdLeft('study');
    if (left) { err(`Rest your brain — study again in ${left}s.`); return; }
    conn.cds.study = now + 60 * 1000;
    c.money = Math.floor(Number(c.money)) - STUDY_COST;
    c.cert = 1;
    console.log(`[act] ${conn.user.username} studied → cert granted`);
    await commit({ kind: 'study', amount: -STUDY_COST, meta: { cert: true }, note: '🎓 Certificate earned! Cert-gated jobs unlocked.' });
    return;
  }

  // ---------- rent (housing office only; resets missed-rent counter) ----------
  if (a === 'rent') {
    const h = HOUSING[String(msg.housing)];
    if (!h || h.id === 'bridge') { err('Pick a real rental from the housing office.'); return; }
    if (!locTags(c.location_id).includes('housing_office')) {
      err('Go to a Housing Office to sign a lease.'); return;
    }
    if (c.housing === h.id) { err('You already live there.'); return; }
    c.housing = h.id;
    c.rent_misses = 0;
    console.log(`[act] ${conn.user.username} rented ${h.id}`);
    await commit({ note: `🏠 Lease signed: ${h.name} — ${naira(h.rent)}/day rent.` });
    return;
  }

  // ---------- buy_property (one per player; upgrade = replace, no refund) ----------
  if (a === 'buy_property') {
    const p = PROPERTIES[String(msg.property)];
    if (!p) { err('Unknown property.'); return; }
    if (c.property === p.id) { err('You already own this property.'); return; }
    if (Number(c.money) < p.price) { err(`You need ${naira(p.price)} for the ${p.name}.`); return; }
    c.money = Math.floor(Number(c.money)) - p.price;
    c.property = p.id;
    console.log(`[act] ${conn.user.username} bought property ${p.id} (−${naira(p.price)})`);
    await commit({
      kind: 'buy_property', amount: -p.price, meta: { property: p.id },
      note: `${p.icon} You now own the ${p.name}! +${p.happy} happiness every day.`,
    });
    return;
  }

  // ---------- buy_biz (one business per player; income lands in the day tick) ----------
  if (a === 'buy_biz') {
    const b = BIZ[String(msg.biz)];
    if (!b) { err('Unknown business.'); return; }
    if (c.biz) { err('You already own a business. One empire at a time!'); return; }
    if (Number(c.money) < b.cost) { err(`You need ${naira(b.cost)} to open this.`); return; }
    c.money = Math.floor(Number(c.money)) - b.cost;
    c.biz = b.id;
    console.log(`[act] ${conn.user.username} bought biz ${b.id} (−${naira(b.cost)})`);
    await commit({
      kind: 'buy_biz', amount: -b.cost, meta: { biz: b.id },
      note: `${b.icon} You now own a ${b.name}! Income lands every game day.`,
    });
    return;
  }

  // ---------- buy_vehicle (sets vehicle; move anti-cheat uses the speed mult) ----------
  if (a === 'buy_vehicle') {
    const v = VEHICLES[String(msg.v)];
    if (!v || v.id === 'none') { err('Unknown vehicle.'); return; }
    if (c.vehicle === v.id) { err('You already own this.'); return; }
    if (Number(c.money) < v.cost) { err(`You need ${naira(v.cost)}.`); return; }
    c.money = Math.floor(Number(c.money)) - v.cost;
    c.vehicle = v.id;
    console.log(`[act] ${conn.user.username} bought vehicle ${v.id} (−${naira(v.cost)})`);
    await commit({
      kind: 'buy_vehicle', amount: -v.cost, meta: { vehicle: v.id },
      note: `${v.icon} ${v.name} acquired! You move ${v.mult}x faster.`,
    });
    return;
  }

  // ---------- bank (savings earn 2%/day in the day tick) ----------
  if (a === 'bank') {
    const amt = Math.floor(Number(msg.amount));
    if (!amt || amt <= 0) { err('Enter a valid amount.'); return; }
    if (msg.op === 'deposit') {
      if (Number(c.money) < amt) { err("You don't have that much cash."); return; }
      c.money = Math.floor(Number(c.money)) - amt;
      c.savings = Math.floor(Number(c.savings)) + amt;
      console.log(`[act] ${conn.user.username} deposited ${naira(amt)}`);
      await commit({ kind: 'deposit', amount: -amt, meta: { op: 'deposit', savings: c.savings }, note: `🏦 Deposited ${naira(amt)}. Savings earn 2%/day.` });
      return;
    }
    if (msg.op === 'withdraw') {
      if (Number(c.savings) < amt) { err("You don't have that much saved."); return; }
      c.savings = Math.floor(Number(c.savings)) - amt;
      c.money = Math.floor(Number(c.money)) + amt;
      console.log(`[act] ${conn.user.username} withdrew ${naira(amt)}`);
      await commit({ kind: 'withdraw', amount: amt, meta: { op: 'withdraw', savings: c.savings }, note: `🏦 Withdrew ${naira(amt)}.` });
      return;
    }
    err('Unknown bank operation.'); return;
  }

  // ---------- loan ----------
  // M4 starter-loan gap: street_smart characters carry ONE ₦10,000 loan with a
  // 0% interest flag (starter_loan_available). Claiming it needs no other
  // qualification — request exactly ₦10,000 while the flag is live and no loan
  // is outstanding. Everything else follows the normal rules (≤₦100k, none
  // outstanding, 10%/day interest).
  if (a === 'loan') {
    const amt = Math.floor(Number(msg.amount));
    if (Number(c.starter_loan_available) > 0 && Number(c.loan) <= 0 && amt === STARTER_LOAN_AMOUNT) {
      c.starter_loan_available = 0; // consumed — one per character, forever
      c.loan_free = 1;              // 0% daily interest on this loan
      c.loan = STARTER_LOAN_AMOUNT;
      c.money = Math.floor(Number(c.money)) + STARTER_LOAN_AMOUNT;
      console.log(`[act] ${conn.user.username} took STARTER loan ${naira(STARTER_LOAN_AMOUNT)} (0%)`);
      await commit({
        kind: 'starter_loan', amount: STARTER_LOAN_AMOUNT, meta: { rate: 0 },
        note: `🏦 Starter loan of ${naira(STARTER_LOAN_AMOUNT)} approved — 0% interest, hustle well! 🤝`,
      });
      return;
    }
    if (!amt || amt <= 0 || amt > BANK.loanMax) {
      err(`Loans: ₦1 – ${naira(BANK.loanMax)}.`); return;
    }
    if (Number(c.loan) > 0) { err('Repay your current loan first.'); return; }
    c.loan = amt;
    c.loan_free = 0; // normal loans always carry 10%/day interest
    c.money = Math.floor(Number(c.money)) + amt;
    console.log(`[act] ${conn.user.username} took loan ${naira(amt)}`);
    await commit({ kind: 'loan', amount: amt, meta: { rate: BANK.loanRate }, note: `🏦 Loan of ${naira(amt)} approved. 10% daily interest — repay fast!` });
    return;
  }

  // ---------- repay ----------
  if (a === 'repay') {
    const amt = Math.floor(Number(msg.amount));
    if (!amt || amt <= 0) { err('Enter a valid amount.'); return; }
    if (Number(c.loan) <= 0) { err('You have no loan.'); return; }
    const pay = Math.min(amt, Math.floor(Number(c.loan)), Math.floor(Number(c.money)));
    if (pay <= 0) { err("You don't have the cash."); return; }
    c.money = Math.floor(Number(c.money)) - pay;
    c.loan = Math.floor(Number(c.loan)) - pay;
    if (c.loan <= 0) c.loan_free = 0; // no outstanding loan → the 0% flag lapses
    console.log(`[act] ${conn.user.username} repaid ${naira(pay)}`);
    await commit({
      kind: 'repay', amount: -pay, meta: { remaining: c.loan },
      note: c.loan > 0 ? `Repaid ${naira(pay)}. ${naira(c.loan)} left.` : '🎉 Loan fully repaid!',
    });
    return;
  }

  // ---------- buy_furniture (goes to inventory, unplaced) ----------
  if (a === 'buy_furniture') {
    const item = FURN[String(msg.item)];
    if (!item) { err('Unknown furniture.'); return; }
    if (Number(c.money) < item.price) { err(`You need ${naira(item.price)} for the ${item.name}.`); return; }
    c.money = Math.floor(Number(c.money)) - item.price;
    const fid = await addFurniture(conn.user.id, item.id);
    await refreshFurniture(conn);
    console.log(`[act] ${conn.user.username} bought furniture ${item.id} (−${naira(item.price)})`);
    await commit({
      kind: 'buy_furniture', amount: -item.price, meta: { item: item.id, furniture_id: fid },
      note: `${item.icon} ${item.name} added to your inventory. Place it at home!`,
    });
    return;
  }

  // ---------- place_furniture (up to HOME_SLOTS placed items) ----------
  if (a === 'place_furniture') {
    const fid = Math.floor(Number(msg.id));
    if (!fid) { err('Unknown furniture.'); return; }
    const row = await getFurnitureById(fid);
    if (!row || Number(row.owner_id) !== Number(conn.user.id)) {
      err('That furniture is not yours.'); return;
    }
    const placed = !!msg.placed;
    if (placed && !Number(row.placed)) {
      const n = await countPlacedFurniture(conn.user.id);
      if (n >= HOME_SLOTS) {
        err(`Your home has only ${HOME_SLOTS} slots. Unplace something first.`); return;
      }
    }
    const ok = await setFurniturePlaced(fid, conn.user.id, placed);
    if (!ok) { err('Could not place that.'); return; }
    await refreshFurniture(conn);
    const def = FURN[row.item];
    console.log(`[act] ${conn.user.username} ${placed ? 'placed' : 'stored'} furniture ${row.item}`);
    await commit({ note: placed ? `${(def && def.icon) || '🪑'} ${def ? def.name : 'Furniture'} placed at home.` : 'Stored back in inventory.' });
    return;
  }

  // ---------- collect (street-find spawn; proximity-checked) ----------
  if (a === 'collect') {
    const res = await collectSpawn(ctx, Number(msg.id));
    if (!res.ok) { err(res.error); return; }
    return;
  }

  // ============================================================
  // M5 — governor elections (intents: run / vote / gov_broadcast)
  // ============================================================
  // ---------- run: enter the governor race ----------
  // Fee ₦50,000 (server-deducted), one candidacy per election (DB PK
  // backs the check), creates a campaign room the candidate owns.
  if (a === 'run') {
    const el = await currentElection();
    if (!el) { err('No election running right now.'); return; }
    const cands = await listCandidates(el.id);
    if (cands.some(x => Number(x.player_id) === conn.user.id)) {
      err('You are already running.'); return;
    }
    if (Number(c.money) < RUN_FEE) {
      err(`Campaign fee is ${naira(RUN_FEE)}. Hustle first!`); return;
    }
    c.money = Math.floor(Number(c.money)) - RUN_FEE;
    const added = await addCandidate(el.id, conn.user.id);
    if (!added) { c.money += RUN_FEE; err('You are already running.'); return; } // lost a race
    console.log(`[elections] ${conn.user.username} is running (−${naira(RUN_FEE)} fee)`);
    await commit({
      kind: 'campaign_fee', amount: -RUN_FEE, meta: { election: el.id },
      note: `🗳️ You're on the ballot! Campaign across the city.`,
    });
    broadcast({ t: 'sys', text: `🗳️ ${conn.user.username} is running for Governor!` });
    ctx.pushNews('election', `🗳️ ${conn.user.username} is running for Governor!`);
    // campaign room: "{username}'s Campaign", candidate auto-joined as owner
    try {
      const campId = await ctx.social.createCampaignRoom(conn.user.id, conn.user.username);
      await ctx.social.refreshRooms();
      const { day } = ctx.getDay();
      send(conn, {
        t: 'room_joined', roomId: campId,
        election: await playerElectionState(conn.user.id, day, ctx.getGovernorId()),
      });
      // candidacy changes the shared race — push fresh state to everyone
      await ctx.pushElectionAll();
    } catch (e) { console.error('[campaign room]', e.message); }
    return;
  }

  // ---------- vote: one vote per voter per election ----------
  // The votes PK rejects doubles even under a race — reported as err.
  if (a === 'vote') {
    const el = await currentElection();
    if (!el) { err('No election running right now.'); return; }
    const cid = Number(msg.candidate);
    const cands = await listCandidates(el.id);
    if (!cands.some(x => Number(x.player_id) === cid)) {
      err('That candidate is not running.'); return;
    }
    if (await hasVoted(el.id, conn.user.id)) {
      err('You already voted in this election.'); return;
    }
    const ok = await castVote(el.id, conn.user.id, cid);
    if (!ok) { err('You already voted in this election.'); return; }
    console.log(`[elections] ${conn.user.username} voted for ${cid}`);
    const { day } = ctx.getDay();
    send(conn, { t: 'election', ...(await playerElectionState(conn.user.id, day, ctx.getGovernorId())) });
    send(conn, { t: 'you', you: youSnapshot(conn), note: '🗳️ Vote cast! Results at the end of the race.' });
    return;
  }

  // ---------- gov_broadcast: governor only, 1/day, profanity-filtered ----------
  if (a === 'gov_broadcast') {
    if (Number(conn.user.id) !== Number(ctx.getGovernorId())) {
      err('Only the Governor can do that.'); return;
    }
    const left = cdLeft('govbc');
    if (left) {
      const hrs = Math.ceil(left / 3600);
      err(`Governor broadcast available in ~${hrs}h.`); return;
    }
    const text = cleanText(msg.text, 200);
    if (!text) { err('Empty message.'); return; }
    conn.cds.govbc = now + GOV_BROADCAST_COOLDOWN_MS;
    broadcast({ t: 'sys', text: `👑 Governor ${conn.user.username}: ${text}` });
    ctx.pushNews('governor', `👑 Governor ${conn.user.username}: ${text.slice(0, 80)}`);
    console.log(`[gov] ${conn.user.username} broadcast: ${text.slice(0, 60)}`);
    return;
  }

  err('Unknown action.');
}

// ---- Street-find collection (shared by the `collect` act and the WS `collect` message) ----
export async function collectSpawn(ctx, spawnId) {
  const { conn, send, youSnapshot } = ctx;
  const c = conn.character;
  const spawnAPI = ctx.spawnAPI;
  if (!spawnAPI) return { ok: false, error: 'Spawns are offline right now.' };
  // Peek first: proximity/expiry are validated BEFORE the spawn is consumed,
  // so a failed attempt never eats someone else's find.
  const s = spawnAPI.peek(spawnId);
  if (!s) return { ok: false, error: 'That find is gone.' };
  if (Date.now() > s.expires) { spawnAPI.take(spawnId); return { ok: false, error: 'Too late — it vanished.' }; }
  if (distUnits(conn.pos.lat, conn.pos.lng, s.x, s.y) > COLLECT_RADIUS) {
    return { ok: false, error: 'Too far away. Walk closer!' };
  }
  const taken = spawnAPI.take(spawnId); // consumes + broadcasts despawn
  if (!taken) return { ok: false, error: 'That find is gone.' };
  let note = null, kind = null, amount = 0;
  if (s.kind === 'cash') {
    c.money = Math.floor(Number(c.money)) + Math.floor(Number(s.amount));
    kind = 'spawn_cash'; amount = Math.floor(Number(s.amount));
    note = `💵 Street find! +${naira(s.amount)}`;
  } else if (s.kind === 'snack') {
    c.hunger = clamp(Number(c.hunger) + 25, 0, 100);
    note = '🍲 Found a free snack! (+25 hunger)';
  } else if (s.kind === 'energy') {
    c.energy = clamp(Number(c.energy) + 25, 0, 100);
    note = '🥤 Found a cold drink! (+25 energy)';
  }
  c.x = conn.pos.lat;
  c.y = conn.pos.lng;
  harden(c);
  if (kind && amount) await addTransaction(conn.user.id, kind, amount, c.money, { spawn: s.id });
  await saveCharacter(c);
  console.log(`[collect] ${conn.user.username} collected ${s.kind} spawn ${s.id}`);
  const out = { t: 'you', you: youSnapshot(conn) };
  if (note) out.note = note;
  send(conn, out);
  return { ok: true };
}

// ---- Day-rollover rent for one connected player ----
// Uses the pure sim.chargeRent, then writes the ledger row, saves,
// and notifies. ctx = { conn, send, broadcast, youSnapshot }.
export async function settleDayRent(ctx, conn) {
  const { send, youSnapshot } = ctx;
  const c = conn.character;
  const res = chargeRent(c, HOUSING);
  const h = HOUSING[c.housing] || HOUSING.face_me;

  if (res.outcome === 'paid') {
    if (res.rent > 0) {
      await addTransaction(conn.user.id, 'rent', -res.rent, c.money, { housing: c.housing });
    }
    await saveCharacter(c);
    if (res.rent > 0) send(conn, { t: 'sys', text: `🏠 Rent paid: ${naira(res.rent)} (${h.name})` });
  } else if (res.outcome === 'missed') {
    await saveCharacter(c);
    send(conn, { t: 'sys', text: `⚠️ Landlord is knocking! Rent missed (${res.misses}/3). Pay ${naira(res.rent)} soon.` });
  } else {
    await saveCharacter(c);
    send(conn, { t: 'sys', text: '⚠️ EVICTED! 3 missed rents — you now sleep under the bridge. Hustle hard to recover.' });
  }
  console.log(`[rent] ${conn.user.username}: ${res.outcome} (housing=${c.housing}, misses=${c.rent_misses})`);
  send(conn, { t: 'you', you: youSnapshot(conn) });
}

// ---- Day-rollover economy for one connected player ----
// Business income → note; savings +2%/day; loan +10%/day; owned-property and
// placed-generator happiness. Ledger rows for every money/balance move.
export async function settleDayEconomy(ctx, conn) {
  const { send, youSnapshot } = ctx;
  const c = conn.character;
  const placed = (conn.furniture || []).filter(r => Number(r.placed)).map(r => r.item);
  const bizDef = (c.biz && BIZ[c.biz]) || null;
  const propDef = (c.property && PROPERTIES[c.property]) || null;
  const res = applyDayEconomy(c, { bizDef, propDef, placed });

  if (res.income > 0) {
    await addTransaction(conn.user.id, 'biz_income', res.income, c.money, { biz: c.biz });
  }
  if (res.savingsInterest > 0) {
    await addTransaction(conn.user.id, 'savings_interest', res.savingsInterest, c.savings, { balance: 'savings' });
  }
  if (res.loanInterest > 0) {
    await addTransaction(conn.user.id, 'loan_interest', res.loanInterest, c.loan, { balance: 'loan' });
  }
  if (!res.dirty) return res;

  harden(c);
  await saveCharacter(c);
  send(conn, { t: 'you', you: youSnapshot(conn) });
  const bits = [];
  if (res.income > 0 && bizDef) bits.push(`${bizDef.icon} ${bizDef.name} paid you ${naira(res.income)}`);
  if (res.savingsInterest > 0) bits.push(`🏦 savings interest +${naira(res.savingsInterest)}`);
  if (res.loanInterest > 0) bits.push(`🏦 loan interest +${naira(res.loanInterest)}`);
  if (res.happyGain > 0) bits.push(`😊 +${res.happyGain} happiness`);
  if (bits.length) send(conn, { t: 'sys', text: '🌅 New day: ' + bits.join(' • ') });
  console.log(`[economy] ${conn.user.username}: income=${res.income} savInt=${res.savingsInterest} loanInt=${res.loanInterest} happy=${res.happyGain}`);
  return res;
}
