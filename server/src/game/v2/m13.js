// ============================================================
// v2/M13 — Map billboards (admin-placed 3D ad boards)
//
// Original in-world advertising: admins place billboard creatives on the
// city map (map coords 0..100, same space as LOCATIONS). The client renders
// each active billboard as a 3D mesh with a runtime-drawn CanvasTexture.
// ============================================================
import { dbRun, dbGet, dbAll } from '../../db.js';
import { cleanText } from '../data.js';

// ---------------- Storage ----------------

export const SCHEMA_SQLITE = `CREATE TABLE IF NOT EXISTS billboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  headline TEXT NOT NULL,
  subtext TEXT NOT NULL DEFAULT '',
  bg TEXT NOT NULL DEFAULT '#0f172a',
  fg TEXT NOT NULL DEFAULT '#ffffff',
  accent TEXT NOT NULL DEFAULT '#22d3ee',
  x REAL NOT NULL,
  y REAL NOT NULL,
  scale REAL NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at BIGINT NOT NULL
);`;

export const SCHEMA_PG = `CREATE TABLE IF NOT EXISTS billboards (
  id SERIAL PRIMARY KEY,
  headline TEXT NOT NULL,
  subtext TEXT NOT NULL DEFAULT '',
  bg TEXT NOT NULL DEFAULT '#0f172a',
  fg TEXT NOT NULL DEFAULT '#ffffff',
  accent TEXT NOT NULL DEFAULT '#22d3ee',
  x REAL NOT NULL,
  y REAL NOT NULL,
  scale REAL NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at BIGINT NOT NULL
);`;

// Original Lagos-flavored seed creatives. Positions are map coords 0..100,
// chosen in empty land areas away from the dense location clusters:
// (mainland SW corner), (island far north), (mainland south),
// (mainland NW corner), (island SE corner), (island north-mid).
const SEED_BILLBOARDS = [
  {
    headline: 'MAMA PUT 2.0',
    subtext: 'Now with extra pepper — eat at your own risk!',
    bg: '#7f1d1d', fg: '#fef3c7', accent: '#fbbf24',
    x: 8, y: 88, scale: 1.1,
  },
  {
    headline: 'DANFO EXPRESS',
    subtext: 'We leave when full. Please, do not ask again.',
    bg: '#a16207', fg: '#0f172a', accent: '#fde047',
    x: 70, y: 8, scale: 1,
  },
  {
    headline: 'ÈKÓ LIFE — HUSTLE AM!',
    subtext: 'Your grind, your story. Free to play, free to dream.',
    bg: '#0f172a', fg: '#22d3ee', accent: '#f472b6',
    x: 30, y: 88, scale: 1.2,
  },
  {
    headline: 'NEPA? WE HAVE LIGHT',
    subtext: '(sometimes). Buy a generator anyway.',
    bg: '#1e3a8a', fg: '#fef9c3', accent: '#4ade80',
    x: 10, y: 6, scale: 1,
  },
  {
    headline: 'SUYA NIGHT MARKET',
    subtext: 'Abeg come chop — hot and fresh from 9pm.',
    bg: '#431407', fg: '#ffedd5', accent: '#fb923c',
    x: 92, y: 90, scale: 1.1,
  },
  {
    headline: 'RUN FOR GOVERNOR',
    subtext: 'Campaign fee ₦50,000. The city is watching.',
    bg: '#134e4a', fg: '#ecfdf5', accent: '#2dd4bf',
    x: 76, y: 10, scale: 1,
  },
];

export async function ensureSchema() {
  await dbRun(SCHEMA_SQLITE, SCHEMA_PG);
  const row = await dbGet(
    'SELECT COUNT(*) AS n FROM billboards',
    'SELECT COUNT(*) AS n FROM billboards',
    []
  );
  if (Number(row && row.n) > 0) return; // seed runs once
  const now = Date.now();
  for (const b of SEED_BILLBOARDS) {
    await dbRun(
      'INSERT INTO billboards (headline, subtext, bg, fg, accent, x, y, scale, active, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      'INSERT INTO billboards (headline, subtext, bg, fg, accent, x, y, scale, active, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [b.headline, b.subtext, b.bg, b.fg, b.accent, b.x, b.y, b.scale, 1, null, now]
    );
  }
}

// ---------------- Data access ----------------

/** Public shape of a billboard row (both dialects). */
export function publicBillboard(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    headline: String(r.headline || ''),
    subtext: String(r.subtext || ''),
    bg: r.bg, fg: r.fg, accent: r.accent,
    x: Number(r.x), y: Number(r.y),
    scale: Number(r.scale),
    active: Number(r.active) === 1,
    created_at: Number(r.created_at),
  };
}

