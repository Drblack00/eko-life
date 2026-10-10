// ============================================================
// auth.js — Èkó Life auth: HMAC tokens, bcrypt, rate limits,
// lockouts, 18+ gate, guest mode, guest→account migration.
// ============================================================
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import {
  getUserByName, getUserById, createUser, migrateGuestToAccount,
  getCharacter, saveCharacter, countAdmins, setAdmin,
  resolveReferralCode, recordReferral,
} from './db.js';
import { AVATARS, COLORS } from './game/data.js';

const SECRET = process.env.SESSION_SECRET || 'eko-life-dev-secret-change-me';
if (!process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET not set — using dev fallback. Set a real secret in production!');
}

const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days
export const USER_RE = /^[a-zA-Z0-9_]{3,16}$/;

// ---------------- tokens ----------------
export function signToken(id) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = `${id}.${exp}`;
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return Buffer.from(`${body}.${sig}`).toString('base64url');
}

export function verifyToken(tok) {
  try {
    const s = Buffer.from(String(tok), 'base64url').toString('utf8');
    const parts = s.split('.');
    if (parts.length !== 3) return null;
    const [id, exp, sig] = parts;
    if (Date.now() > Number(exp)) return null;
    const good = crypto.createHmac('sha256', SECRET).update(`${id}.${exp}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    const n = Number(id);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

// ---------------- passwords ----------------
export function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
export function verifyPassword(pw, hash) {
  if (!hash) return false;
  try { return bcrypt.compareSync(pw, hash); } catch { return false; }
}

// ---------------- 18+ gate ----------------
export function is18Plus(dobStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dobStr || ''));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const dm = now.getUTCMonth() - (mo - 1);
  if (dm < 0 || (dm === 0 && now.getUTCDate() < d)) age--;
  return age >= 18;
}

// ---------------- rate limit + lockout ----------------
const authHits = new Map(); // ip -> [ts]
export function authRateLimit(req, res, next) {
  const ip = req.ip || 'x';
  const now = Date.now();
  const arr = (authHits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  authHits.set(ip, arr);
  if (arr.length > 10) return res.status(429).json({ error: 'Too many attempts, slow down.' });
  next();
}

const lockouts = new Map(); // username -> { count, until }
function lockCheck(name) {
  const l = lockouts.get(name);
  if (l && l.until > Date.now()) return Math.ceil((l.until - Date.now()) / 1000);
  return 0;
}
function lockFail(name) {
  const l = lockouts.get(name) || { count: 0, until: 0 };
  l.count += 1;
  if (l.count >= 5) { l.until = Date.now() + 15 * 60 * 1000; l.count = 0; }
  lockouts.set(name, l);
}

function cleanAvatar(a) { return AVATARS.includes(a) ? a : '🧑'; }
function cleanColor(c) {
  const s = String(c || '').toLowerCase();
  return COLORS.includes(s) ? s : '#22d3ee';
}

async function maybeFirstAdmin(id) {
  if ((await countAdmins()) === 0) {
    await setAdmin(id, true);
    console.log(`[auth] user ${id} promoted to first admin`);
    return true;
  }
  return false;
}

// ---------------- middleware ----------------
export function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: 'Auth required.' });
  const id = verifyToken(m[1]);
  if (!id) return res.status(401).json({ error: 'Invalid or expired token.' });
  req.userId = id;
  next();
}

// W3: referral attribution (data-only — no rewards, no payouts).
// Invalid codes are ignored gracefully; self-referral is rejected
// by recordReferral. Called after a successful /register.
async function attributeReferral(refCode, newUserId) {
  const code = String(refCode || '').trim();
  if (!code) return;
  try {
    const referrer = await resolveReferralCode(code);
    if (referrer) await recordReferral(referrer.id, newUserId);
  } catch (e) { console.error('[auth] referral attribution:', e.message); }
}

// ---------------- routes ----------------
export function createAuthRouter() {
  const router = Router();
  router.use(authRateLimit);

  // Guest play (18+ gate via age confirmation flag)
  router.post('/guest', async (req, res) => {
    if (req.body.ageConfirm !== true) {
      return res.status(400).json({ error: 'You must confirm you are 18 or older to play.' });
    }
    let username = '';
    for (let i = 0; i < 10; i++) {
      username = 'Guest_' + crypto.randomBytes(3).toString('hex');
      if (!(await getUserByName(username))) break;
    }
    const id = await createUser({ username, is_guest: 1 });
    console.log(`[auth] guest created: ${username} (id ${id})`);
    res.json({ token: signToken(id), username, guest: true, is_admin: false });
  });

  // Register (new account) or migrate (guestToken → full account, in place)
  router.post('/register', async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const dob = String(req.body.dob || '');
    const email = req.body.email ? String(req.body.email).trim().slice(0, 120) : null;

    if (!USER_RE.test(username)) {
      return res.status(400).json({ error: 'Username: 3–16 chars, letters, numbers or _.' });
    }
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'Password: 8–72 characters.' });
    }
    if (!is18Plus(dob)) {
      return res.status(400).json({ error: 'You must be 18 or older to play.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'That email address looks invalid.' });
    }
    const avatar = cleanAvatar(req.body.avatar);
    const color = cleanColor(req.body.color);
    const hash = hashPassword(password);

    // --- migration path ---
    if (req.body.guestToken) {
      const gid = verifyToken(req.body.guestToken);
      const guest = gid ? await getUserById(gid) : null;
      if (!guest || !Number(guest.is_guest)) {
        return res.status(400).json({ error: 'Invalid or expired guest token.' });
      }
      if (await getUserByName(username)) {
        return res.status(409).json({ error: 'Username taken.' });
      }
      const ok = await migrateGuestToAccount(guest.id, { username, email, pass_hash: hash, dob });
      if (!ok) return res.status(400).json({ error: 'Guest account could not be migrated.' });
      // apply chosen avatar/color to the kept character
      const ch = await getCharacter(guest.id);
      if (ch) { ch.avatar = avatar; ch.color = color; await saveCharacter(ch); }
      const isAdmin = await maybeFirstAdmin(guest.id);
      const fresh = await getUserById(guest.id);
      console.log(`[auth] guest ${guest.id} migrated → ${username}`);
      await attributeReferral(req.body.ref, guest.id);
      return res.json({ token: signToken(guest.id), username, is_admin: isAdmin || !!Number(fresh.is_admin) });
    }

    // --- fresh registration path ---
    if (await getUserByName(username)) {
      return res.status(409).json({ error: 'Username taken.' });
    }
    const id = await createUser({ username, email, pass_hash: hash, dob, is_guest: 0 });
    const ch = await getCharacter(id);
    if (ch) { ch.avatar = avatar; ch.color = color; await saveCharacter(ch); }
    const isAdmin = await maybeFirstAdmin(id);
    console.log(`[auth] registered: ${username} (id ${id})`);
    await attributeReferral(req.body.ref, id);
    res.json({ token: signToken(id), username, is_admin: isAdmin });
  });

  // Login
  router.post('/login', async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const locked = lockCheck(username);
    if (locked) {
      return res.status(429).json({ error: `Account locked. Try again in ${Math.ceil(locked / 60)} min.` });
    }
    const row = await getUserByName(username);
    if (!row || !verifyPassword(password, row.pass_hash)) {
      lockFail(username);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    if (Number(row.banned)) return res.status(403).json({ error: 'This account is banned.' });
    lockouts.delete(username);
    console.log(`[auth] login: ${username}`);
    res.json({ token: signToken(row.id), username: row.username, is_admin: !!Number(row.is_admin) });
  });

  return router;
}
