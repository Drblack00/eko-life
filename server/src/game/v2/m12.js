// ============================================================
// game/v2/m12.js — M12: Skills + Academy
//
// Nine trainable skills (Cooking, Charisma, Fitness, Coding, Music,
// Hustle, Dance, Comedy, Photography) with XP/levels, location-gated
// training, and rust from inactivity. Plus an Academy at the three
// campus venues: 10 ORIGINAL short courses (4 lessons each, max 2 per
// real day, per-lesson fee, instant skill XP) ending in a 3-question
// quiz for a certificate worth +1 effective skill level on career gates.
//
// All course/quiz text is original to Èkó Life (Lagos-flavored).
// Server-authoritative: XP/level-ups/answers are computed or validated
// server-side; the client never sends numbers we trust.
// ============================================================
import { dbRun, dbGet, dbAll } from '../../db.js';
import { LOCATIONS } from '../data.js';
// M21: admin unlimited stealth money.
import { isAdminConn, canAfford, charge } from '../money.js';

// ---------------- 1. Storage ----------------
export const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS academy_progress (
  user_id INTEGER NOT NULL,
  course_id TEXT NOT NULL,
  lessons_done INTEGER NOT NULL DEFAULT 0,
  lesson_day TEXT NOT NULL DEFAULT '',
  lessons_today INTEGER NOT NULL DEFAULT 0,
  quiz_fails INTEGER NOT NULL DEFAULT 0,
  quiz_cooldown_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, course_id)
);`;
export const SCHEMA_SQLITE_2 = `
CREATE TABLE IF NOT EXISTS academy_certs (
  user_id INTEGER NOT NULL,
  course_id TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_id)
);`;
export const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS academy_progress (
  user_id BIGINT NOT NULL,
  course_id TEXT NOT NULL,
  lessons_done INTEGER NOT NULL DEFAULT 0,
  lesson_day TEXT NOT NULL DEFAULT '',
  lessons_today INTEGER NOT NULL DEFAULT 0,
  quiz_fails INTEGER NOT NULL DEFAULT 0,
  quiz_cooldown_until BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, course_id)
);`;
export const SCHEMA_PG_2 = `
CREATE TABLE IF NOT EXISTS academy_certs (
  user_id BIGINT NOT NULL,
  course_id TEXT NOT NULL,
  awarded_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, course_id)
);`;

// PORT-P1: external certificate registry (Phase 5 hook) — begin
export const SCHEMA_SQLITE_3 = `
CREATE TABLE IF NOT EXISTS cert_skill_map (
  course_id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT ''
);`;
export const SCHEMA_PG_3 = `
CREATE TABLE IF NOT EXISTS cert_skill_map (
  course_id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT ''
);`;
// PORT-P1: external certificate registry (Phase 5 hook) — end

export async function ensureSchema() {
  await dbRun(SCHEMA_SQLITE, SCHEMA_PG);
  await dbRun(SCHEMA_SQLITE_2, SCHEMA_PG_2);
  // PORT-P1: external certificate registry
  await dbRun(SCHEMA_SQLITE_3, SCHEMA_PG_3);
}

// ---------------- 2. Pure logic: skills ----------------
export const SKILLS = [
  { id: 'cooking', name: 'Cooking', icon: '🍲' },
  { id: 'charisma', name: 'Charisma', icon: '✨' },
  { id: 'fitness', name: 'Fitness', icon: '💪' },
  { id: 'coding', name: 'Coding', icon: '💻' },
  { id: 'music', name: 'Music', icon: '🎧' },
  { id: 'hustle', name: 'Hustle', icon: '🔥' },
  { id: 'dance', name: 'Dance', icon: '💃' },
  { id: 'comedy', name: 'Comedy', icon: '🎤' },
  { id: 'photography', name: 'Photography', icon: '📸' },
  // PORT-P1: 10th skill — style & stitch.
  { id: 'fashion', name: 'Fashion', icon: '👗' },
];
export const SKILL_IDS = SKILLS.map(s => s.id);

// XP to level from n → n+1 is 100*(n+1): L0→1 costs 100, L1→2 costs 200, ...
export const SKILL_TUNING = {
  xpStep: 100,                 // xpForLevel(n) = 100 * (n+1)
  trainXp: 20,                 // base XP per training session
  trainEnergy: 15,             // energy cost per training session
  trainCooldownSec: 60,        // per-skill anti-spam cooldown
  lessonXp: 60,                // XP granted per academy lesson (instant)
  certXp: 150,                 // bonus XP chunk on passing a course quiz
  maxDailyLessons: 2,          // academy lessons per real day (Lagos wall clock)
  quizQuestions: 3,
  quizPassScore: 2,            // need ≥2/3 to earn the certificate
  quizFailCooldownMs: 60 * 60 * 1000, // 1h quiz retry cooldown after a fail
  rustGraceDays: 7,            // skills never rust before 7 idle days
  rustDaysPerLevel: 20,        // beyond grace: ~1 level lost per 20 idle days
  rustMaxLoss: 2,              // cap: never more than 2 levels rusted per skill
};
export const xpForLevel = (n) => SKILL_TUNING.xpStep * (Math.max(0, Math.floor(n)) + 1);

