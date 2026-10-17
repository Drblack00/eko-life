// ============================================================
// routes/hustle.js — Hustle gig board + Find-a-pro REST API.
//
// Escrow: the client's fee is HELD the moment they hire someone
// and released to the pro only when the client marks the job done.
// Nothing is paid until someone is hired. Game coins only —
// nothing here touches real money.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById, getUserByName, ensureCharacter, saveCharacter, addTransaction,
  dbGet, dbAll, dbRun, dbRunReturning,
} from '../db.js';
import { canAfford, charge } from '../game/money.js';
import {
  CATEGORIES, CATEGORY_MAP, categoryByKey, MIN_FEE,
  START_OPTIONS, START_MAP,
  ESCROW_COPY, NO_PAY_COPY, SAFETY_COPY, DECORATOR_COPY,
  applyRating, SCHEMA_SQLITE, SCHEMA_PG, schemaStatements,
} from '../game/hustle.js';

/** Rewrite `?` placeholders to `$1..$n` for the Postgres variant. */
function pg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  const mode = process.env.DATABASE_URL ? 'pg' : 'sqlite';
  const stmts = schemaStatements(mode === 'pg' ? SCHEMA_PG : SCHEMA_SQLITE);
  for (const s of stmts) await dbRun(s, s);
  schemaReady = true;
}

/** Insert + return the new row id on both dialects. */
async function insertId(sqliteSql, pgSql, params) {
  const r = await dbRunReturning(sqliteSql, `${pgSql} RETURNING id`, params);
  if (r.rows && r.rows.length) return Number(r.rows[0].id);
  const row = await dbGet('SELECT last_insert_rowid() AS id', 'SELECT 1', []);
  return Number(row.id);
}

const USER_RE = /^[a-zA-Z0-9_]{3,16}$/;

function parseJsonArray(v, maxItems = 8, maxLen = 60) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string')
    .map((x) => x.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems);
}

function parseCategories(v) {
  const arr = parseJsonArray(v, 8, 24).map((x) => x.toLowerCase());
  const valid = arr.filter((k) => categoryByKey(k));
  return [...new Set(valid)];
}

function gigJson(g) {
  const cat = categoryByKey(g.category);
  return {
    id: g.id,
    category: cat ? { key: cat.key, name: cat.name, icon: cat.icon } : { key: g.category, name: g.category, icon: '🧰' },
    title: g.title,
    details: g.details,
    fee: g.fee,
    materialsBudget: g.materials_budget,
    startOption: START_MAP[g.start_option] ? START_MAP[g.start_option].name : g.start_option,
    startKey: g.start_option,
    status: g.status,
    escrowed: g.status === 'hired',
    clientUsername: g.client_username,
    proUsername: g.pro_username,
    rating: g.rating,
    createdAt: g.created_at,
    hiredAt: g.hired_at,
    doneAt: g.done_at,
  };
}

function proJson(p) {
  const cats = parseJsonArraySafe(p.categories_json).map((k) => categoryByKey(k)).filter(Boolean);
  return {
    userId: p.user_id,
    username: p.username,
    categories: cats.map((c) => ({ key: c.key, name: c.name, icon: c.icon })),
    rateFrom: p.rate_from,
    tagline: p.tagline,
    services: parseJsonArraySafe(p.services_json),
    stars: Number(p.stars) || 0,
    jobsDone: p.jobs_done,
    ratingsCount: p.ratings_count,
  };
}

function parseJsonArraySafe(json) {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
}

async function getGig(id) {
  return dbGet(
    `SELECT id, client_user_id AS clientUserId, client_username AS clientUsername,
            pro_user_id AS proUserId, pro_username AS proUsername, category, title, details,
            fee, materials_budget, start_option, status, escrow_amount, rating, reported,
            created_at AS createdAt, hired_at AS hiredAt, done_at AS doneAt
     FROM hustle_gigs WHERE id=?`,
    pg(`SELECT id, client_user_id AS "clientUserId", client_username AS "clientUsername",
               pro_user_id AS "proUserId", pro_username AS "proUsername", category, title, details,
               fee, materials_budget, start_option, status, escrow_amount, rating, reported,
               created_at AS "createdAt", hired_at AS "hiredAt", done_at AS "doneAt"
        FROM hustle_gigs WHERE id=$1`),
    [Number(id)],
  );
}

