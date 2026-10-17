// ============================================================
// routes/gov.js — Èkó Gov REST API (Phase 8).
//
// REST surface for the governor election + governance systems
// (M5 elections, M11 policies/commissioners). Mirrors the WS act
// intents in game/actions.js and game/v2/m11.js — same validation,
// same fees, same side effects (campaign room, broadcasts, news,
// election-state pushes). Gameplay coins only.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById, getUserByName, ensureCharacter, saveCharacter, addTransaction,
  getMeta, setMeta,
  currentElection, listCandidates, hasVoted, getVote, addCandidate, castVote,
  lastWinner,
} from '../db.js';
import {
  RUN_FEE, POLICIES, PICKABLE_POLICIES, COMMISSIONER_TITLES,
  applyPolicy, getPolicyState, listCommissioners, appointCommissioner, dismissCommissioner,
  // PORT-P5: world — begin
  isElectionPaused, setElectionPaused,
  // PORT-P5: world — end
} from '../game/elections.js';
import { isPickablePolicy, policyWindowOpen, isKnownTitle, titleIcon, policyEffectLine } from '../game/v2/m11.js';
import { canAfford, charge } from '../game/money.js';

const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');

export function createGovRouter({ hub, getDay }) {
  const router = Router();
  router.use(authMiddleware);

  /** Full governance state for the phone app (viewer-aware). */
  async function govState(viewerId) {
    const { day } = getDay();
    // PORT-P5: world — begin
    const govElectionPaused = await isElectionPaused();
    // PORT-P5: world — end
    const el = await currentElection();
    const govId = Number(await getMeta('governor_id')) || 0;
    const govUser = govId ? await getUserById(govId) : null;
    const cands = el ? await listCandidates(el.id) : [];
    const sorted = [...cands].sort((a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0));
    const myVote = el ? await getVote(el.id, Number(viewerId)) : null;
    const isCandidate = el
      ? sorted.some((c) => Number(c.player_id) === Number(viewerId))
      : false;
    const win = await lastWinner();
    const policy = await getPolicyState(viewerId, govId);
    const commissioners = await listCommissioners();
    return {
      election: el
        ? {
            id: Number(el.id),
            // PORT-P5: world — begin (election pause state)
            status: govElectionPaused ? 'paused' : 'voting',
            paused: govElectionPaused,
            // PORT-P5: world — end
            startDay: Number(el.start_day),
            endDay: Number(el.end_day),
            daysLeft: Math.max(0, Number(el.end_day) - Number(day)),
          }
        : null,
      candidates: sorted.map((c) => ({
        playerId: Number(c.player_id),
        username: c.username,
        votes: Number(c.votes) || 0,
      })),
      myVote,
      isCandidate,
      governor: govId
        ? { id: govId, username: govUser ? govUser.username : null }
        : null,
      lastWinner:
        win && win.winner_id
          ? { username: win.winner_name, electionId: Number(win.id) }
          : null,
      policy: {
        id: policy.id,
        name: policy.name,
        icon: policy.icon,
        desc: policy.desc,
        picked: policy.picked,
        defaulted: policy.defaulted,
        pickDeadline: policy.pick_deadline,
        canPick: policy.can_pick,
        effects: policyEffectLine(policy.mults || {}),
      },
      commissioners,
      commissionerTitles: COMMISSIONER_TITLES,
      policies: PICKABLE_POLICIES.map((id) => ({
        id,
        name: POLICIES[id].name,
        icon: POLICIES[id].icon,
        desc: POLICIES[id].desc,
        effects: policyEffectLine(POLICIES[id].mults || {}),
      })),
      runFee: RUN_FEE,
      canRun: !!el && !isCandidate,
    };
  }

  async function authedUser(req, res) {
    const user = await getUserById(req.userId);
    if (!user) { res.status(401).json({ error: 'Account not found.' }); return null; }
    if (Number(user.banned)) { res.status(403).json({ error: 'This account is banned.' }); return null; }
    return user;
  }

  async function requireGovernor(req, res) {
    const user = await authedUser(req, res);
    if (!user) return null;
    const govId = Number(await getMeta('governor_id')) || 0;
    if (!govId || Number(req.userId) !== govId) {
      res.status(403).json({ error: 'Only the sitting Governor can do that.' });
      return null;
    }
    return user;
  }

  // ---- state ----
  router.get('/', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    res.json(await govState(req.userId));
  });

  // ---- run: enter the governor race (fee, one candidacy, campaign room) ----
  router.post('/run', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const el = await currentElection();
    if (!el) return res.status(400).json({ error: 'No election running right now.' });
    // PORT-P5: world — begin
    if (await isElectionPaused()) {
      return res.status(400).json({ error: 'Elections are paused by the State House.' });
    }
    // PORT-P5: world — end
    const cands = await listCandidates(el.id);
    if (cands.some((x) => Number(x.player_id) === Number(req.userId))) {
      return res.status(400).json({ error: 'You are already running.' });
    }
    const c = await ensureCharacter(req.userId);
    const isAdmin = !!Number(user.is_admin);
    if (!canAfford(c, RUN_FEE, isAdmin)) {
      return res.status(400).json({ error: `Campaign fee is ${naira(RUN_FEE)}. Hustle first!` });
    }
    const deducted = charge(c, RUN_FEE, isAdmin); // 0 for admins — stealth bypass
    await saveCharacter(c);
    const added = await addCandidate(el.id, Number(req.userId));
    if (!added) {
      // Lost a race: refund the charge that did happen.
      if (deducted > 0) {
        c.money = Math.floor(Number(c.money)) + deducted;
        await saveCharacter(c);
      }
      return res.status(400).json({ error: 'You are already running.' });
    }
    await addTransaction(Number(req.userId), 'gov', -deducted, Math.floor(Number(c.money)), {
      kind: 'campaign_fee', election: el.id,
    });
    try {
      await hub.createCampaignRoom(Number(req.userId), user.username);
    } catch (e) { console.error('[gov] campaign room:', e.message); }
    hub.broadcast({ t: 'sys', text: `🗳️ ${user.username} is running for Governor!` });
    hub.pushNews('election', `🗳️ ${user.username} is running for Governor!`);
    await hub.pushElectionAll();
    res.json({ ok: true, state: await govState(req.userId) });
  });

  // ---- vote: one vote per voter per election ----
  router.post('/vote', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const el = await currentElection();
    if (!el) return res.status(400).json({ error: 'No election running right now.' });
    // PORT-P5: world — begin
    if (await isElectionPaused()) {
      return res.status(400).json({ error: 'Elections are paused by the State House.' });
    }
    // PORT-P5: world — end
    const cid = Number(req.body && req.body.candidateId);
    if (!Number.isFinite(cid)) return res.status(400).json({ error: 'Pick a candidate.' });
    const cands = await listCandidates(el.id);
    if (!cands.some((x) => Number(x.player_id) === cid)) {
      return res.status(400).json({ error: 'That candidate is not running.' });
    }
    if (await hasVoted(el.id, Number(req.userId))) {
      return res.status(400).json({ error: 'You already voted in this election.' });
    }
    const ok = await castVote(el.id, Number(req.userId), cid);
    if (!ok) return res.status(400).json({ error: 'You already voted in this election.' });
    await hub.pushElectionAll();
    res.json({ ok: true, state: await govState(req.userId) });
  });

  // ---- policy: the sitting governor signs one policy per term ----
  router.post('/policy', async (req, res) => {
    const user = await requireGovernor(req, res);
    if (!user) return;
    const id = String((req.body && req.body.policyId) || '');
    if (!isPickablePolicy(id)) {
      return res.status(400).json({ error: 'Unknown policy. Pick one from the State House list.' });
    }
    const wonAt = Number(await getMeta('gov_policy_won_at')) || 0;
    if (!policyWindowOpen(wonAt)) {
      return res.status(400).json({ error: 'The policy window has closed — the standing policy now applies.' });
    }
    const applied = await applyPolicy(id);
    await setMeta('gov_policy_picked', '1');
    hub.broadcast({ t: 'sys', text: `🏛️ Governor ${user.username} signed the "${applied.name}" policy! ${applied.desc}` });
    hub.pushNews('governor', `🏛️ Governor ${user.username} signed "${applied.name}" — ${applied.desc}`);
    await hub.pushElectionAll();
    res.json({ ok: true, state: await govState(req.userId) });
  });

  // ---- commissioners: appoint / dismiss (governor only) ----
  router.post('/commissioners/appoint', async (req, res) => {
    const user = await requireGovernor(req, res);
    if (!user) return;
    const title = String((req.body && req.body.title) || '').trim();
    if (!isKnownTitle(title)) return res.status(400).json({ error: 'Unknown commissioner title.' });
    const username = String((req.body && req.body.username) || '').trim().replace(/^@/, '');
    if (!username) return res.status(400).json({ error: 'Name the player to appoint.' });
    const u = await getUserByName(username);
    if (!u) return res.status(404).json({ error: `No player called @${username}.` });
    await appointCommissioner(title, Number(u.id));
    const icon = titleIcon(title);
    hub.broadcast({ t: 'sys', text: `${icon} Governor ${user.username} appointed @${u.username} — ${title}!` });
    hub.pushNews('governor', `${icon} @${u.username} appointed ${title} by Governor ${user.username}.`);
    await hub.pushElectionAll();
    res.json({ ok: true, state: await govState(req.userId) });
  });

  router.post('/commissioners/dismiss', async (req, res) => {
    const user = await requireGovernor(req, res);
    if (!user) return;
    const title = String((req.body && req.body.title) || '').trim();
    if (!isKnownTitle(title)) return res.status(400).json({ error: 'Unknown commissioner title.' });
    const seat = (await listCommissioners()).find((c) => c.title === title);
    if (!seat) return res.status(400).json({ error: 'That seat is already empty.' });
    await dismissCommissioner(title);
    hub.broadcast({ t: 'sys', text: `🎖️ Governor ${user.username} dismissed the ${title}.` });
    hub.pushNews('governor', `🎖️ Governor ${user.username} dismissed the ${title}.`);
    await hub.pushElectionAll();
    res.json({ ok: true, state: await govState(req.userId) });
  });

  // PORT-P5: world — begin
  // Election pause / resume (admin only). While paused, tallies don't
  // run and run/vote are rejected; the sitting governor keeps the seat.
  async function requireAdmin(req, res) {
    const user = await authedUser(req, res);
    if (!user) return null;
    if (!Number(user.is_admin)) {
      res.status(403).json({ error: 'Admins only.' });
      return null;
    }
    return user;
  }

  router.post('/election/pause', async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;
    await setElectionPaused(true);
    hub.broadcast({ t: 'sys', text: '🏛️ The State House has paused elections. The sitting Governor stays in office.' });
    hub.pushNews('election', '🏛️ Elections paused by the State House.');
    await hub.pushElectionAll();
    res.json({ ok: true, state: await govState(req.userId) });
  });

  router.post('/election/resume', async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;
    await setElectionPaused(false);
    hub.broadcast({ t: 'sys', text: '🗳️ Elections are back on! The race resumes.' });
    hub.pushNews('election', '🗳️ Elections resumed.');
    await hub.pushElectionAll();
    res.json({ ok: true, state: await govState(req.userId) });
  });
  // PORT-P5: world — end

  return router;
}
