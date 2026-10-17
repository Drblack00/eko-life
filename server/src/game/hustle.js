// ============================================================
// game/hustle.js — Hustle gig board + Find-a-pro (game-money only).
//
// Players hire players: decorating, cooking, DJing, driving,
// bodyguarding, photography, tutoring, errands. All original copy.
//
// ESCROW (the trust engine): the client's fee is HELD SAFE the
// moment they hire someone and is released to the pro only when the
// client marks the job done. Nothing is paid until someone is hired.
// Cancel before hiring: free. Cancel after hiring: the held fee is
// refunded to the client. Game coins only — never real money.
//
// Safety: decorator jobs operate on a COPY of the client's home and
// can be done offline; players are told, in our own words, never to
// share their password and to hire only through jobs.
// ============================================================

/** Pro categories (original presentation). */
export const CATEGORIES = [
  { key: 'decorator', name: 'Decorator', icon: '🛋️', blurb: 'Turn a room around. Work from a copy of the home, even offline.' },
  { key: 'cook', name: 'Cook', icon: '🍲', blurb: 'Owambe spreads, meal prep, midnight cravings.' },
  { key: 'dj', name: 'DJ', icon: '🎧', blurb: 'Set the vibe. Parties, lounges, store openings.' },
  { key: 'driver', name: 'Driver', icon: '🚘', blurb: 'Airport runs, errands, safe night moves.' },
  { key: 'bodyguard', name: 'Bodyguard', icon: '🕶️', blurb: 'Move through the city with confidence.' },
  { key: 'photographer', name: 'Photographer', icon: '📸', blurb: 'Shoots, events, content that pops.' },
  { key: 'tutor', name: 'Tutor', icon: '📚', blurb: 'Exams, skills, new languages — patient teaching.' },
  { key: 'errands', name: 'Errands', icon: '🧰', blurb: 'Odd jobs, queues, deliveries, heavy lifting.' },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

export function categoryByKey(key) {
  return CATEGORY_MAP[String(key || '')] || null;
}

/** Minimum gig fee in gameplay coins. */
export const MIN_FEE = 1000;

/** Start-time options (original copy). */
export const START_OPTIONS = [
  { key: 'now', name: 'Right now', blurb: 'Start as soon as someone is hired.' },
  { key: '1h', name: 'In 1 hour', blurb: '' },
  { key: '3h', name: 'In 3 hours', blurb: '' },
  { key: '6h', name: 'In 6 hours', blurb: '' },
  { key: 'tomorrow', name: 'Tomorrow', blurb: '' },
  { key: '2d', name: 'In 2 days', blurb: '' },
  { key: '3d', name: 'In 3 days', blurb: '' },
];

export const START_MAP = Object.fromEntries(START_OPTIONS.map((s) => [s.key, s]));

/** Gig lifecycle: open → hired → done | cancelled. */
export const GIG_STATUSES = new Set(['open', 'hired', 'done', 'cancelled']);

/** Safety + escrow copy (our own words). */
export const ESCROW_COPY = 'The fee is held safe until the job is done.';
export const NO_PAY_COPY = 'Nothing is paid until you hire someone.';
export const SAFETY_COPY = 'Never share your password — hire through jobs.';
export const DECORATOR_COPY = 'Decorators work on a copy of your home from anywhere, even when you are offline.';

/** Star display helper: 4.4 → "★★★★☆" style is done client-side; server keeps the number. */
export function ratingStars(stars) {
  const s = Math.max(0, Math.min(5, Number(stars) || 0));
  return Math.round(s * 10) / 10;
}

// ---------------- Storage (idempotent schema) ----------------

export const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS hustle_gigs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_user_id INTEGER NOT NULL,
  client_username TEXT NOT NULL,
  pro_user_id INTEGER,
  pro_username TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  fee INTEGER NOT NULL DEFAULT 1000,
  materials_budget INTEGER NOT NULL DEFAULT 0,
  start_option TEXT NOT NULL DEFAULT 'now',
  status TEXT NOT NULL DEFAULT 'open',
  escrow_amount INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  reported INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  hired_at INTEGER,
  done_at INTEGER
);
CREATE TABLE IF NOT EXISTS hustle_pros (
  user_id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  rate_from INTEGER NOT NULL DEFAULT 1000,
  tagline TEXT NOT NULL DEFAULT '',
  services_json TEXT NOT NULL DEFAULT '[]',
  stars REAL NOT NULL DEFAULT 0,
  jobs_done INTEGER NOT NULL DEFAULT 0,
  ratings_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);`;

export const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS hustle_gigs (
  id SERIAL PRIMARY KEY,
  client_user_id INTEGER NOT NULL,
  client_username TEXT NOT NULL,
  pro_user_id INTEGER,
  pro_username TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  fee INTEGER NOT NULL DEFAULT 1000,
  materials_budget INTEGER NOT NULL DEFAULT 0,
  start_option TEXT NOT NULL DEFAULT 'now',
  status TEXT NOT NULL DEFAULT 'open',
  escrow_amount INTEGER NOT NULL DEFAULT 0,
  rating INTEGER,
  reported INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  hired_at BIGINT,
  done_at BIGINT
);
CREATE TABLE IF NOT EXISTS hustle_pros (
  user_id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  rate_from INTEGER NOT NULL DEFAULT 1000,
  tagline TEXT NOT NULL DEFAULT '',
  services_json TEXT NOT NULL DEFAULT '[]',
  stars REAL NOT NULL DEFAULT 0,
  jobs_done INTEGER NOT NULL DEFAULT 0,
  ratings_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);`;

/** Split multi-statement schema into single statements (dbRun = one per call). */
export function schemaStatements(sql) {
  return sql.split(';').map((s) => s.trim()).filter(Boolean);
}

/** Running average when a client rates a pro 1–5 after a done job. */
export function applyRating(stars, ratingsCount, newRating) {
  const total = stars * ratingsCount + newRating;
  const count = ratingsCount + 1;
  return { stars: Math.round((total / count) * 10) / 10, ratingsCount: count };
}