// Rust formula (pure timestamp math, no extra state):
//   idle < 7d           → 0
//   7d ≤ idle < 27d     → 1 level
//   idle ≥ 27d          → 2 levels (capped)
// Training resets used_at, which recomputes everything — nothing is stored.
export function rustLoss(lastUsedTs, now = Date.now()) {
  if (!lastUsedTs || !Number.isFinite(Number(lastUsedTs))) return 0;
  const daysIdle = (now - Number(lastUsedTs)) / 86400000;
  if (daysIdle < SKILL_TUNING.rustGraceDays) return 0;
  const loss = 1 + Math.floor((daysIdle - SKILL_TUNING.rustGraceDays) / SKILL_TUNING.rustDaysPerLevel);
  return Math.min(SKILL_TUNING.rustMaxLoss, loss);
}

// Location → skill training mapping (tags come from OUR LOCATIONS).
export const TRAIN_GATES = {
  cooking:     { tags: ['market'],            label: 'markets',             fee: 500,  note: 'Learn the ropes at market food stalls.' },
  charisma:    { tags: ['club', 'mall'],      label: 'clubs & malls',       fee: 0,    note: 'Work the crowd, own the room.' },
  fitness:     { tags: ['stadium'],           label: 'stadiums',            fee: 0,    note: 'Train where street legends are made.' },
  coding:      { tags: ['tech_hub'],          label: 'tech hubs',           fee: 1000, note: 'Pair up in a co-working loft.' },
  music:       { tags: ['club'],              label: 'clubs',               fee: 1500, note: 'Open-mic nights and DJ booths.' },
  hustle:      { tags: ['motor_park'],        label: 'motor parks',         fee: 0,    note: 'The real school of the streets.' },
  dance:       { tags: ['beach', 'club'],     label: 'beaches & clubs',     fee: 500,  note: 'Move where the music plays.' },
  comedy:      { tags: ['landmark'],          label: 'landmarks',           fee: 0,    note: 'Open-mic at city landmarks.' },
  photography: { tags: ['beach', 'landmark'], label: 'beaches & landmarks', fee: 1000, note: 'Golden-hour shoots.' },
  // PORT-P1: fashion trains where style is sold and sewn.
  fashion:     { tags: ['mall', 'market'], label: 'malls & markets', fee: 500, note: 'Apprentice under tailors and stylists.' },
};

// ---- Character-column helpers (columns added by the coordinator) ----
// characters.skills: JSON {id: {xp, level}}  — defaults all level 0, xp 0
// characters.skills_used: JSON {id: lastUsedTs}
export function blankSkillMap() {
  const m = {};
  for (const id of SKILL_IDS) m[id] = { xp: 0, level: 0 };
  return m;
}
export function getSkills(char) {
  const m = blankSkillMap();
  try {
    const raw = typeof char.skills === 'string' ? JSON.parse(char.skills) : char.skills;
    if (raw && typeof raw === 'object') {
      for (const id of SKILL_IDS) {
        const r = raw[id];
        if (r && typeof r === 'object') {
          m[id] = {
            xp: Math.max(0, Math.floor(Number(r.xp) || 0)),
            level: Math.max(0, Math.floor(Number(r.level) || 0)),
          };
        }
      }
    }
  } catch { /* malformed → defaults */ }
  return m;
}
export function getSkillsUsed(char) {
  const m = {};
  try {
    const raw = typeof char.skills_used === 'string' ? JSON.parse(char.skills_used) : char.skills_used;
    if (raw && typeof raw === 'object') {
      for (const id of SKILL_IDS) {
        const ts = Number(raw[id]);
        if (Number.isFinite(ts) && ts > 0) m[id] = ts;
      }
    }
  } catch { /* malformed → none */ }
  return m;
}
export function saveSkillsState(char, skills, used) {
  char.skills = JSON.stringify(skills);
  char.skills_used = JSON.stringify(used);
}

// Grant XP to a skill (mutates char in place). Returns {leveledUp, level, xp}.
export function addSkillXp(char, id, xp) {
  if (!SKILL_IDS.includes(id)) throw new Error('unknown skill');
  const skills = getSkills(char);
  const used = getSkillsUsed(char);
  const s = skills[id];
  s.xp = Math.max(0, s.xp + Math.max(0, Math.floor(xp)));
  let leveledUp = false;
  for (;;) {
    const need = xpForLevel(s.level);
    if (s.xp < need) break;
    s.xp -= need;
    s.level += 1;
    leveledUp = true;
  }
  used[id] = Date.now();
  saveSkillsState(char, skills, used);
  return { leveledUp, level: s.level, xp: s.xp };
}

// Defensive read of an M9 {type:'xp_boost'} perk (M9 not built yet — any
// shape, or none, must not break training). Returns the XP multiplier.
export function xpBoostMult(char) {
  try {
    const candidates = [];
    if (char.perks != null) {
      const p = typeof char.perks === 'string' ? JSON.parse(char.perks) : char.perks;
      if (Array.isArray(p)) candidates.push(...p);
      else if (p && typeof p === 'object') candidates.push(p);
    }
    if (typeof char.xp_boost === 'number') candidates.push({ type: 'xp_boost', pct: char.xp_boost });
    for (const p of candidates) {
      if (p && p.type === 'xp_boost') {
        const pct = Math.max(0, Math.min(100, Number(p.pct) || 0));
        return 1 + pct / 100;
      }
    }
  } catch { /* malformed perks → no boost */ }
  return 1;
}