function mapGig(g) {
  return {
    id: g.id,
    client_user_id: g.clientUserId ?? g.client_user_id,
    client_username: g.clientUsername ?? g.client_username,
    pro_user_id: g.proUserId ?? g.pro_user_id,
    pro_username: g.proUsername ?? g.pro_username,
    category: g.category,
    title: g.title,
    details: g.details,
    fee: g.fee,
    materials_budget: g.materials_budget,
    start_option: g.start_option,
    status: g.status,
    escrow_amount: g.escrow_amount,
    rating: g.rating,
    reported: g.reported,
    created_at: g.createdAt ?? g.created_at,
    hired_at: g.hiredAt ?? g.hired_at,
    done_at: g.doneAt ?? g.done_at,
  };
}

export function createHustleRouter() {
  const router = Router();
  router.use(authMiddleware);
  router.use(async (_req, _res, next) => {
    try { await ensureSchema(); next(); } catch (e) { next(e); }
  });

  // ---- meta --------------------------------------------------------
  router.get('/', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const pro = await dbGet('SELECT stars, jobs_done AS jobsDone FROM hustle_pros WHERE user_id=?',
        pg('SELECT stars, jobs_done AS "jobsDone" FROM hustle_pros WHERE user_id=$1'), [user.id]);
      const open = await dbGet(
        "SELECT COUNT(*) AS n FROM hustle_gigs WHERE client_user_id=? AND status='open'",
        pg("SELECT COUNT(*) AS n FROM hustle_gigs WHERE client_user_id=$1 AND status='open'"), [user.id]);
      const working = await dbGet(
        "SELECT COUNT(*) AS n FROM hustle_gigs WHERE pro_user_id=? AND status='hired'",
        pg("SELECT COUNT(*) AS n FROM hustle_gigs WHERE pro_user_id=$1 AND status='hired'"), [user.id]);
      res.json({
        categories: CATEGORIES,
        startOptions: START_OPTIONS,
        minFee: MIN_FEE,
        copy: { escrow: ESCROW_COPY, noPay: NO_PAY_COPY, safety: SAFETY_COPY, decorator: DECORATOR_COPY },
        me: {
          isPro: !!pro,
          stars: pro ? Number(pro.stars) || 0 : 0,
          jobsDone: pro ? Number(pro.jobsDone ?? pro.jobs_done) || 0 : 0,
          openGigs: Number(open.n) || 0,
          workingGigs: Number(working.n) || 0,
        },
      });
    } catch (e) { console.error('[hustle] meta:', e.message); res.status(500).json({ error: 'Could not load Hustle.' }); }
  });

  // ---- gig board ----------------------------------------------------
  router.get('/gigs', async (req, res) => {
    try {
      const cat = req.query.category ? String(req.query.category) : null;
      if (cat && !categoryByKey(cat)) return res.status(400).json({ error: 'Unknown category.' });
      const q = String(req.query.q || '').trim().slice(0, 40);
      // Build the WHERE clause for both dialects with a running $n counter.
      const clauses = ["status='open'", 'reported=0'];
      const params = [];
      if (cat) { clauses.push('category=?'); params.push(cat); }
      if (q) { clauses.push('(title LIKE ? OR details LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
      let n = 0;
      const clausesPg = clauses.map((c) => c.replace(/\?/g, () => `$${++n}`));
      const sel = `id, client_user_id AS clientUserId, client_username AS clientUsername,
        pro_user_id AS proUserId, pro_username AS proUsername, category, title, details,
        fee, materials_budget, start_option, status, escrow_amount, rating, reported,
        created_at AS createdAt, hired_at AS hiredAt, done_at AS doneAt`;
      const selPg = sel.replace(/AS (\w+)/g, (_m, a) => `AS "${a}"`);
      const rows = await dbAll(
        `SELECT ${sel} FROM hustle_gigs WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 60`,
        `SELECT ${selPg} FROM hustle_gigs WHERE ${clausesPg.join(' AND ')} ORDER BY created_at DESC LIMIT 60`,
        params,
      );
      res.json({ gigs: rows.map((r) => gigJson(mapGig(r))) });
    } catch (e) { console.error('[hustle] gigs:', e.message); res.status(500).json({ error: 'Could not load the gig board.' }); }
  });

  // ---- post a job -----------------------------------------------------
  router.post('/gigs', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const body = req.body || {};
      const cat = categoryByKey(body.category);
      if (!cat) return res.status(400).json({ error: 'Pick a category.' });
      const title = String(body.title || '').trim().slice(0, 80);
      if (title.length < 4) return res.status(400).json({ error: 'Give the job a short title.' });
      const details = String(body.details || '').trim().slice(0, 500);
      const fee = Math.floor(Number(body.fee));
      if (!Number.isFinite(fee) || fee < MIN_FEE) {
        return res.status(400).json({ error: `Fee must be at least ₦${MIN_FEE.toLocaleString('en-NG')}.` });
      }
      const materials = Math.max(0, Math.floor(Number(body.materialsBudget) || 0));
      const startKey = START_MAP[String(body.startOption)] ? String(body.startOption) : 'now';
      const now = Date.now();
      const id = await insertId(
        `INSERT INTO hustle_gigs (client_user_id, client_username, category, title, details,
            fee, materials_budget, start_option, status, created_at)
         VALUES (?,?,?,?,?,?,?,?, 'open', ?)`,
        pg(`INSERT INTO hustle_gigs (client_user_id, client_username, category, title, details,
            fee, materials_budget, start_option, status, created_at)
         VALUES (?,?,?,?,?,?,?,?, 'open', ?)`),
        [user.id, user.username, cat.key, title, details, fee, materials, startKey, now],
      );
      res.status(201).json({ gig: gigJson(mapGig(await getGig(id))), copy: { noPay: NO_PAY_COPY } });
    } catch (e) { console.error('[hustle] post:', e.message); res.status(500).json({ error: 'Could not post the job.' }); }
  });

  // ---- hire a pro (escrow held) ------------------------------------------
  router.post('/gigs/:id/hire', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const g = mapGig(await getGig(req.params.id));
      if (!g || g.reported) return res.status(404).json({ error: 'Job not found.' });
      if (Number(g.client_user_id) !== user.id) return res.status(403).json({ error: 'Only the poster can hire.' });
      if (g.status !== 'open') return res.status(400).json({ error: 'This job is no longer open.' });
      const body = req.body || {};
      let proUserId = body.proUserId != null ? Number(body.proUserId) : null;
      let proUsername = null;
      if (proUserId != null) {
        const pro = await dbGet('SELECT user_id, username FROM hustle_pros WHERE user_id=?',
          pg('SELECT user_id, username FROM hustle_pros WHERE user_id=$1'), [proUserId]);
        if (!pro) return res.status(400).json({ error: 'That pro is not listed.' });
        if (Number(proUserId) === user.id) return res.status(400).json({ error: 'You cannot hire yourself.' });
        proUsername = pro.username;
      }
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      if (!canAfford(c, g.fee, isAdmin)) {
        return res.status(400).json({ error: 'You cannot cover this fee right now.' });
      }
      // Escrow: the fee leaves the client's pocket and is HELD — not paid out.
      const held = charge(c, g.fee, isAdmin);
      await saveCharacter(c);
      await addTransaction(user.id, 'hustle_escrow', -held, Math.floor(Number(c.money) || 0),
        { gig_id: g.id, fee: g.fee });
      const now = Date.now();
      const upd = await dbRunReturning(
        'UPDATE hustle_gigs SET pro_user_id=?, pro_username=?, status=?, escrow_amount=?, hired_at=? WHERE id=? AND status=?',
        pg('UPDATE hustle_gigs SET pro_user_id=?, pro_username=?, status=?, escrow_amount=?, hired_at=? WHERE id=? AND status=? RETURNING id'),
        [proUserId, proUsername, 'hired', held, now, g.id, 'open'],
      );
      if (!upd.changes) {
        // Lost a race: someone else hired (or closed) this gig first.
        // Give the held fee straight back — never leave money stranded.
        const c2 = await ensureCharacter(user.id, user.username);
        c2.money = Math.floor(Number(c2.money) || 0) + held;
        await saveCharacter(c2);
        await addTransaction(user.id, 'hustle_refund', held, Math.floor(Number(c2.money) || 0),
          { gig_id: g.id, reason: 'hire_race_refund' });
        return res.status(409).json({ error: 'Someone just took this job.' });
      }
      res.json({ gig: gigJson(mapGig(await getGig(g.id))), copy: { escrow: ESCROW_COPY } });
    } catch (e) { console.error('[hustle] hire:', e.message); res.status(500).json({ error: 'Could not hire for this job.' }); }
  });

  // ---- mark done (escrow released to the pro) -------------------------------
  router.post('/gigs/:id/done', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const g = mapGig(await getGig(req.params.id));
      if (!g || g.reported) return res.status(404).json({ error: 'Job not found.' });
      if (Number(g.client_user_id) !== user.id) return res.status(403).json({ error: 'Only the poster can close the job.' });
      if (g.status !== 'hired') return res.status(400).json({ error: 'This job is not in progress.' });
      if (g.pro_user_id == null) return res.status(400).json({ error: 'No pro was hired for this job.' });

      const body = req.body || {};
      let rating = body.rating != null ? Math.floor(Number(body.rating)) : null;
      if (rating != null && (rating < 1 || rating > 5)) {
        return res.status(400).json({ error: 'Rating must be 1–5.' });
      }

      // Release the held fee to the pro.
      const proUser = await getUserById(Number(g.pro_user_id));
      if (!proUser) return res.status(400).json({ error: 'The pro account is gone.' });
      const pc = await ensureCharacter(proUser.id, proUser.username);
      const released = Math.floor(Number(g.escrow_amount) || 0);
      pc.money = Math.floor(Number(pc.money) || 0) + released;
      await saveCharacter(pc);
      await addTransaction(proUser.id, 'hustle_payout', released, Math.floor(Number(pc.money) || 0),
        { gig_id: g.id, fee: g.fee });

      // Pro stats: jobs done + running star average.
      const pro = await dbGet('SELECT stars, ratings_count AS ratingsCount FROM hustle_pros WHERE user_id=?',
        pg('SELECT stars, ratings_count AS "ratingsCount" FROM hustle_pros WHERE user_id=$1'), [proUser.id]);
      let newStars = pro ? Number(pro.stars) || 0 : 0;
      let newCount = pro ? Number(pro.ratingsCount ?? pro.ratings_count) || 0 : 0;
      if (pro && rating != null) {
        const upd = applyRating(newStars, newCount, rating);
        newStars = upd.stars; newCount = upd.ratingsCount;
      }
      if (pro) {
        await dbRun(
          'UPDATE hustle_pros SET jobs_done=jobs_done+1, stars=?, ratings_count=? WHERE user_id=?',
          pg('UPDATE hustle_pros SET jobs_done=jobs_done+1, stars=$1, ratings_count=$2 WHERE user_id=$3'),
          [newStars, newCount, proUser.id],
        );
      }

      const now = Date.now();
      await dbRun(
        'UPDATE hustle_gigs SET status=?, rating=?, done_at=?, escrow_amount=0 WHERE id=?',
        pg('UPDATE hustle_gigs SET status=$1, rating=$2, done_at=$3, escrow_amount=0 WHERE id=$4'),
        ['done', rating, now, g.id],
      );
      res.json({ gig: gigJson(mapGig(await getGig(g.id))) });
    } catch (e) { console.error('[hustle] done:', e.message); res.status(500).json({ error: 'Could not close the job.' }); }
  });

  // ---- cancel (free before hiring; escrow refunded after) --------------------
  router.post('/gigs/:id/cancel', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const g = mapGig(await getGig(req.params.id));
      if (!g || g.reported) return res.status(404).json({ error: 'Job not found.' });
      if (Number(g.client_user_id) !== user.id) return res.status(403).json({ error: 'Only the poster can cancel.' });
      if (g.status === 'done' || g.status === 'cancelled') {
        return res.status(400).json({ error: 'This job is already closed.' });
      }
      if (g.status === 'hired' && Number(g.escrow_amount) > 0) {
        const c = await ensureCharacter(user.id, user.username);
        const back = Math.floor(Number(g.escrow_amount) || 0);
        c.money = Math.floor(Number(c.money) || 0) + back;
        await saveCharacter(c);
        await addTransaction(user.id, 'hustle_refund', back, Math.floor(Number(c.money) || 0),
          { gig_id: g.id, reason: 'cancel_after_hire' });
      }
      await dbRun(
        "UPDATE hustle_gigs SET status='cancelled', escrow_amount=0 WHERE id=?",
        pg("UPDATE hustle_gigs SET status='cancelled', escrow_amount=0 WHERE id=$1"),
        [g.id],
      );
      res.json({ ok: true });
    } catch (e) { console.error('[hustle] cancel:', e.message); res.status(500).json({ error: 'Could not cancel the job.' }); }
  });

  // ---- my jobs ---------------------------------------------------------------
  router.get('/myjobs', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const sel = `id, client_user_id AS clientUserId, client_username AS clientUsername,
        pro_user_id AS proUserId, pro_username AS proUsername, category, title, details,
        fee, materials_budget, start_option, status, escrow_amount, rating, reported,
        created_at AS createdAt, hired_at AS hiredAt, done_at AS doneAt`;
      const selPg = sel.replace(/AS (\w+)/g, (m, a) => `AS "${a}"`);
      const posted = await dbAll(
        `SELECT ${sel} FROM hustle_gigs WHERE client_user_id=? ORDER BY created_at DESC LIMIT 40`,
        pg(`SELECT ${selPg} FROM hustle_gigs WHERE client_user_id=$1 ORDER BY created_at DESC LIMIT 40`),
        [user.id],
      );
      const working = await dbAll(
        `SELECT ${sel} FROM hustle_gigs WHERE pro_user_id=? AND status='hired' ORDER BY hired_at DESC LIMIT 40`,
        pg(`SELECT ${selPg} FROM hustle_gigs WHERE pro_user_id=$1 AND status='hired' ORDER BY hired_at DESC LIMIT 40`),
        [user.id],
      );
      res.json({
        posted: posted.map((r) => gigJson(mapGig(r))),
        working: working.map((r) => gigJson(mapGig(r))),
      });
    } catch (e) { console.error('[hustle] myjobs:', e.message); res.status(500).json({ error: 'Could not load your jobs.' }); }
  });

  // ---- find a pro --------------------------------------------------------------
  router.get('/pros', async (req, res) => {
    try {
      const cat = req.query.category ? String(req.query.category) : null;
      if (cat && !categoryByKey(cat)) return res.status(400).json({ error: 'Unknown category.' });
      const q = String(req.query.q || '').trim().slice(0, 40);
      const cols = `user_id, username, categories_json, rate_from, tagline, services_json,
        stars, jobs_done, ratings_count`;
      let rows;
      if (q) {
        rows = await dbAll(
          `SELECT ${cols} FROM hustle_pros
           WHERE (username LIKE ? OR tagline LIKE ? OR services_json LIKE ?)
           ORDER BY stars DESC, jobs_done DESC LIMIT 60`,
          pg(`SELECT ${cols} FROM hustle_pros
           WHERE (username LIKE ? OR tagline LIKE ? OR services_json LIKE ?)
           ORDER BY stars DESC, jobs_done DESC LIMIT 60`),
          [`%${q}%`, `%${q}%`, `%${q}%`],
        );
      } else {
        rows = await dbAll(
          `SELECT ${cols} FROM hustle_pros ORDER BY stars DESC, jobs_done DESC LIMIT 60`,
          `SELECT ${cols} FROM hustle_pros ORDER BY stars DESC, jobs_done DESC LIMIT 60`,
          [],
        );
      }
      let pros = rows.map(proJson);
      if (cat) pros = pros.filter((p) => p.categories.some((c) => c.key === cat));
      res.json({ pros });
    } catch (e) { console.error('[hustle] pros:', e.message); res.status(500).json({ error: 'Could not load pros.' }); }
  });

  // ---- hire me (list services) ----------------------------------------------------
  router.post('/pros', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const body = req.body || {};
      const cats = parseCategories(body.categories);
      if (!cats.length) return res.status(400).json({ error: 'Pick at least one category.' });
      const rateFrom = Math.max(MIN_FEE, Math.floor(Number(body.rateFrom) || MIN_FEE));
      const tagline = String(body.tagline || '').trim().slice(0, 80);
      if (tagline.length < 4) return res.status(400).json({ error: 'Add a short tagline so clients know your vibe.' });
      const services = parseJsonArray(body.services, 8, 40);
      const now = Date.now();
      await dbRun(
        `INSERT INTO hustle_pros (user_id, username, categories_json, rate_from, tagline,
            services_json, created_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,
           categories_json=excluded.categories_json, rate_from=excluded.rate_from,
           tagline=excluded.tagline, services_json=excluded.services_json`,
        pg(`INSERT INTO hustle_pros (user_id, username, categories_json, rate_from, tagline,
            services_json, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id) DO UPDATE SET username=EXCLUDED.username,
           categories_json=EXCLUDED.categories_json, rate_from=EXCLUDED.rate_from,
           tagline=EXCLUDED.tagline, services_json=EXCLUDED.services_json`),
        [user.id, user.username, JSON.stringify(cats), rateFrom, tagline, JSON.stringify(services), now],
      );
      const row = await dbGet(
        'SELECT user_id, username, categories_json, rate_from, tagline, services_json, stars, jobs_done, ratings_count FROM hustle_pros WHERE user_id=?',
        pg('SELECT user_id, username, categories_json, rate_from, tagline, services_json, stars, jobs_done, ratings_count FROM hustle_pros WHERE user_id=$1'),
        [user.id],
      );
      res.status(201).json({ pro: proJson(row) });
    } catch (e) { console.error('[hustle] list-me:', e.message); res.status(500).json({ error: 'Could not list your services.' }); }
  });

  // ---- unlist me -------------------------------------------------------------------
  router.delete('/pros', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      await dbRun('DELETE FROM hustle_pros WHERE user_id=?', pg('DELETE FROM hustle_pros WHERE user_id=$1'), [user.id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Could not unlist.' }); }
  });

  // ---- book a pro directly ------------------------------------------------------------
  router.post('/gigs/book', async (req, res) => {
    try {
      const user = await getUserById(req.userId);
      if (!user) return res.status(401).json({ error: 'Account not found.' });
      const body = req.body || {};
      const proUserId = Number(body.proUserId);
      if (!Number.isFinite(proUserId)) return res.status(400).json({ error: 'Pick a pro.' });
      if (proUserId === user.id) return res.status(400).json({ error: 'You cannot hire yourself.' });
      const pro = await dbGet('SELECT user_id, username FROM hustle_pros WHERE user_id=?',
        pg('SELECT user_id, username FROM hustle_pros WHERE user_id=$1'), [proUserId]);
      if (!pro) return res.status(400).json({ error: 'That pro is not listed.' });
      const cat = categoryByKey(body.category);
      if (!cat) return res.status(400).json({ error: 'Pick a category.' });
      const title = String(body.title || '').trim().slice(0, 80) || `${cat.name} booking`;
      const details = String(body.details || '').trim().slice(0, 500);
      const fee = Math.floor(Number(body.fee));
      if (!Number.isFinite(fee) || fee < MIN_FEE) {
        return res.status(400).json({ error: `Fee must be at least ₦${MIN_FEE.toLocaleString('en-NG')}.` });
      }
      const c = await ensureCharacter(user.id, user.username);
      const isAdmin = !!Number(user.is_admin);
      if (!canAfford(c, fee, isAdmin)) return res.status(400).json({ error: 'You cannot cover this fee right now.' });
      const held = charge(c, fee, isAdmin);
      await saveCharacter(c);
      const now = Date.now();
      const id = await insertId(
        `INSERT INTO hustle_gigs (client_user_id, client_username, pro_user_id, pro_username,
            category, title, details, fee, start_option, status, escrow_amount, created_at, hired_at)
         VALUES (?,?,?,?,?,?,?,?,?,'hired',?,?,?)`,
        pg(`INSERT INTO hustle_gigs (client_user_id, client_username, pro_user_id, pro_username,
            category, title, details, fee, start_option, status, escrow_amount, created_at, hired_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'hired',$10,$11,$12)`),
        [user.id, user.username, proUserId, pro.username, cat.key, title, details, fee,
          START_MAP[String(body.startOption)] ? String(body.startOption) : 'now', held, now, now],
      );
      await addTransaction(user.id, 'hustle_escrow', -held, Math.floor(Number(c.money) || 0),
        { gig_id: id, fee, direct: true });
      res.status(201).json({ gig: gigJson(mapGig(await getGig(id))), copy: { escrow: ESCROW_COPY } });
    } catch (e) { console.error('[hustle] book:', e.message); res.status(500).json({ error: 'Could not book the pro.' }); }
  });

  // ---- report ---------------------------------------------------------------------------
  router.post('/gigs/:id/report', async (req, res) => {
    try {
      await dbRun('UPDATE hustle_gigs SET reported=1 WHERE id=?', pg('UPDATE hustle_gigs SET reported=1 WHERE id=$1'), [Number(req.params.id)]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Could not report.' }); }
  });

  return router;
}