export async function listBillboards() {
  const rows = await dbAll(
    'SELECT * FROM billboards ORDER BY id ASC',
    'SELECT * FROM billboards ORDER BY id ASC',
    []
  );
  return rows.map(publicBillboard);
}

export async function listActiveBillboards() {
  const rows = await dbAll(
    'SELECT * FROM billboards WHERE active = 1 ORDER BY id ASC',
    'SELECT * FROM billboards WHERE active = 1 ORDER BY id ASC',
    []
  );
  return rows.map(publicBillboard);
}

export async function getBillboard(id) {
  const row = await dbGet(
    'SELECT * FROM billboards WHERE id = ?',
    'SELECT * FROM billboards WHERE id = $1',
    [Number(id)]
  );
  return publicBillboard(row);
}

export async function createBillboard(input, createdBy) {
  await dbRun(
    'INSERT INTO billboards (headline, subtext, bg, fg, accent, x, y, scale, active, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    'INSERT INTO billboards (headline, subtext, bg, fg, accent, x, y, scale, active, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [input.headline, input.subtext, input.bg, input.fg, input.accent,
     input.x, input.y, input.scale, 1, createdBy == null ? null : Number(createdBy), Date.now()]
  );
  // Lowest-concurrency-safe read-back without touching db.js: newest row.
  const row = await dbGet(
    'SELECT * FROM billboards WHERE id = (SELECT MAX(id) FROM billboards)',
    'SELECT * FROM billboards WHERE id = (SELECT MAX(id) FROM billboards)',
    []
  );
  return publicBillboard(row);
}

const EDITABLE = ['headline', 'subtext', 'bg', 'fg', 'accent', 'x', 'y', 'scale', 'active'];

export async function updateBillboard(id, patch) {
  const cols = Object.keys(patch).filter((k) => EDITABLE.includes(k));
  if (cols.length === 0) return null;
  const setSqlite = cols.map((c) => `${c} = ?`).join(', ');
  const setPg = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const params = cols.map((c) => patch[c]);
  await dbRun(
    `UPDATE billboards SET ${setSqlite} WHERE id = ?`,
    `UPDATE billboards SET ${setPg} WHERE id = $${cols.length + 1}`,
    [...params, Number(id)]
  );
  return getBillboard(id);
}

export async function deleteBillboard(id) {
  const r = await dbRun(
    'DELETE FROM billboards WHERE id = ?',
    'DELETE FROM billboards WHERE id = $1',
    [Number(id)]
  );
  return r.changes > 0;
}

// ---------------- Pure logic: validation ----------------

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DEFAULTS = { bg: '#0f172a', fg: '#ffffff', accent: '#22d3ee' };

function validColor(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v).trim();
  return HEX_COLOR.test(s) ? s : null;
}

function validCoord(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/**
 * Validate a full create payload. Pure — no DB, no I/O.
 * Returns { ok:true, value } or { ok:false, error }.
 */
export function validateBillboard(input) {
  const b = input && typeof input === 'object' ? input : {};
  const rawHeadline = String(b.headline || '').trim();
  if (!rawHeadline) return { ok: false, error: 'Headline is required (1–60 chars).' };
  if (rawHeadline.length > 60) return { ok: false, error: 'Headline must be 60 characters or fewer.' };
  const rawSubtext = String(b.subtext || '').trim();
  if (rawSubtext.length > 120) return { ok: false, error: 'Subtext must be 120 characters or fewer.' };
  const headline = cleanText(rawHeadline, 60);
  const subtext = cleanText(rawSubtext, 120);
  const bg = validColor(b.bg, DEFAULTS.bg);
  if (bg === null) return { ok: false, error: 'bg must be a hex color like #0f172a.' };
  const fg = validColor(b.fg, DEFAULTS.fg);
  if (fg === null) return { ok: false, error: 'fg must be a hex color like #ffffff.' };
  const accent = validColor(b.accent, DEFAULTS.accent);
  if (accent === null) return { ok: false, error: 'accent must be a hex color like #22d3ee.' };
  const x = validCoord(b.x);
  if (x === null) return { ok: false, error: 'x must be a number between 0 and 100.' };
  const y = validCoord(b.y);
  if (y === null) return { ok: false, error: 'y must be a number between 0 and 100.' };
  let scale = 1;
  if (b.scale !== undefined && b.scale !== null && b.scale !== '') {
    scale = Number(b.scale);
    if (!Number.isFinite(scale) || scale < 0.5 || scale > 3) {
      return { ok: false, error: 'scale must be between 0.5 and 3.' };
    }
  }
  return { ok: true, value: { headline, subtext, bg, fg, accent, x, y, scale } };
}

/**
 * Validate a partial PATCH payload. Pure.
 * Returns { ok:true, patch } or { ok:false, error }.
 */
export function validateBillboardPatch(input) {
  const b = input && typeof input === 'object' ? input : {};
  const patch = {};
  if (b.headline !== undefined) {
    const raw = String(b.headline || '').trim();
    if (!raw) return { ok: false, error: 'Headline cannot be empty.' };
    if (raw.length > 60) return { ok: false, error: 'Headline must be 60 characters or fewer.' };
    patch.headline = cleanText(raw, 60);
  }
  if (b.subtext !== undefined) {
    const raw = String(b.subtext || '').trim();
    if (raw.length > 120) return { ok: false, error: 'Subtext must be 120 characters or fewer.' };
    patch.subtext = cleanText(raw, 120);
  }
  for (const k of ['bg', 'fg', 'accent']) {
    if (b[k] !== undefined) {
      const c = validColor(b[k], null);
      if (c === null) return { ok: false, error: `${k} must be a hex color like #0f172a.` };
      patch[k] = c;
    }
  }
  for (const k of ['x', 'y']) {
    if (b[k] !== undefined) {
      const n = validCoord(b[k]);
      if (n === null) return { ok: false, error: `${k} must be a number between 0 and 100.` };
      patch[k] = n;
    }
  }
  if (b.scale !== undefined) {
    const s = Number(b.scale);
    if (!Number.isFinite(s) || s < 0.5 || s > 3) {
      return { ok: false, error: 'scale must be between 0.5 and 3.' };
    }
    patch.scale = s;
  }
  if (b.active !== undefined) patch.active = b.active ? 1 : 0;
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'Nothing to update.' };
  }
  return { ok: true, patch };
}