// Effective skill level for M7's career gates:
//   base level + cert bonus (max +1) − rust loss, floored at 0.
export function certCourseIdsForSkill(skillId) {
  return COURSES.filter(c => c.skillBoost.skill === skillId).map(c => c.id);
}
export function skillLevel(char, id, certCourseIds = []) {
  if (!SKILL_IDS.includes(id)) return 0;
  const base = getSkills(char)[id].level;
  const boostCourses = certCourseIdsForSkill(id);
  const certBonus = boostCourses.length && certCourseIds.some(cid => boostCourses.includes(cid)) ? 1 : 0;
  const rust = rustLoss(getSkillsUsed(char)[id]);
  return Math.max(0, base + certBonus - rust);
}

// Convenience for M7: effective levels for every skill for one user.
// certCourseIds can be fetched via getAcademyCerts(userId).
export function effectiveSkillLevels(char, certCourseIds = []) {
  const out = {};
  for (const id of SKILL_IDS) out[id] = skillLevel(char, id, certCourseIds);
  return out;
}

function locTags(id) {
  const l = LOCATIONS.find(x => x.id === id);
  return (l && l.tags) || [];
}
const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');
const lagosDay = (now = Date.now()) =>
  new Date(now).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

// ---------------- 3. Academy: courses + quizzes (all original) ----------------
export const COURSES = [
  { id: 'owambe_catering', name: 'Owambe Catering', icon: '🍲', feePerLesson: 2500,
    desc: 'Run a party kitchen: jollof for 500 guests, small chops assembly lines, and serving under Lagos pressure.',
    lessons: 4, skillBoost: { skill: 'cooking', xp: 60 }, relatedJobs: ['market_trader'] },
  { id: 'danfo_logistics', name: 'Danfo Logistics', icon: '🚌', feePerLesson: 2000,
    desc: 'Master the yellow bus economy: routes, fares, change management, and keeping a schedule in traffic.',
    lessons: 4, skillBoost: { skill: 'hustle', xp: 60 }, relatedJobs: ['danfo_conductor'] },
  { id: 'afrobeats_production', name: 'Afrobeats Production', icon: '🎧', feePerLesson: 4000,
    desc: 'Build a hit from the log drum up: rhythm, melody, vocal takes, and mixing for club systems.',
    lessons: 4, skillBoost: { skill: 'music', xp: 60 }, relatedJobs: ['lounge_barista'] },
  { id: 'aso_ebi_fashion', name: 'Aso-Ebi Fashion', icon: '👗', feePerLesson: 3000,
    desc: 'Dress the whole party: fabric sourcing, colour stories, and styling that turns heads at owambes.',
    lessons: 4, skillBoost: { skill: 'charisma', xp: 60 }, relatedJobs: ['shop_assistant'] },
  { id: 'pos_business', name: 'POS Business Mastery', icon: '🏧', feePerLesson: 3500,
    desc: 'Run a corner POS stand like a bank: float management, spotting fake alerts, and customer trust.',
    lessons: 4, skillBoost: { skill: 'hustle', xp: 60 }, relatedJobs: ['bank_teller'] },
  { id: 'street_photography', name: 'Street Photography', icon: '📸', feePerLesson: 3000,
    desc: 'Shoot Lagos like it deserves: golden hour, market portraits, and respect behind the lens.',
    lessons: 4, skillBoost: { skill: 'photography', xp: 60 }, relatedJobs: ['beach_lifeguard'] },
  { id: 'gym_coaching', name: 'Street Gym Coaching', icon: '🏋️', feePerLesson: 2500,
    desc: 'Coach real bodies: beginner programs, form first, food basics, and keeping clients consistent.',
    lessons: 4, skillBoost: { skill: 'fitness', xp: 60 }, relatedJobs: ['hospital_orderly'] },
  { id: 'standup_comedy', name: 'Stand-Up Comedy', icon: '🎤', feePerLesson: 2000,
    desc: 'Kill on open-mic night: writing punchlines, timing, bombing gracefully, and reading a Lagos crowd.',
    lessons: 4, skillBoost: { skill: 'comedy', xp: 60 }, relatedJobs: ['campus_tutor'] },
  { id: 'yaba_code_bootcamp', name: 'Yaba Code Bootcamp', icon: '💻', feePerLesson: 4000,
    desc: 'From variables to version control: the bootcamp that turns laptop owners into junior devs.',
    lessons: 4, skillBoost: { skill: 'coding', xp: 60 }, relatedJobs: ['junior_dev'] },
  { id: 'owambe_dance', name: 'Owambe Dance Mastery', icon: '💃', feePerLesson: 2500,
    desc: 'Own every dancefloor: legwork timing, crowd entries, and the combos that stop traffic.',
    lessons: 4, skillBoost: { skill: 'dance', xp: 60 }, relatedJobs: ['market_porter'] },
];
export const COURSE_BY_ID = Object.fromEntries(COURSES.map(c => [c.id, c]));

