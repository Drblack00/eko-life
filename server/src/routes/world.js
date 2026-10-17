// ============================================================
// routes/world.js — P5 "World Systems" REST API.
//
// Ride, Health, Police, Court, Assurance, Bus Co., In-game Ads,
// Charity, IPO-style promos, Event tickets, Trade School courses.
// All at /api/world. Gameplay coins only — no real money, no
// betting, no casino. Every spend is server-validated with the
// admin stealth-money semantics from game/money.js.
//
// All copy is original to Èkó Life.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById, getUserByName, getCharacter, ensureCharacter, saveCharacter, addTransaction,
} from '../db.js';
import { canAfford, charge } from '../game/money.js';
import { LOCATIONS } from '../game/data.js';
import {
  RIDE_MODES, RUSH_MULT, isRushHour, rideFare, rideTravelSecs, rollGoSlow,
  CHEMIST_FEE, HOSPITAL_FEE, ILLNESSES, treatIllness, rollRideIllness,
  ROBBERY_CAP, OFFENCE_TYPES,
  getIllness, setIllness, clearIllness, playerIllnessDecayMult,
  isJailed,
  listOffences, recordOffence,
  openCase, listCases, resolveCase, applyCaseOutcome, COURT_HEARING_DELAY_DAYS,
  ASSURANCE_PREMIUM, ASSURANCE_DEDUCTIBLE, ASSURANCE_MAX_PAYOUT, ASSURANCE_FIX_COST,
  ASSURANCE_RISKS, assurancePayout,
  getAssurance, buyAssurance, fixCondition, listLosses,
  BUSCO_START_COST, BUSCO_WEEKLY_YIELD, buscoPaybackWeeks, getBusco, startBusco,
  AD_BILLBOARD_COST, AD_MAP_PLOT_COST, AD_DURATION_DAYS,
  listMyAds, listActiveAds, buyAd,
  CHARITY_SEED, CHARITY_MAX_SINGLE_DONATION, CHARITY_PROJECTS, charityStats, giveToCharity,
  listPromos, getPromo, investPromo, claimPromo,
  listTicketEvents, getTicketEvent, buyTicket, createTicketEvent, listMyTickets,
  ticketOrganizerNet,
  ensureWorldSchema, naira,
} from '../game/world.js';
import {
  COURSES, LESSONS_PER_DAY,
  listCoursesWithProgress, courseDetail, takeLesson, submitQuiz,
  listCertificates, getCourseBoosts,
} from '../game/courses.js';

const err = (res, status, error) => res.status(status).json({ error });