// ---------------- REST handlers (Express (req,res) style) ----------------
// NOTE: the three admin handlers must be mounted BEHIND the admin router's
// requireAdmin middleware (routes/admin.js), which sets req.admin. They also
// 403-guard when req.admin is missing, so mounting them outside the admin
// router can never silently grant admin powers.

function requireAdminSelf(req, res) {
  if (!req.admin) {
    res.status(403).json({ error: 'Admin only.' });
    return false;
  }
  return true;
}

/** GET /api/v2/m13/billboards — public, active billboards only. */
export async function handleListBillboards(req, res) {
  try {
    const billboards = await listActiveBillboards();
    res.json({ billboards });
  } catch (e) {
    console.error('[m13] list billboards failed:', e.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

/** POST /api/admin/billboards — admin creates a billboard. */
export async function handleAdminCreateBillboard(req, res) {
  if (!requireAdminSelf(req, res)) return;
  const v = validateBillboard(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const billboard = await createBillboard(v.value, req.admin.id);
    res.status(201).json({ billboard });
  } catch (e) {
    console.error('[m13] create billboard failed:', e.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

/** PATCH /api/admin/billboards/:id — admin edits fields or toggles active. */
export async function handleAdminUpdateBillboard(req, res) {
  if (!requireAdminSelf(req, res)) return;
  const v = validateBillboardPatch(req.body || {});
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const billboard = await updateBillboard(req.params.id, v.patch);
    if (!billboard) return res.status(404).json({ error: 'Billboard not found.' });
    res.json({ billboard });
  } catch (e) {
    console.error('[m13] update billboard failed:', e.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

/** DELETE /api/admin/billboards/:id — admin deletes a billboard. */
export async function handleAdminDeleteBillboard(req, res) {
  if (!requireAdminSelf(req, res)) return;
  try {
    const ok = await deleteBillboard(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Billboard not found.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[m13] delete billboard failed:', e.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

// ---------------- Contract exports ----------------

// No WS intents for M13 (admin REST only).
export const INTENTS = {};

export const REST_SPEC = [
  {
    method: 'GET',
    path: '/api/v2/m13/billboards',
    auth: false,
    admin: false,
    handler: handleListBillboards,
    response: '{ billboards: [{ id, headline, subtext, bg, fg, accent, x, y, scale, active, created_at }] } (active only)',
  },
  {
    method: 'POST',
    path: '/api/admin/billboards',
    auth: true,
    admin: true,
    handler: handleAdminCreateBillboard,
    response: '201 { billboard: {...} } — body: { headline(≤60), subtext(≤120), bg/fg/accent(hex), x/y(0–100), scale(0.5–3) }',
  },
  {
    method: 'PATCH',
    path: '/api/admin/billboards/:id',
    auth: true,
    admin: true,
    handler: handleAdminUpdateBillboard,
    response: '{ billboard: {...} } — partial body incl. active toggle',
  },
  {
    method: 'DELETE',
    path: '/api/admin/billboards/:id',
    auth: true,
    admin: true,
    handler: handleAdminDeleteBillboard,
    response: '{ ok: true }',
  },
];