// 3 ORIGINAL multiple-choice questions per course. The server is the source
// of truth for `answer`; clients receive only {q, options} — no client trust.
export const COURSE_QUIZZES = {
  owambe_catering: [
    { q: 'Which rice dish is the undisputed star of every owambe?',
      options: ['Fried rice', 'Party jollof', 'Ofada rice', 'Coconut rice'], answer: 1 },
    { q: 'What gives party jollof its signature smoky flavour?',
      options: ['Extra pepper', 'Firewood heat licking the pot', 'More onions', 'Palm oil'], answer: 1 },
    { q: 'Guests arrived at 2pm but the caterer says food "is coming". What is happening?',
      options: ['Food is ready', 'Classic Naija time — it is not ready yet', 'They ran out of plates', 'The party moved venues'], answer: 1 },
  ],
  danfo_logistics: [
    { q: 'A conductor shouts "O wa o!" — what does it mean?',
      options: ['Get in, we are moving', 'The bus broke down', 'Fares just doubled', 'Police checkpoint ahead'], answer: 0 },
    { q: 'Best way to keep change flowing on a danfo route?',
      options: ['Hoard all the ₦1,000 notes', 'Keep small denominations ready before each stop', 'Round every fare up', 'Skip giving change'], answer: 1 },
    { q: 'Rush-hour traffic is locked. The smart danfo move is…',
      options: ['Wait it out in silence', 'Cut through side streets you actually know', 'Honk louder', 'Drop passengers mid-bridge'], answer: 1 },
  ],
  afrobeats_production: [
    { q: 'The heartbeat rhythm behind most Afrobeats hits is built on…',
      options: ['Four-on-the-floor kick', 'Syncopated log-drum patterns', 'Straight rock drums', 'A loud metronome'], answer: 1 },
    { q: "A vocalist's take sounds flat. The first fix before re-recording?",
      options: ['Add more reverb', 'Check the headphone mix and pitch reference', 'Turn everything up', 'Delete the take'], answer: 1 },
    { q: "Why do producers bounce a rough mix to the artist's phone?",
      options: ['To show off', 'Phone speakers reveal what club systems hide', 'It is tradition', 'To save studio time'], answer: 1 },
  ],
  aso_ebi_fashion: [
    { q: 'Aso-ebi literally means…',
      options: ['Family cloth — one fabric for a group', 'Expensive lace', 'A bridal gown', 'A school uniform'], answer: 0 },
    { q: "A client wants to outshine the celebrant. You advise…",
      options: ['Go bigger at all costs', 'Respect the dress code — never outshine the host', 'Wear white to a wedding', 'Skip the party'], answer: 1 },
    { q: 'Best fabric advice for a December outdoor owambe?',
      options: ['Heavy brocade layers', 'Breathable lace with light lining', 'Full velvet', 'A wool suit'], answer: 1 },
  ],
  pos_business: [
    { q: "A customer's transfer shows 'pending' after 10 minutes. You…",
      options: ['Release the cash anyway', 'Ask them to wait or retry — never pay out on pending', 'Charge double', 'Close the shop'], answer: 1 },
    { q: 'Your biggest daily risk as a POS agent is…',
      options: ['NEPA taking light', 'Fake transfer alerts', 'Rain', 'A noisy generator'], answer: 1 },
    { q: 'Smart float management means…',
      options: ['Keep all cash in the drawer', 'Split cash between drawer and a secure spot, track every naira', 'Lend float to friends', 'Bank only on Mondays'], answer: 1 },
  ],
  street_photography: [
    { q: 'Golden hour is prized because…',
      options: ['Cameras work faster', 'Soft warm light flatters skin', 'Streets are empty', 'Batteries last longer'], answer: 1 },
    { q: 'Shooting a crowded market — the respectful move is…',
      options: ['Snap secretly and fast', 'Ask permission or buy something first', 'Use flash in faces', 'Climb their stall'], answer: 1 },
    { q: 'Your photos look washed out at noon. The quick fix?',
      options: ['Shoot in open shade or wait for softer light', 'Zoom in more', 'Fix it with a filter later', 'Overexpose on purpose'], answer: 0 },
  ],
  gym_coaching: [
    { q: "A beginner's first week should focus on…",
      options: ['Max weight on day one', 'Form and consistency with light loads', 'Only cardio', 'Skipping rest days'], answer: 1 },
    { q: 'Protein after training matters because…',
      options: ['It burns fat directly', 'It supplies building blocks for muscle repair', 'It replaces water', 'It increases height'], answer: 1 },
    { q: 'A client feels sharp joint pain mid-set. You…',
      options: ['Push through it', 'Stop the set and assess — pain is a signal', 'Add more weight', 'Switch to sprints'], answer: 1 },
  ],
  standup_comedy: [
    { q: 'The golden rule of a tight five minutes is…',
      options: ['Shout the punchlines', 'Set up, then punch — trim every wasted word', 'Insult the front row', 'Wing the whole set'], answer: 1 },
    { q: 'A joke bombs. The pro move is…',
      options: ['Blame the crowd', 'Acknowledge it and move on fast', 'Repeat it louder', 'Walk off stage'], answer: 1 },
    { q: 'Why do comics record every set?',
      options: ['For Instagram only', 'To study laughs, timing and dead spots', 'Promoters demand it', 'It is required by law'], answer: 1 },
  ],
  yaba_code_bootcamp: [
    { q: 'A variable holding whole numbers (1, 2, 3) is called…',
      options: ['A string', 'An integer', 'A boolean', 'A float'], answer: 1 },
    { q: 'Your code crashes on line 42. The first step?',
      options: ['Rewrite everything', 'Read the error message — it names the problem', 'Restart the laptop', 'Ask social media'], answer: 1 },
    { q: "Git 'commit' does what?",
      options: ['Uploads to the cloud', 'Saves a snapshot of your changes', 'Deletes history', 'Runs the code'], answer: 1 },
  ],
  owambe_dance: [
    { q: 'The secret to a clean legwork combo is…',
      options: ['Speed at all costs', 'Timing on the beat, then speed', 'Closed eyes', 'Heavy shoes'], answer: 1 },
    { q: 'You are called to dance at an owambe. First rule?',
      options: ['Stay seated', 'Enter with confidence — the floor is yours', 'Copy the DJ', 'Dance only slow songs'], answer: 1 },
    { q: 'Why do dancers mark the beat with a shoulder pop?',
      options: ['It is random', 'It locks your body to the rhythm', 'Judges require it', 'It saves energy'], answer: 1 },
  ],
};
// Sanity: every course has exactly 3 questions with 4 options and a valid answer.
for (const [cid, qs] of Object.entries(COURSE_QUIZZES)) {
  if (!COURSE_BY_ID[cid] || qs.length !== SKILL_TUNING.quizQuestions ||
      qs.some(q => !Array.isArray(q.options) || q.options.length !== 4 || q.answer < 0 || q.answer > 3)) {
    throw new Error(`m12: bad quiz data for ${cid}`);
  }
}