export function createWorldRouter({ hub, getDay }) {
  const router = Router();
  router.use(authMiddleware);

  const dayOf = () => Number(getDay().day) || 1;

  async function authedUser(req, res) {
    const user = await getUserById(req.userId);
    if (!user) { err(res, 401, 'Account not found.'); return null; }
    if (Number(user.banned)) { err(res, 403, 'This account is banned.'); return null; }
    return user;
  }

  /** Spend gameplay coins (admin stealth-money aware). Throws {status,message}. */
  async function spend(user, c, amount, meta) {
    const isAdmin = !!Number(user.is_admin);
    if (!canAfford(c, amount, isAdmin)) {
      throw Object.assign(new Error(`Need ${naira(amount)}. Hustle first!`), { status: 400 });
    }
    const deducted = charge(c, amount, isAdmin);
    await saveCharacter(c);
    await addTransaction(Number(user.id), meta.kind || 'world', -deducted, Math.floor(Number(c.money)), meta);
    return Math.floor(Number(c.money));
  }

  async function credit(userId, amount, kind, meta) {
    const c = await getCharacter(Number(userId));
    if (!c) return null;
    c.money = Math.max(0, Math.floor(Number(c.money)) + Math.floor(Number(amount)));
    await saveCharacter(c);
    await addTransaction(Number(userId), kind, Math.floor(Number(amount)), Math.floor(Number(c.money)), meta || {});
    return Math.floor(Number(c.money));
  }

  async function requireFree(req, res) {
    const jail = await isJailed(req.userId);
    if (jail) {
      err(res, 403, 'You are in a cell. Wait out your sentence first.');
      return false;
    }
    return true;
  }

  function destsFor(city) {
    const list = LOCATIONS.filter(l => !l.cities || l.cities.includes(city));
    return (list.length ? list : LOCATIONS).map(l => ({ id: l.id, name: l.name, icon: l.icon }));
  }

  // ================= RIDE =================

  /** Fare table, rush status, and destinations for the player's city. */
  router.get('/ride', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    await ensureWorldSchema();
    const c = await ensureCharacter(req.userId);
    const now = new Date();
    const rush = isRushHour(now);
    res.json({
      rush,
      rushNote: rush ? `Rush hour — fares ×${RUSH_MULT}.` : 'Off-peak fares.',
      modes: Object.values(RIDE_MODES).map(m => ({
        id: m.id, name: m.name, icon: m.icon, blurb: m.blurb,
        fare: rideFare(m.id, '', now), minSec: m.minSec, maxSec: m.maxSec,
      })),
      dests: destsFor(c.current_city || 'lagos'),
      locationId: c.location_id,
    });
  });

  /** Take a trip. Charges the fare, moves the player, may trigger go-slow / illness. */
  router.post('/ride/travel', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    if (!(await requireFree(req, res))) return;
    const mode = String((req.body && req.body.mode) || '');
    const destId = String((req.body && req.body.destId) || '');
    if (!RIDE_MODES[mode]) return err(res, 400, 'Pick a ride: trek, keke, danfo, okada or cab.');
    const c = await ensureCharacter(req.userId);
    const valid = destsFor(c.current_city || 'lagos').some(d => d.id === destId)
      || LOCATIONS.some(l => l.id === destId);
    if (!destId || !valid) return err(res, 400, 'Pick a destination on the map.');
    const now = new Date();
    const fare = rideFare(mode, destId, now);
    try {
      await spend(user, c, fare, { kind: 'ride', mode, dest: destId, fare });
    } catch (e) { return err(res, e.status || 400, e.message); }
    const secs = rideTravelSecs(mode);
    const goSlow = rollGoSlow(mode);
    const totalSecs = secs + (goSlow ? goSlow.extraSec : 0);
    c.location_id = destId;
    await saveCharacter(c);
    await addTransaction(Number(user.id), 'ride', 0, Math.floor(Number(c.money)), {
      mode, dest: destId, secs: totalSecs, goSlow: !!goSlow,
    });
    // Crowded rides can make you sick.
    let caught = null;
    const illId = rollRideIllness(mode);
    if (illId && !(await getIllness(req.userId))) {
      await setIllness(req.userId, illId, ILLNESSES[illId].hours);
      caught = { id: illId, name: ILLNESSES[illId].name, icon: ILLNESSES[illId].icon };
    }
    res.json({
      ok: true, mode, destId, fare,
      travelSecs: totalSecs, goSlow,
      caught, balance: Math.floor(Number(c.money)),
    });
  });

  // ================= HEALTH =================

  router.get('/health', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const ill = await getIllness(req.userId);
    const decayMult = await playerIllnessDecayMult(req.userId);
    res.json({
      illness: ill ? {
        id: ill.illness,
        name: ILLNESSES[ill.illness] ? ILLNESSES[ill.illness].name : ill.illness,
        icon: ILLNESSES[ill.illness] ? ILLNESSES[ill.illness].icon : '🤒',
        desc: ILLNESSES[ill.illness] ? ILLNESSES[ill.illness].desc : '',
        until: ill.until, msLeft: Math.max(0, ill.until - Date.now()),
      } : null,
      decayMult,
      chemistFee: CHEMIST_FEE,
      hospitalFee: HOSPITAL_FEE,
      providers: [
        { id: 'chemist', name: 'Chemist', icon: '💊', fee: CHEMIST_FEE, note: 'Quick counter drugs. Cures mild cases; Eko Fever sometimes needs a second visit.' },
        { id: 'hospital', name: 'General Hospital', icon: '🏥', fee: HOSPITAL_FEE, note: 'Full treatment. Cures anything, guaranteed.' },
      ],
    });
  });

  router.post('/health/treat', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const provider = String((req.body && req.body.provider) || '');
    if (provider !== 'chemist' && provider !== 'hospital') {
      return err(res, 400, 'Pick chemist or hospital.');
    }
    const ill = await getIllness(req.userId);
    if (!ill) return err(res, 400, 'You feel fine. No treatment needed.');
    const c = await ensureCharacter(req.userId);
    const { cured, cost } = treatIllness(ill.illness, provider);
    try {
      await spend(user, c, cost, { kind: 'health_treat', provider, illness: ill.illness });
    } catch (e) { return err(res, e.status || 400, e.message); }
    if (cured) await clearIllness(req.userId);
    res.json({
      ok: true, cured, cost,
      note: cured
        ? 'Treatment worked. You feel yourself again.'
        : 'The drugs barely touched it — try the hospital for a sure cure.',
      balance: Math.floor(Number(c.money)),
    });
  });

  // ================= POLICE =================

  router.get('/police', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const record = await listOffences(req.userId);
    const jail = await isJailed(req.userId);
    res.json({
      record,
      clean: record.length === 0,
      robberyCap: ROBBERY_CAP,
      robberyNote: `No single theft in Èkó Life can take more than ${naira(ROBBERY_CAP)}.`,
      jailed: jail ? { until: jail.until, msLeft: Math.max(0, jail.until - Date.now()) } : null,
      offenceTypes: OFFENCE_TYPES,
    });
  });

  /**
   * Report a crime: records the offence on the accused player's
   * game record and opens a court case (hearing in 2 days).
   */
  router.post('/police/report', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const against = String((req.body && req.body.against) || '').trim().replace(/^@/, '');
    const offenceId = String((req.body && req.body.offence) || '');
    const description = String((req.body && req.body.description) || '').slice(0, 280);
    if (!against) return err(res, 400, 'Name the player you are reporting.');
    if (!OFFENCE_TYPES.some(o => o.id === offenceId)) return err(res, 400, 'Pick an offence type.');
    if (against.toLowerCase() === String(user.username).toLowerCase()) {
      return err(res, 400, 'You cannot report yourself.');
    }
    const accused = await getUserByName(against);
    if (!accused) return err(res, 404, `No player called @${against}.`);
    const rec = await recordOffence(accused.id, offenceId, `Reported by @${user.username}: ${description}`);
    await openCase(accused.id, offenceId, rec.id, dayOf());
    res.json({
      ok: true,
      note: `@${accused.username} has been booked. The court hears the case in ${COURT_HEARING_DELAY_DAYS} days.`,
    });
  });

  // ================= COURT =================

  /**
   * The court hears ONLY game-recorded events (world_cases rows).
   * Due hearings resolve lazily here and on the day tick.
   */
  router.get('/court', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const day = dayOf();
    let cases = await listCases(req.userId);
    const settled = [];
    for (const cs of cases) {
      if (cs.status === 'pending' && cs.hearingDay <= day) {
        const row = { id: cs.id, offence: cs.offence, severity: cs.severity };
        const outcome = await resolveCase(row);
        const applied = await applyCaseOutcome(req.userId, outcome);
        settled.push({ id: cs.id, outcome: applied });
      }
    }
    if (settled.length) cases = await listCases(req.userId);
    res.json({
      cases,
      settled,
      note: 'The court only hears what the game itself recorded — no hearsay, no screenshots.',
    });
  });

  // ================= ASSURANCE =================

  router.get('/assurance', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const policy = await getAssurance(req.userId);
    const losses = await listLosses(req.userId);
    res.json({
      policy: policy ? {
        active: policy.active, condition: policy.condition,
        paidUntilWeek: policy.paidUntilWeek, startedAt: policy.startedAt,
      } : null,
      losses,
      premium: ASSURANCE_PREMIUM,
      deductible: ASSURANCE_DEDUCTIBLE,
      maxPayout: ASSURANCE_MAX_PAYOUT,
      fixCost: ASSURANCE_FIX_COST,
      risks: Object.entries(ASSURANCE_RISKS).map(([id, r]) => ({
        id, name: r.name, icon: r.icon,
        weeklyChance: `${(r.prob * 100).toFixed(1)}%`,
      })),
    });
  });

  router.post('/assurance/buy', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const existing = await getAssurance(req.userId);
    if (existing && existing.active) return err(res, 400, 'Your policy is already active.');
    const c = await ensureCharacter(req.userId);
    try {
      await spend(user, c, ASSURANCE_PREMIUM, { kind: 'assurance_premium', weeks: 1 });
    } catch (e) { return err(res, e.status || 400, e.message); }
    await buyAssurance(req.userId, Math.floor(dayOf() / 7));
    res.json({ ok: true, note: 'Assurance Plus active — you are covered from today.', balance: Math.floor(Number(c.money)) });
  });

  router.post('/assurance/fix', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const policy = await getAssurance(req.userId);
    if (!policy) return err(res, 400, 'Buy an assurance policy first.');
    if (policy.condition >= 100) return err(res, 400, 'Your place is already in perfect shape.');
    const c = await ensureCharacter(req.userId);
    try {
      await spend(user, c, ASSURANCE_FIX_COST, { kind: 'assurance_fix' });
    } catch (e) { return err(res, e.status || 400, e.message); }
    await fixCondition(req.userId);
    res.json({ ok: true, note: 'Repairs done — condition back to 100%.', balance: Math.floor(Number(c.money)) });
  });

  /** File a claim on a loss event. Payout = min(max, loss) − deductible. */
  router.post('/assurance/claim', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const lossId = Number(req.body && req.body.lossId);
    if (!Number.isFinite(lossId)) return err(res, 400, 'Pick a loss to claim.');
    const policy = await getAssurance(req.userId);
    if (!policy || !policy.active) return err(res, 400, 'No active policy — claims need cover.');
    const losses = await listLosses(req.userId);
    const loss = losses.find(l => l.id === lossId);
    if (!loss) return err(res, 404, 'That loss is gone or expired.');
    if (loss.claimed) return err(res, 400, 'Already claimed.');
    const payout = assurancePayout(loss.loss);
    const { dbRun: run } = await import('../db.js');
    await run(
      'UPDATE world_losses SET claimed = 1 WHERE id = ? AND user_id = ?',
      'UPDATE world_losses SET claimed = 1 WHERE id = $1 AND user_id = $2',
      [lossId, Number(req.userId)]);
    const balance = await credit(req.userId, payout, 'assurance_claim', {
      risk: loss.risk, loss: loss.loss, deductible: ASSURANCE_DEDUCTIBLE,
    });
    res.json({
      ok: true, payout, deductible: ASSURANCE_DEDUCTIBLE,
      note: `Claim settled: ${naira(payout)} paid out.`,
      balance,
    });
  });

  // ================= BUS COMPANY =================

  router.get('/busco', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const co = await getBusco(req.userId);
    res.json({
      company: co ? {
        buses: co.buses, startedAt: co.startedAt,
        weeklyYield: BUSCO_WEEKLY_YIELD * co.buses,
        paybackWeeks: buscoPaybackWeeks(),
      } : null,
      startCost: BUSCO_START_COST,
      weeklyYield: BUSCO_WEEKLY_YIELD,
      paybackWeeks: buscoPaybackWeeks(),
      blurb: 'One bus, one route, weekly returns. The park life pays.',
    });
  });

  router.post('/busco/start', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const c = await ensureCharacter(req.userId);
    try {
      await spend(user, c, BUSCO_START_COST, { kind: 'busco_start' });
    } catch (e) { return err(res, e.status || 400, e.message); }
    await startBusco(req.userId, Math.floor(dayOf() / 7));
    const co = await getBusco(req.userId);
    res.json({
      ok: true, buses: co.buses,
      note: `Bus ${co.buses} hits the road! ${naira(BUSCO_WEEKLY_YIELD)} lands every week — payback in ~${buscoPaybackWeeks()} weeks.`,
      balance: Math.floor(Number(c.money)),
    });
  });

  // ================= IN-GAME ADS =================

  router.get('/ads', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    res.json({
      mine: await listMyAds(req.userId),
      prices: [
        { kind: 'billboard', name: 'Billboard', icon: '🪧', cost: AD_BILLBOARD_COST, note: 'Big roadside board, seen all over the city.' },
        { kind: 'mapplot', name: 'Map plot', icon: '📍', cost: AD_MAP_PLOT_COST, note: 'A small pinned ad on the city map.' },
      ],
      durationDays: AD_DURATION_DAYS,
    });
  });

  /** Live ads — the map view renders these as billboards / map pins. */
  router.get('/ads/feed', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    res.json({ ads: await listActiveAds(100) });
  });

  router.post('/ads/buy', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const kind = String((req.body && req.body.kind) || '');
    const title = String((req.body && req.body.title) || '').trim();
    const blurb = String((req.body && req.body.blurb) || '').trim();
    const cost = kind === 'billboard' ? AD_BILLBOARD_COST : kind === 'mapplot' ? AD_MAP_PLOT_COST : 0;
    if (!cost) return err(res, 400, 'Pick billboard or map plot.');
    if (!title) return err(res, 400, 'Give your ad a headline.');
    if (title.length > 40 || blurb.length > 90) return err(res, 400, 'Headline ≤ 40 chars, blurb ≤ 90 chars.');
    const c = await ensureCharacter(req.userId);
    try {
      await spend(user, c, cost, { kind: 'ad_buy', adKind: kind, title });
    } catch (e) { return err(res, e.status || 400, e.message); }
    await buyAd(req.userId, kind, title, blurb);
    res.json({
      ok: true,
      note: `Your ${kind === 'billboard' ? 'billboard' : 'map pin'} is live for ${AD_DURATION_DAYS} days.`,
      balance: Math.floor(Number(c.money)),
    });
  });

  // ================= CHARITY =================

  router.get('/charity', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const stats = await charityStats();
    res.json({
      fund: stats.fund, donors: stats.donors, seed: CHARITY_SEED,
      projects: CHARITY_PROJECTS,
      maxSingleDonation: CHARITY_MAX_SINGLE_DONATION,
      note: 'Every naira goes straight into the fund. The fund starts seeded and grows only from real donations — no funny numbers.',
    });
  });

  router.post('/charity/give', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const amount = Math.floor(Number(req.body && req.body.amount) || 0);
    const project = String((req.body && req.body.project) || '');
    if (!(amount >= 100)) return err(res, 400, 'Minimum donation is ₦100.');
    if (amount > CHARITY_MAX_SINGLE_DONATION) {
      return err(res, 400, `One donation caps at ${naira(CHARITY_MAX_SINGLE_DONATION)}.`);
    }
    if (project && !CHARITY_PROJECTS.some(p => p.id === project)) {
      return err(res, 400, 'Unknown project.');
    }
    const c = await ensureCharacter(req.userId);
    try {
      await spend(user, c, amount, { kind: 'charity_give', project });
    } catch (e) { return err(res, e.status || 400, e.message); }
    await giveToCharity(req.userId, amount, project);
    const stats = await charityStats();
    res.json({
      ok: true, note: `You gave ${naira(amount)}. Èkó thanks you. 🙏`,
      fund: stats.fund, donors: stats.donors,
      balance: Math.floor(Number(c.money)),
    });
  });

  // ================= IPO-STYLE PROMOS =================

  router.get('/promos', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    res.json({ promos: await listPromos(req.userId) });
  });

  router.post('/promos/invest', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    if (!(await requireFree(req, res))) return;
    const promoId = Number(req.body && req.body.promoId);
    const amount = Math.floor(Number(req.body && req.body.amount) || 0);
    const promo = await getPromo(promoId);
    if (!promo) return err(res, 404, 'Unknown promo.');
    if (Number(promo.closes_at) <= Date.now() || promo.status !== 'open') {
      return err(res, 400, 'This round has closed.');
    }
    if (!(amount >= Number(promo.min_invest))) return err(res, 400, `Minimum is ${naira(promo.min_invest)}.`);
    if (amount > Number(promo.max_invest)) return err(res, 400, `Maximum is ${naira(promo.max_invest)} per round.`);
    const c = await ensureCharacter(req.userId);
    try {
      await spend(user, c, amount, { kind: 'promo_invest', promo: promoId });
    } catch (e) { return err(res, e.status || 400, e.message); }
    await investPromo(req.userId, promoId, amount);
    const payoutAt = Math.floor(amount * Number(promo.payout_mult));
    res.json({
      ok: true,
      note: `Locked in ${naira(amount)}. Pays ${naira(payoutAt)} when the round closes.`,
      balance: Math.floor(Number(c.money)),
    });
  });

  router.post('/promos/claim', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const promoId = Number(req.body && req.body.promoId);
    const promo = await getPromo(promoId);
    if (!promo) return err(res, 404, 'Unknown promo.');
    if (Number(promo.closes_at) > Date.now() && promo.status === 'open') {
      return err(res, 400, 'The round is still open — come back after it closes.');
    }
    const { claimed, payout } = await claimPromo(req.userId, promoId);
    if (!claimed) return err(res, 400, 'Nothing to claim.');
    const balance = await credit(req.userId, payout, 'promo_payout', { promo: promoId, invested: claimed });
    res.json({ ok: true, invested: claimed, payout, balance, note: `Round closed: ${naira(payout)} paid out. 💰` });
  });

  // ================= EVENT TICKETS =================

  router.get('/tickets/events', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    res.json({ events: await listTicketEvents(req.userId), feeNote: 'Organizers keep the ticket price minus 5% + ₦100 per paid ticket.' });
  });

  router.get('/tickets/mine', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    res.json({ tickets: await listMyTickets(req.userId) });
  });

  router.post('/tickets/buy', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    if (!(await requireFree(req, res))) return;
    const eventId = Number(req.body && req.body.eventId);
    const ev = await getTicketEvent(eventId);
    if (!ev) return err(res, 404, 'Unknown event.');
    if (Number(ev.starts_at) <= Date.now()) return err(res, 400, 'This event already started.');
    const events = await listTicketEvents(req.userId);
    const withCount = events.find(e => e.id === eventId);
    if (!withCount) return err(res, 400, 'This event is no longer listed.');
    if (withCount.hasTicket) return err(res, 400, 'You already hold a ticket.');
    if (withCount.sold >= withCount.capacity) return err(res, 400, 'Sold out.');
    const price = Number(ev.price) || 0;
    const c = await ensureCharacter(req.userId);
    if (price > 0) {
      try {
        await spend(user, c, price, { kind: 'ticket_buy', event: eventId });
      } catch (e) { return err(res, e.status || 400, e.message); }
    }
    await buyTicket(req.userId, eventId, price);
    // Organizer's cut: price − (5% + ₦100), credited to their game wallet.
    if (price > 0 && Number(ev.organizer_id) > 0) {
      await credit(Number(ev.organizer_id), ticketOrganizerNet(price), 'ticket_sale', { event: eventId, buyer: user.id });
    }
    res.json({
      ok: true, note: price > 0 ? `Ticket secured — see you at ${ev.venue}! 🎟️` : 'Free ticket secured! 🎟️',
      balance: Math.floor(Number(c.money)),
    });
  });

  router.post('/tickets/create', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const title = String((req.body && req.body.title) || '').trim();
    const venue = String((req.body && req.body.venue) || '').trim();
    const price = Math.floor(Number(req.body && req.body.price) || 0);
    const capacity = Math.floor(Number(req.body && req.body.capacity) || 200);
    const startsAt = Number(req.body && req.body.startsAt) || 0;
    if (!title) return err(res, 400, 'Name your event.');
    if (price < 0 || price > 100000) return err(res, 400, 'Ticket price must be ₦0–₦100,000.');
    if (startsAt <= Date.now() + 3600 * 1000) return err(res, 400, 'Events need at least 1 hour of lead time.');
    const id = await createTicketEvent(req.userId, { title, venue, price, capacity, startsAt });
    res.json({
      ok: true, id,
      note: price > 0
        ? `Event listed. You keep ${naira(ticketOrganizerNet(price))} per ticket sold (5% + ₦100 fee).`
        : 'Free event listed.',
    });
  });

  // ================= TRADE SCHOOL =================

  router.get('/courses', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    res.json({
      courses: await listCoursesWithProgress(req.userId),
      lessonsPerDay: LESSONS_PER_DAY,
      schoolName: 'Èkó Trade School',
    });
  });

  router.get('/courses/certs', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    res.json({ certs: await listCertificates(req.userId) });
  });

  router.get('/courses/boosts', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    res.json(await getCourseBoosts(req.userId));
  });

  router.get('/courses/:id', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const detail = await courseDetail(req.userId, req.params.id);
    if (!detail) return err(res, 404, 'Unknown course.');
    res.json(detail);
  });

  router.post('/courses/:id/lesson', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    if (!(await requireFree(req, res))) return;
    const c = await ensureCharacter(req.userId);
    try {
      const out = await takeLesson(req.userId, req.params.id, {
        chargeFee: (amount, meta) => spend(user, c, amount, { kind: 'course_lesson', ...meta }),
      });
      res.json({ ok: true, ...out, balance: Math.floor(Number(c.money)) });
    } catch (e) { return err(res, e.status || 400, e.message); }
  });

  router.post('/courses/:id/quiz', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    try {
      const out = await submitQuiz(req.userId, req.params.id, req.body && req.body.answers);
      const course = COURSES.find(x => x.id === req.params.id);
      res.json({
        ok: true, ...out,
        cert: out.certAwarded && course ? { name: course.name, icon: course.icon, boostLabel: course.boostLabel } : null,
      });
    } catch (e) { return err(res, e.status || 400, e.message); }
  });

  return router;
}