// Strip answers before sending to any client.
export function quizForClient(courseId) {
  return (COURSE_QUIZZES[courseId] || []).map(q => ({ q: q.q, options: q.options }));
}

// ---------------- Academy storage ----------------
export async function getAcademyProgress(userId) {
  return dbAll(
    'SELECT * FROM academy_progress WHERE user_id = ?',
    'SELECT * FROM academy_progress WHERE user_id = $1',
    [userId],
  );
}
export async function getAcademyProgressFor(userId, courseId) {
  return dbGet(
    'SELECT * FROM academy_progress WHERE user_id = ? AND course_id = ?',
    'SELECT * FROM academy_progress WHERE user_id = $1 AND course_id = $2',
    [userId, courseId],
  );
}
export async function getAcademyCerts(userId) {
  const rows = await dbAll(
    'SELECT course_id FROM academy_certs WHERE user_id = ? ORDER BY awarded_at',
    'SELECT course_id FROM academy_certs WHERE user_id = $1 ORDER BY awarded_at',
    [userId],
  );
  return rows.map(r => r.course_id);
}
export async function hasAcademyCert(userId, courseId) {
  const row = await dbGet(
    'SELECT 1 AS ok FROM academy_certs WHERE user_id = ? AND course_id = ?',
    'SELECT 1 AS ok FROM academy_certs WHERE user_id = $1 AND course_id = $2',
    [userId, courseId],
  );
  return !!row;
}

// ---------------- PORT-P1: external certificate hook (Phase 5) ----------------
// Phase 5's courses (or any other phase) call grantCertificate() to award a
// certificate + career boost for one skill. The cert is stored in
// academy_certs with an `ext:<skill>:<course>` id, and its title/skill in
// cert_skill_map. skillBoostsFor(userId) returns every boosted skill id
// (academy + external); skillLevelWithExt() applies the +1 effective level
// exactly like an academy cert, without double-counting.
export async function grantCertificate(userId, { courseId, title, skillId }) {
  if (!courseId) throw new Error('courseId required');
  if (!SKILL_IDS.includes(skillId)) throw new Error('unknown skill');
  const slug = String(courseId).replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'course';
  const extId = `ext:${skillId}:${slug}`;
  const now = Date.now();
  await dbRun(
    'INSERT OR IGNORE INTO academy_certs (user_id, course_id, awarded_at) VALUES (?, ?, ?)',
    'INSERT INTO academy_certs (user_id, course_id, awarded_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [userId, extId, now]);
  await dbRun(
    `INSERT INTO cert_skill_map (course_id, skill_id, title) VALUES (?,?,?)
     ON CONFLICT(course_id) DO UPDATE SET skill_id=excluded.skill_id, title=excluded.title`,
    `INSERT INTO cert_skill_map (course_id, skill_id, title) VALUES ($1,$2,$3)
     ON CONFLICT (course_id) DO UPDATE SET skill_id=excluded.skill_id, title=excluded.title`,
    [extId, skillId, String(title || courseId).slice(0, 120)]);
  return { ok: true, courseId: extId, skillId, boost: '+1 effective skill level on career gates' };
}

// All certificates for a user: academy courses + external, with skill + title.
export async function listCertificates(userId) {
  const rows = await dbAll(
    `SELECT ac.course_id, ac.awarded_at, COALESCE(m.skill_id, '') AS skill_id, COALESCE(m.title, '') AS title
       FROM academy_certs ac LEFT JOIN cert_skill_map m ON m.course_id = ac.course_id
      WHERE ac.user_id = ? ORDER BY ac.awarded_at`,
    `SELECT ac.course_id, ac.awarded_at, COALESCE(m.skill_id, '') AS skill_id, COALESCE(m.title, '') AS title
       FROM academy_certs ac LEFT JOIN cert_skill_map m ON m.course_id = ac.course_id
      WHERE ac.user_id = $1 ORDER BY ac.awarded_at`,
    [userId]);
  return rows.map(r => ({
    courseId: r.course_id,
    skillId: r.skill_id || skillIdOfAcademyCourse(r.course_id),
    title: r.title || academyCourseName(r.course_id),
    awardedAt: Number(r.awarded_at) || 0,
    external: String(r.course_id).startsWith('ext:'),
  }));
}

function skillIdOfAcademyCourse(courseId) {
  const c = COURSES.find(x => x.id === courseId);
  return c ? c.skillBoost.skill : '';
}
function academyCourseName(courseId) {
  const c = COURSES.find(x => x.id === courseId);
  return c ? c.name : String(courseId);
}

// Skill ids with any certificate boost (academy or external).
export function boostedSkills(certCourseIds = []) {
  const out = new Set();
  for (const cid of certCourseIds || []) {
    const m = /^ext:([^:]+):/.exec(String(cid));
    if (m && SKILL_IDS.includes(m[1])) { out.add(m[1]); continue; }
    const c = COURSES.find(x => x.id === cid);
    if (c) out.add(c.skillBoost.skill);
  }
  return [...out];
}

// skillLevel() that also honors external certificates (no double count).
export function skillLevelWithExt(char, id, certCourseIds = []) {
  if (!SKILL_IDS.includes(id)) return 0;
  const base = getSkills(char)[id].level;
  const hasBoost = boostedSkills(certCourseIds).includes(id);
  const rust = rustLoss(getSkillsUsed(char)[id]);
  return Math.max(0, base + (hasBoost ? 1 : 0) - rust);
}
async function upsertAcademyProgress(userId, courseId, patch) {
  const now = Date.now();
  const cur = await getAcademyProgressFor(userId, courseId) || {
    lessons_done: 0, lesson_day: '', lessons_today: 0, quiz_fails: 0, quiz_cooldown_until: 0,
  };
  const next = { ...cur, ...patch, updated_at: now };
  await dbRun(
    `INSERT INTO academy_progress (user_id, course_id, lessons_done, lesson_day, lessons_today, quiz_fails, quiz_cooldown_until, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, course_id) DO UPDATE SET
       lessons_done=excluded.lessons_done, lesson_day=excluded.lesson_day,
       lessons_today=excluded.lessons_today, quiz_fails=excluded.quiz_fails,
       quiz_cooldown_until=excluded.quiz_cooldown_until, updated_at=excluded.updated_at`,
    `INSERT INTO academy_progress (user_id, course_id, lessons_done, lesson_day, lessons_today, quiz_fails, quiz_cooldown_until, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT(user_id, course_id) DO UPDATE SET
       lessons_done=excluded.lessons_done, lesson_day=excluded.lesson_day,
       lessons_today=excluded.lessons_today, quiz_fails=excluded.quiz_fails,
       quiz_cooldown_until=excluded.quiz_cooldown_until, updated_at=excluded.updated_at`,
    [userId, courseId, Number(next.lessons_done) || 0, String(next.lesson_day || ''),
     Number(next.lessons_today) || 0, Number(next.quiz_fails) || 0,
     Number(next.quiz_cooldown_until) || 0, now],
  );
}
async function awardAcademyCert(userId, courseId, now) {
  await dbRun(
    'INSERT OR IGNORE INTO academy_certs (user_id, course_id, awarded_at) VALUES (?, ?, ?)',
    'INSERT INTO academy_certs (user_id, course_id, awarded_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [userId, courseId, now],
  );
}

// ---------------- 4. INTENTS ----------------
export const INTENTS = {
  // List all 9 skills with xp/level/effective level (rust + cert applied).
  skills: async (api, msg) => {
    const { conn, send } = api;
    const c = conn.character;
    const now = api.now || Date.now();
    const skills = getSkills(c);
    const used = getSkillsUsed(c);
    const certIds = await getAcademyCerts(conn.user.id);
    send(conn, {
      t: 'skills',
      skills: SKILLS.map(s => {
        const st = skills[s.id];
        const gate = TRAIN_GATES[s.id];
        const boostCourses = certCourseIdsForSkill(s.id);
        return {
          id: s.id, name: s.name, icon: s.icon,
          xp: st.xp, level: st.level, xpNext: xpForLevel(st.level),
          effective: skillLevel(c, s.id, certIds),
          rust: rustLoss(used[s.id], now),
          certified: boostCourses.length > 0 && certIds.some(cid => boostCourses.includes(cid)),
          trainFee: gate.fee, trainAt: gate.label,
        };
      }),
    });
  },

  // Train a skill: location-gated, costs energy (+ optional small fee), grants XP.
  train: async (api, msg) => {
    const { conn, err, commit } = api;
    const now = api.now || Date.now();
    const c = conn.character;
    const skillId = String((msg && msg.skill) || '');
    const def = SKILLS.find(s => s.id === skillId);
    if (!def) { err('Pick a real skill to train.'); return; }
    const gate = TRAIN_GATES[skillId];
    const tags = locTags(c.location_id);
    if (!gate.tags.some(t => tags.includes(t))) {
      err(`${def.name} training happens at ${gate.label}. ${gate.note}`); return;
    }
    conn.cds = conn.cds || {};
    const cdKey = 'train:' + skillId;
    if (conn.cds[cdKey] && conn.cds[cdKey] > now) {
      err(`Catch your breath — train ${def.name} again soon.`); return;
    }
    if (Number(c.energy) < SKILL_TUNING.trainEnergy) { err('Too tired to train. Eat or sleep first.'); return; }
    const m12admin = isAdminConn(conn);
    if (!canAfford(c, gate.fee, m12admin)) { err(`This session costs ${naira(gate.fee)}.`); return; }
    conn.cds[cdKey] = now + SKILL_TUNING.trainCooldownSec * 1000;
    c.energy = Number(c.energy) - SKILL_TUNING.trainEnergy;
    charge(c, gate.fee, m12admin);
    const xp = Math.round(SKILL_TUNING.trainXp * xpBoostMult(c));
    const { leveledUp, level } = addSkillXp(c, skillId, xp);
    await commit({
      kind: gate.fee > 0 ? 'skill_train' : null,
      amount: gate.fee > 0 ? -gate.fee : 0,
      meta: { skill: skillId, xp },
      note: `${def.icon} ${def.name} +${xp} XP${leveledUp ? ` — LEVEL ${level}!` : ''}`,
    });
  },

  // Academy course list + per-course progress (quiz questions WITHOUT answers).
  academy_courses: async (api, msg) => {
    const { conn, send } = api;
    const now = api.now || Date.now();
    const rows = await getAcademyProgress(conn.user.id);
    const byId = new Map(rows.map(r => [r.course_id, r]));
    const certIds = new Set(await getAcademyCerts(conn.user.id));
    const today = lagosDay(now);
    send(conn, {
      t: 'academy_courses',
      courses: COURSES.map(c => {
        const p = byId.get(c.id);
        const done = p ? Number(p.lessons_done) || 0 : 0;
        const todayCount = (p && p.lesson_day === today) ? (Number(p.lessons_today) || 0) : 0;
        const certified = certIds.has(c.id);
        const quizUnlocked = done >= c.lessons && !certified;
        return {
          id: c.id, name: c.name, icon: c.icon, desc: c.desc,
          lessons: c.lessons, feePerLesson: c.feePerLesson,
          skill: c.skillBoost.skill, skillXp: c.skillBoost.xp,
          relatedJobs: c.relatedJobs,
          lessonsDone: done,
          lessonsLeftToday: Math.max(0, SKILL_TUNING.maxDailyLessons - todayCount),
          certified, quizUnlocked,
          quiz: quizUnlocked ? quizForClient(c.id) : null,
        };
      }),
    });
  },

  // Take one academy lesson: campus venue only, max 2 per real day, fee per lesson.
  academy_lesson: async (api, msg) => {
    const { conn, err, commit } = api;
    const now = api.now || Date.now();
    const c = conn.character;
    const course = COURSE_BY_ID[String((msg && msg.course) || '')];
    if (!course) { err('Pick a real course.'); return; }
    if (!locTags(c.location_id).includes('campus')) {
      err('Academy lessons happen at a campus — Unilag, Lagos Poly or Eti-Osa.'); return;
    }
    if (await hasAcademyCert(conn.user.id, course.id)) { err('You already hold this certificate.'); return; }
    const today = lagosDay(now);
    const p = await getAcademyProgressFor(conn.user.id, course.id);
    const done = p ? Number(p.lessons_done) || 0 : 0;
    if (done >= course.lessons) { err('All lessons done — take the quiz to earn your certificate.'); return; }
    const todayCount = (p && p.lesson_day === today) ? (Number(p.lessons_today) || 0) : 0;
    if (todayCount >= SKILL_TUNING.maxDailyLessons) {
      err('Two lessons a day is the max — your brain needs rest. Come back tomorrow.'); return;
    }
    const m12admin = isAdminConn(conn);
    if (!canAfford(c, course.feePerLesson, m12admin)) { err(`This lesson costs ${naira(course.feePerLesson)}.`); return; }
    charge(c, course.feePerLesson, m12admin);
    const xp = Math.round(course.skillBoost.xp * xpBoostMult(c));
    const skillDef = SKILLS.find(s => s.id === course.skillBoost.skill);
    const { leveledUp, level } = addSkillXp(c, course.skillBoost.skill, xp);
    await upsertAcademyProgress(conn.user.id, course.id, {
      lessons_done: done + 1, lesson_day: today, lessons_today: todayCount + 1,
    });
    const lessonNo = done + 1;
    await commit({
      kind: 'academy_lesson', amount: -course.feePerLesson,
      meta: { course: course.id, lesson: lessonNo, xp },
      note: lessonNo >= course.lessons
        ? `📚 Final lesson done! The ${course.name} quiz is unlocked. +${xp} ${skillDef.name} XP${leveledUp ? ` — LEVEL ${level}!` : ''}`
        : `📚 ${course.name} — lesson ${lessonNo}/${course.lessons} done. +${xp} ${skillDef.name} XP${leveledUp ? ` — LEVEL ${level}!` : ''}`,
    });
  },

  // Academy quiz: server validates answers against module data (no client trust).
  // Pass (≥2/3) → certificate + big XP chunk. Fail → 1h retry cooldown.
  academy_quiz: async (api, msg) => {
    const { conn, err, commit } = api;
    const now = api.now || Date.now();
    const c = conn.character;
    const course = COURSE_BY_ID[String((msg && msg.course) || '')];
    if (!course) { err('Pick a real course.'); return; }
    if (!locTags(c.location_id).includes('campus')) {
      err('Academy quizzes are taken at a campus.'); return;
    }
    if (await hasAcademyCert(conn.user.id, course.id)) { err('You already hold this certificate.'); return; }
    const p = await getAcademyProgressFor(conn.user.id, course.id);
    if (!p || (Number(p.lessons_done) || 0) < course.lessons) {
      err('Finish all 4 lessons first — the quiz unlocks after the last one.'); return;
    }
    if (Number(p.quiz_cooldown_until) > now) { err('Quiz on cooldown — come back in a bit.'); return; }
    const answers = msg && msg.answers;
    if (!Array.isArray(answers) || answers.length !== SKILL_TUNING.quizQuestions ||
        answers.some(a => !Number.isInteger(a) || a < 0 || a > 3)) {
      err('Answer all 3 questions honestly — no forging.'); return;
    }
    const quiz = COURSE_QUIZZES[course.id];
    let score = 0;
    for (let i = 0; i < quiz.length; i++) if (answers[i] === quiz[i].answer) score++;
    const skillDef = SKILLS.find(s => s.id === course.skillBoost.skill);
    if (score >= SKILL_TUNING.quizPassScore) {
      await awardAcademyCert(conn.user.id, course.id, now);
      const xp = Math.round(SKILL_TUNING.certXp * xpBoostMult(c));
      const { leveledUp, level } = addSkillXp(c, course.skillBoost.skill, xp);
      await commit({
        kind: 'academy_cert', amount: 0,
        meta: { course: course.id, score, xp },
        note: `🎓 CERTIFIED: ${course.name} (${score}/3)! +${xp} ${skillDef.name} XP${leveledUp ? ` — LEVEL ${level}!` : ''} This cert counts as +1 ${skillDef.name} level on career gates.`,
      });
    } else {
      await upsertAcademyProgress(conn.user.id, course.id, {
        quiz_fails: (Number(p.quiz_fails) || 0) + 1,
        quiz_cooldown_until: now + SKILL_TUNING.quizFailCooldownMs,
      });
      await commit({ note: `❌ Quiz failed (${score}/3). Read your notes and retry in an hour.` });
    }
  },
};

// ---------------- 5. Tick hooks ----------------
// Rust is computed purely from skills_used timestamps (see rustLoss) —
// training resets used_at, so rollover needs no writes. Kept so the
// coordinator can wire it per the v2 contract.
export async function onDayRollover(ctx) { /* no-op by design */ }

// ---------------- 5b. Snapshot parts (coordinator merges into `you`) ----------------
// Everything the m12 client panels need, recomputed per commit:
// skills with effective levels (rust + certs applied) and academy course
// progress (quizzes included only for unlocked courses, answers stripped).
export async function m12YouSnapshot(conn) {
  const c = conn.character;
  const now = Date.now();
  const skills = getSkills(c);
  const used = getSkillsUsed(c);
  const certIds = await getAcademyCerts(conn.user.id);
  const certSet = new Set(certIds);
  const rows = await getAcademyProgress(conn.user.id);
  const byId = new Map(rows.map(r => [r.course_id, r]));
  const today = lagosDay(now);
  return {
    skills: SKILLS.map(s => {
      const st = skills[s.id];
      const gate = TRAIN_GATES[s.id];
      const boostCourses = certCourseIdsForSkill(s.id);
      return {
        id: s.id, name: s.name, icon: s.icon,
        xp: st.xp, level: st.level, xpNext: xpForLevel(st.level),
        effective: skillLevel(c, s.id, certIds),
        rust: rustLoss(used[s.id], now),
        certified: boostCourses.length > 0 && certIds.some(cid => boostCourses.includes(cid)),
        trainFee: gate.fee, trainAt: gate.label,
      };
    }),
    academy: COURSES.map(cc => {
      const p = byId.get(cc.id);
      const done = p ? Number(p.lessons_done) || 0 : 0;
      const todayCount = (p && p.lesson_day === today) ? (Number(p.lessons_today) || 0) : 0;
      const certified = certSet.has(cc.id);
      const quizUnlocked = done >= cc.lessons && !certified;
      return {
        id: cc.id, name: cc.name, icon: cc.icon, desc: cc.desc,
        lessons: cc.lessons, feePerLesson: cc.feePerLesson,
        skill: cc.skillBoost.skill, skillXp: cc.skillBoost.xp,
        relatedJobs: cc.relatedJobs,
        lessonsDone: done,
        lessonsLeftToday: Math.max(0, SKILL_TUNING.maxDailyLessons - todayCount),
        certified, quizUnlocked,
        quiz: quizUnlocked ? quizForClient(cc.id) : null,
      };
    }),
  };
}

// ---------------- 6. Config data (coordinator merges into GET /api/config) ----------------
export const CONFIG_DATA = {
  skills: SKILLS,
  skillTuning: {
    xpStep: SKILL_TUNING.xpStep,
    trainXp: SKILL_TUNING.trainXp,
    trainEnergy: SKILL_TUNING.trainEnergy,
    lessonXp: SKILL_TUNING.lessonXp,
    certXp: SKILL_TUNING.certXp,
    maxDailyLessons: SKILL_TUNING.maxDailyLessons,
    quizPassScore: SKILL_TUNING.quizPassScore,
  },
  trainGates: Object.fromEntries(
    Object.entries(TRAIN_GATES).map(([k, g]) => [k, { tags: g.tags, label: g.label, fee: g.fee, note: g.note }]),
  ),
  academyCourses: COURSES.map(c => ({
    id: c.id, name: c.name, icon: c.icon, desc: c.desc,
    lessons: c.lessons, feePerLesson: c.feePerLesson,
    skill: c.skillBoost.skill, skillXp: c.skillBoost.xp, relatedJobs: c.relatedJobs,
  })),
};
