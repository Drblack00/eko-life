// ============================================================
// game/careers.js — P3: 27-career ladder system with ranks,
// promotion rules, weekly schedules, auto-start, and an ORIGINAL
// shift mini-game ("work events").
//
// Relationship to M7 (game/v2/m7.js): this module EXTENDS the
// 1-hour shift engine, it does not replace it. Each career rank
// registers a shift role via m7.registerShiftRole(), so clock-in,
// gates (location / cert / skill), forfeit rules and base-pay
// settlement all run through the existing, tested shift pipeline.
// P3 adds: the career ladder, promotion eligibility, schedules +
// day-off enforcement (via m7.registerDayOffCheck), performance
// bonuses, the event mini-game, and per-minute tick work that runs
// BEFORE m7's own tick settles base pay.
//
// All names, copy, events and mechanics here are ORIGINAL — written
// for Èkó Life from the audit's mechanical description only.
// ============================================================
import { dbRun, getCharacter, listCharacters, addTransaction } from '../db.js';
import {
  registerShiftRole, registerDayOffCheck,
  calcShiftPay, classPayMult, readWageMult, workPayPerkPct,
  skillLevelOf, SHIFT_MS,
} from './v2/m7.js';

const naira = (n) => '₦' + Number(n).toLocaleString('en-NG');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------
// 1. Lagos wall-time helpers (Africa/Lagos, no dependency on
//    the game-day clock — shifts follow real office hours).
// ------------------------------------------------------------
const LAGOS_TZ = 'Africa/Lagos';

export function lagosParts(ts = Date.now()) {
  const d = new Date(Number(ts));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LAGOS_TZ, weekday: 'short', hour: 'numeric', minute: '2-digit',
    hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: wdMap[parts.weekday] ?? 0,
    hour: Number(parts.hour) % 24,
    dateStr: `${parts.year}-${parts.month}-${parts.day}`, // YYYY-MM-DD
  };
}

export function lagosDateStr(ts = Date.now()) {
  return lagosParts(ts).dateStr;
}

// ------------------------------------------------------------
// 2. Career data — 27 original careers.
//
// Career shape:
//   { id, name, path, icon, blurb, locationId, energyCost,
//     skillLock?: { skill, level }, certRequired?,
//     schedule: { days: [0..6, Sun..Sat], start, end },  // Lagos hours
//     ranks: [ { title, payPerShift, minShifts } × 5 ] }
// `minShifts` = completed shifts required AT that rank (plus a
// 100%-performance final shift) before promotion unlocks.
// Pay spans the ₦8,600–₦18,300/shift band across all careers.
// ------------------------------------------------------------
function ranks(titles, pay0, pay4, minShifts = [3, 4, 5, 6]) {
  return titles.map((title, i) => ({
    title,
    payPerShift: Math.round(pay0 + ((pay4 - pay0) * i) / 4),
    minShifts: minShifts[Math.min(i, minShifts.length - 1)],
  }));
}
const MF = [1, 2, 3, 4, 5]; // Mon–Fri office pattern

export const CAREERS = [
  {
    id: 'software', name: 'Software Engineering', path: 'tech', icon: '💻',
    blurb: 'Ship code from a Yaba tech hub — standups, sprints, and production deploys.',
    locationId: 'sangotedo_tech', energyCost: 30, skillLock: { skill: 'coding', level: 2 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['Code Intern', 'Junior Developer', 'Mid-Level Engineer', 'Senior Engineer', 'Engineering Lead'], 9800, 14200),
  },
  {
    id: 'product', name: 'Product Management', path: 'product', icon: '📊',
    blurb: 'Roadmaps and stakeholder wahala at a Lagos fintech — ship or sink.',
    locationId: 'yaba_hub', energyCost: 35, skillLock: { skill: 'coding', level: 3 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['Associate PM', 'Product Analyst', 'Product Manager', 'Senior PM', 'Head of Product'], 11600, 17400),
  },
  {
    id: 'data', name: 'Data Science', path: 'tech', icon: '📈',
    blurb: 'Turn raw market data into dashboards the MD actually reads.',
    locationId: 'ikoyi', energyCost: 30, skillLock: { skill: 'coding', level: 2 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['Data Intern', 'Junior Analyst', 'Data Scientist', 'Senior Scientist', 'Chief Data Officer'], 10400, 15800),
  },
  {
    id: 'cyber', name: 'Cybersecurity', path: 'tech', icon: '🛡️',
    blurb: 'Guard the vault — SOC nights, threat hunts, and zero-day fire drills.',
    locationId: 'chevron_drive', energyCost: 35, skillLock: { skill: 'coding', level: 3 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['SOC Trainee', 'Security Analyst', 'Penetration Tester', 'Security Architect', 'CISO'], 12000, 17800),
  },
  {
    id: 'medicine', name: 'Medicine', path: 'medicine', icon: '🩺',
    blurb: 'Ward rounds and night calls — the most respected coat in the city.',
    locationId: 'lasuth', energyCost: 35, skillLock: { skill: 'fitness', level: 3 },
    schedule: { days: [1, 2, 3, 4, 5], start: 8, end: 20 },
    ranks: ranks(['House Officer', 'Medical Officer', 'Registrar', 'Senior Registrar', 'Consultant'], 12600, 18300),
  },
  {
    id: 'nursing', name: 'Nursing', path: 'medicine', icon: '💉',
    blurb: 'The wards run on nurses — steady hands, sharp eyes, calm under fire.',
    locationId: 'victoria_hospital', energyCost: 35, skillLock: { skill: 'fitness', level: 2 },
    schedule: { days: [1, 2, 3, 4, 5], start: 8, end: 20 },
    ranks: ranks(['Student Nurse', 'Staff Nurse', 'Senior Nurse', 'Assistant Matron', 'Chief Matron'], 10200, 15000),
  },
  {
    id: 'pharmacy', name: 'Pharmacy', path: 'medicine', icon: '💊',
    blurb: 'Dispense with precision — every dosage signed, every shelf audited.',
    locationId: 'lasuth', energyCost: 30, skillLock: { skill: 'fitness', level: 2 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['Pharmacy Intern', 'Dispensary Officer', 'Pharmacist', 'Senior Pharmacist', 'Chief Pharmacist'], 10800, 15600),
  },
  {
    id: 'banking', name: 'Banking', path: 'banking', icon: '🏦',
    blurb: 'Tellers to branch managers — count it twice, smile always.',
    locationId: 'kudi_row', energyCost: 35, skillLock: { skill: 'charisma', level: 2 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['Teller Trainee', 'Customer Service Officer', 'Relationship Officer', 'Branch Manager', 'Regional Director'], 10100, 15200),
  },
  {
    id: 'insurance', name: 'Insurance', path: 'banking', icon: '📋',
    blurb: 'Policies, premiums and payouts — sell peace of mind by the folder.',
    locationId: 'ikoyi', energyCost: 30, skillLock: { skill: 'charisma', level: 2 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['Sales Intern', 'Underwriting Assistant', 'Underwriter', 'Claims Manager', 'Head of Underwriting'], 9400, 13800),
  },
  {
    id: 'fintech_sales', name: 'Fintech Sales', path: 'banking', icon: '🤝',
    blurb: 'POS terminals and merchant onboarding — targets are weekly, hunger is daily.',
    locationId: 'yaba_hub', energyCost: 35, skillLock: { skill: 'hustle', level: 2 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['Field Agent', 'Sales Executive', 'Senior Executive', 'Team Lead', 'Head of Sales'], 9000, 14400),
  },
  {
    id: 'refining', name: 'Oil Refining', path: 'refining', icon: '🛢️',
    blurb: 'The plant never sleeps — pressure gauges, safety drills, shift handover.',
    locationId: 'apapa_wharf', energyCost: 35, skillLock: { skill: 'fitness', level: 2 },
    schedule: { days: [1, 2, 3, 4, 5], start: 7, end: 19 },
    ranks: ranks(['Operator Trainee', 'Plant Operator', 'Shift Supervisor', 'Process Engineer', 'Plant Manager'], 12200, 18000),
  },
  {
    id: 'media', name: 'Media Broadcasting', path: 'media', icon: '📺',
    blurb: 'Live mics and breaking news — the city watches you every evening.',
    locationId: 'oniru_strip', energyCost: 30, skillLock: { skill: 'charisma', level: 2 },
    schedule: { days: [2, 3, 4, 5, 6], start: 10, end: 22 },
    ranks: ranks(['Production Intern', 'Assistant Producer', 'Presenter', 'Senior Producer', 'Station Manager'], 9600, 14800),
  },
  {
    id: 'film', name: 'Nollywood Film', path: 'media', icon: '🎬',
    blurb: 'From set runner to director — the industry moves fast, shoot faster.',
    locationId: 'ikate_night', energyCost: 35, skillLock: { skill: 'comedy', level: 2 },
    schedule: { days: [1, 2, 3, 4, 5], start: 8, end: 20 },
    ranks: ranks(['Set Runner', 'Continuity Assistant', 'Assistant Director', 'Director', 'Executive Producer'], 9200, 14000),
  },
  {
    id: 'music', name: 'Music Performance', path: 'media', icon: '🎤',
    blurb: 'Studio sessions and owambe stages — the grind before the blow.',
    locationId: 'club_kasanova', energyCost: 30, skillLock: { skill: 'music', level: 2 },
    schedule: { days: [4, 5, 6, 0, 1], start: 16, end: 23 },
    ranks: ranks(['Backup Singer', 'Session Artiste', 'Recording Artiste', 'Headliner', 'Label Boss'], 8800, 13600),
  },
  {
    id: 'journalism', name: 'Journalism', path: 'media', icon: '📰',
    blurb: 'Chase the story, beat the deadline — print never truly dies.',
    locationId: 'dopemu_plaza', energyCost: 30, skillLock: { skill: 'charisma', level: 2 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['Stringer', 'Staff Writer', 'Correspondent', 'Senior Editor', 'Editor-in-Chief'], 8600, 12800),
  },
  {
    id: 'realestate', name: 'Real Estate', path: 'corporate', icon: '🏘️',
    blurb: 'Close duplex deals on the Island — commission is a mindset.',
    locationId: 'ikoyi', energyCost: 30, skillLock: { skill: 'charisma', level: 3 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['Listing Agent', 'Sales Associate', 'Senior Agent', 'Broker', 'Agency Principal'], 10600, 16400),
  },
  {
    id: 'civil', name: 'Civil Service', path: 'corporate', icon: '🏛️',
    blurb: 'The secretariat runs on files and patience — steady pay, steady climb.',
    locationId: 'cms_marina', energyCost: 25, certRequired: true,
    schedule: { days: MF, start: 8, end: 16 },
    ranks: ranks(['Clerical Officer', 'Admin Officer', 'Principal Officer', 'Assistant Director', 'Permanent Secretary'], 8800, 12600),
  },
  {
    id: 'teaching', name: 'Teaching', path: 'campus', icon: '📚',
    blurb: 'Mould the next generation — lesson notes, assembly, and PTA wahala.',
    locationId: 'unilag', energyCost: 30, certRequired: true,
    schedule: { days: MF, start: 8, end: 16 },
    ranks: ranks(['Teaching Assistant', 'Class Teacher', 'Senior Teacher', 'Vice Principal', 'Principal'], 8600, 12200),
  },
  {
    id: 'law', name: 'Law', path: 'corporate', icon: '⚖️',
    blurb: 'Wigs, briefs and billable hours — argue your way to the top.',
    locationId: 'marina_court', energyCost: 35, certRequired: true, skillLock: { skill: 'charisma', level: 2 },
    schedule: { days: MF, start: 9, end: 17 },
    ranks: ranks(['Pupil Counsel', 'Associate Counsel', 'Senior Associate', 'Partner Track', 'Senior Partner'], 11000, 17000),
  },
  {
    id: 'aviation', name: 'Aviation', path: 'service', icon: '✈️',
    blurb: 'Crew life — safety demos at dawn, layovers by night.',
    locationId: 'oshodi', energyCost: 35, skillLock: { skill: 'fitness', level: 2 },
    schedule: { days: [1, 2, 3, 4, 5], start: 6, end: 18 },
    ranks: ranks(['Ground Trainee', 'Cabin Crew', 'Senior Crew', 'Purser', 'Fleet Manager'], 11400, 17200),
  },
  {
    id: 'logistics', name: 'Logistics', path: 'transport', icon: '📦',
    blurb: 'Parcels across the city — beat the traffic, beat the clock.',
    locationId: 'ojota_park', energyCost: 35, skillLock: { skill: 'hustle', level: 2 },
    schedule: { days: [1, 2, 3, 4, 5], start: 7, end: 19 },
    ranks: ranks(['Load Hand', 'Dispatch Rider', 'Route Supervisor', 'Fleet Coordinator', 'Logistics Manager'], 8800, 13200),
  },
  {
    id: 'hospitality', name: 'Hospitality', path: 'service', icon: '🛎️',
    blurb: 'Five-star smiles — the guest is always right, even at 2am.',
    locationId: 'oniru_strip', energyCost: 30, skillLock: { skill: 'charisma', level: 2 },
    schedule: { days: [3, 4, 5, 6, 0], start: 8, end: 20 },
    ranks: ranks(['Bell Attendant', 'Front Desk Officer', 'Guest Relations', 'Duty Manager', 'General Manager'], 8600, 12400),
  },
  {
    id: 'fashion', name: 'Fashion Design', path: 'creative', icon: '👗',
    blurb: 'Aso-ebi season never ends — sketch it, sew it, slay it.',
    locationId: 'ikota_complex', energyCost: 30, skillLock: { skill: 'hustle', level: 2 },
    schedule: { days: [2, 3, 4, 5, 6], start: 10, end: 20 },
    ranks: ranks(['Tailor Apprentice', 'Junior Designer', 'Designer', 'Creative Lead', 'Fashion House Owner'], 9000, 13400),
  },
  {
    id: 'construction', name: 'Construction', path: 'construction', icon: '🏗️',
    blurb: 'Raise the skyline — concrete, cranes, and site-meeting diplomacy.',
    locationId: 'eko_atlantic', energyCost: 35, skillLock: { skill: 'fitness', level: 3 },
    schedule: { days: [1, 2, 3, 4, 5], start: 7, end: 17 },
    ranks: ranks(['Site Labourer', 'Mason Assistant', 'Site Foreman', 'Project Engineer', 'Site Director'], 10000, 15400),
  },
  {
    id: 'telecom', name: 'Telecom Field Ops', path: 'tech', icon: '📡',
    blurb: 'Keep the towers alive — climb, configure, restore signal.',
    locationId: 'osapa_junction', energyCost: 35, skillLock: { skill: 'fitness', level: 2 },
    schedule: { days: [1, 2, 3, 4, 5], start: 8, end: 18 },
    ranks: ranks(['Field Assistant', 'Tower Technician', 'NOC Analyst', 'Field Supervisor', 'Regional Field Manager'], 9800, 14600),
  },
  {
    id: 'agriculture', name: 'Agribusiness', path: 'market', icon: '🌱',
    blurb: 'From farm gate to market stall — the green economy pays.',
    locationId: 'ogba_market', energyCost: 30, skillLock: { skill: 'hustle', level: 2 },
    schedule: { days: [1, 2, 3, 4, 5], start: 6, end: 16 },
    ranks: ranks(['Farm Hand', 'Crop Supervisor', 'Farm Manager', 'Agro Processor', 'Agro Baron'], 8600, 12800),
  },
  {
    id: 'sports', name: 'Sports Coaching', path: 'service', icon: '⚽',
    blurb: 'Build the next street champion — drills at dawn, trophies later.',
    locationId: 'ajegunle_arena', energyCost: 35, skillLock: { skill: 'fitness', level: 3 },
    schedule: { days: [2, 3, 4, 5, 6], start: 7, end: 19 },
    ranks: ranks(['Trainee Coach', 'Youth Coach', 'First-Team Coach', 'Head Coach', 'Technical Director'], 9400, 14200),
  },
];

const CAREER_INDEX = new Map(CAREERS.map((c) => [c.id, c]));
export function careerById(id) {
  return CAREER_INDEX.get(String(id)) || null;
}

// Rank → shift-role id. Registered into the M7 shift engine below.
export function shiftRoleId(careerId, rank) {
  return `p3_${careerId}_r${clamp(Math.floor(Number(rank) || 0), 0, 4)}`;
}
const CAREER_ROLE_IDS = new Set();
for (const career of CAREERS) {
  for (let r = 0; r < 5; r++) CAREER_ROLE_IDS.add(shiftRoleId(career.id, r));
}
export function isCareerRoleId(id) {
  return CAREER_ROLE_IDS.has(String(id));
}
export function careerOfRoleId(roleId) {
  const m = /^p3_(.+)_[rR](\d)$/.exec(String(roleId));
  if (!m || !isCareerRoleId(roleId)) return null;
  const career = careerById(m[1]);
  return career ? { career, rank: Number(m[2]) } : null;
}

// Register every rank as a first-class M7 shift role: clock-in gates,
// 1-hour timing, forfeit rules and base-pay settlement all reuse the
// existing pipeline. `careerId` marks the role for the day-off check.
// Senior ranks (3+) demand one extra skill level — the ladder gets
// steeper as it gets taller.
for (const career of CAREERS) {
  for (let r = 0; r < 5; r++) {
    const rankDef = career.ranks[r];
    const lock = career.skillLock;
    registerShiftRole({
      id: shiftRoleId(career.id, r),
      trackId: `p3_${career.id}`,
      name: `${rankDef.title} · ${career.name}`,
      locationId: career.locationId,
      payPerShift: rankDef.payPerShift,
      energyCost: career.energyCost,
      icon: career.icon,
      careerId: career.id,
      certRequired: !!career.certRequired,
      skillGate: lock ? { skill: lock.skill, level: lock.level + (r >= 3 ? 1 : 0) } : undefined,
    });
  }
}

// Day-off enforcement: office careers rest on weekends; shift-pattern
// careers rest on their own off-days. The M7 shift_start intent calls
// this through the registered predicate — one original rule, no fork.
registerDayOffCheck((role, nowMs) => {
  if (!role || !role.careerId) return null;
  const career = careerById(role.careerId);
  if (!career) return null;
  if (isWorkDay(career, nowMs)) return null;
  return `Day off — ${career.name} resumes on ${nextWorkDayLabel(career, nowMs)}.`;
});

export function isWorkDay(career, ts = Date.now()) {
  return career.schedule.days.includes(lagosParts(ts).weekday);
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function nextWorkDayLabel(career, ts) {
  for (let i = 1; i <= 7; i++) {
    const wd = lagosParts(Number(ts) + i * 86400000).weekday;
    if (career.schedule.days.includes(wd)) return DAY_SHORT[wd];
  }
  return 'a workday';
}

export function scheduleStrip(career) {
  // Mon-first strip for the UI: [{ day: 'Mon', work: true }, …]
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((wd) => ({ day: DAY_SHORT[wd], work: career.schedule.days.includes(wd) }));
}

export function scheduleLabel(career) {
  const s = career.schedule;
  const days = s.days.length === 5 && MF.every((d) => s.days.includes(d))
    ? 'Mon–Fri'
    : scheduleStrip(career).filter((d) => d.work).map((d) => d.day).join(' ');
  return `${days} · ${s.start}:00–${s.end}:00`;
}

// ------------------------------------------------------------
// 3. Shift mini-game — "work events" (ORIGINAL design).
//
// DESIGN (documented here because the reference's mini-game was
// not observable — this is our own):
//   While a shift is live, the per-minute tick may push ONE pending
//   "work event" to the player (max 4 per shift, ~35%/min when no
//   event is pending). Each event is a small workplace dilemma with
//   2–3 response choices and a 5-minute response window.
//   - Fast, good answers: +8 to +15 performance.
//   - Poor answers: −8. Ignoring an event until the window closes: −10.
//   - Performance starts at 50 each shift, clamped 0–100.
//   - End-of-shift performance sets the pay bonus (see §4) and — at
//     exactly 100% with enough shifts at the rank — promotion.
//   Events come from a GENERIC pool (every workplace has NEPA
//   wahala) plus 2–3 path-specific events per career path, so a
//   nurse's shift feels different from a dispatch rider's.
//   Event choice effects are server-side only: the client receives
//   { id, title, flavor, choices: [{id,label}], expiresAt } —
//   NEVER the deltas. Responses go through career_respond /
//   POST /careers/respond, validated against the stored event.
// ------------------------------------------------------------
export const EVENT_WINDOW_MS = 5 * 60 * 1000;
export const EVENT_TIMEOUT_DELTA = -10;
export const MAX_EVENTS_PER_SHIFT = 4;
export const EVENT_SPAWN_PCT_PER_MIN = 0.35;
export const PERF_BASELINE = 50;

function ev(id, title, flavor, choices) {
  return { id, title, flavor, windowSec: EVENT_WINDOW_MS / 1000, choices };
}
function ch(id, label, delta) {
  return { id, label, delta };
}

// Generic workplace events — every Lagos workplace knows these.
const GENERIC_EVENTS = [
  ev('gen_outage', 'NEPA took light!',
    'The mains just died mid-task and the generator is coughing. Everyone is looking at you.',
    [ch('gen_fix', 'Kick-start the generator yourself', 15),
     ch('gen_wait', 'Wait for the technician like everyone else', 8),
     ch('gen_panic', 'Complain loudly about PHCN instead', -8)]),
  ev('rude_customer', 'Difficult customer',
    'A customer is raising their voice at the front desk and your supervisor is "in a meeting".',
    [ch('calm', 'Step in calmly and de-escalate', 15),
     ch('script', 'Recite policy and hold the line', 8),
     ch('snap', 'Match their energy', -8)]),
  ev('surprise_inspection', 'Surprise inspection!',
    'An inspector just walked in unannounced, clipboard in hand, straight for your station.',
    [ch('tidy', 'Your station is already spotless — walk them through it', 15),
     ch('stall', 'Offer them a seat and water while you tidy up', 8),
     ch('hide', 'Suddenly remember an urgent errand elsewhere', -8)]),
  ev('deadline_crunch', 'Deadline moved up!',
    'The boss just moved the deadline to end of shift. The team chat is in flames.',
    [ch('prioritize', 'Cut scope to the essentials and grind', 15),
     ch('steady', 'Keep your pace — quality over panic', 8),
     ch('gossip', 'Join the group chat to discuss how unfair this is', -8)]),
  ev('teammate_stuck', 'Teammate is stuck',
    'The new hire is drowning on a task you could finish in ten minutes — but your own queue is full.',
    [ch('mentor', 'Pause and unblock them properly', 15),
     ch('hint', 'Drop a quick hint and get back to work', 8),
     ch('ignore', 'Not your problem — headphones on', -8)]),
  ev('system_outage', 'System don hang!',
    'The core system froze with a queue of work behind it. IT says "we are looking into it".',
    [ch('manual', 'Switch to the manual workaround and keep moving', 15),
     ch('reboot', 'Try the classic: restart everything, carefully', 8),
     ch('idle', 'Fold your arms and wait for IT', -8)]),
  ev('vip_visit', 'Oga at the top is here',
    'The big boss just arrived for an unscheduled walk-through of your unit.',
    [ch('shine', 'Present your current work confidently', 15),
     ch('blend', 'Keep your head down and look busy', 8),
     ch('vanish', 'Take a strategic bathroom break', -8)]),
  ev('lost_item', 'Something is missing',
    'A critical item for your task has vanished. The shift log blames "unknown".',
    [ch('search', 'Retrace steps and find it fast', 15),
     ch('improvise', 'Improvise a replacement and report it', 8),
     ch('blame', 'Start asking around who touched it last', -8)]),
];

// Path-specific events.
const PATH_EVENTS = {
  tech: [
    ev('prod_bug', '🐞 Production is down!',
      'Error rates just spiked on the live dashboard. Customers are noticing.',
      [ch('rollback', 'Roll back the last deploy immediately', 15),
       ch('hotfix', 'Push a hotfix straight to main', 8),
       ch('blame_qa', 'Ask QA why they did not catch it', -8)]),
    ev('client_demo', '📺 Client wants a demo NOW',
      'The biggest client is on the call asking to "just see the new feature" — it is half-built.',
      [ch('demo_core', 'Demo the working core, park the rest', 15),
       ch('screenshare', 'Share designs and talk through the vision', 8),
       ch('stall_demo', 'Claim your network is bad', -8)]),
    ev('deploy_freeze', 'Deploy freeze announced',
      'Leadership froze all deploys 10 minutes before your release window.',
      [ch('doc', 'Use the window to write the runbook properly', 15),
       ch('sneak', 'Try to slip the deploy through anyway', -8),
       ch('slack_off', 'Take the freeze as a sign to relax', 8)]),
  ],
  product: [
    ev('roadmap_fight', 'Roadmap showdown',
      'Two directors are fighting over your roadmap in the meeting you are presenting.',
      [ch('data', 'Settle it with the user data you prepared', 15),
       ch('compromise', 'Propose a split: both get a slice', 8),
       ch('silent', 'Stay quiet and let them fight it out', -8)]),
    ev('metrics_drop', 'Metrics just dipped',
      'Activation dropped 12% overnight and the alert is already in the exec channel.',
      [ch('dig', 'Pull the funnel and find the leak', 15),
       ch('survey', 'Send a quick user survey first', 8),
       ch('seasonal', 'Call it seasonal and move on', -8)]),
    ev('stakeholder_ask', 'Exec wants a number',
      'The CFO wants the revenue impact of your feature "by end of day" — you have rough notes.',
      [ch('model', 'Build the quick model and caveat the assumptions', 15),
       ch('range', 'Give an honest range with workings', 8),
       ch('guess', 'Give one confident-sounding number', -8)]),
  ],
  medicine: [
    ev('emergency_case', '🚨 Emergency wheeled in!',
      'A critical case just arrived at your ward. The team is assembling.',
      [ch('lead', 'Take charge of triage protocol', 15),
       ch('assist', 'Support the senior on call', 8),
       ch('chart', 'Focus on updating charts instead', -8)]),
    ev('drug_shortage', 'Drug stock is low',
      'A key medication is almost out and the supplier truck is stuck in traffic.',
      [ch('ration', 'Prioritise the critical patients, escalate supply', 15),
       ch('substitute', 'Switch to the approved alternative', 8),
       ch('wait_stock', 'Wait for the truck — nothing to do', -8)]),
    ev('night_rounds', 'Consultant doing rounds',
      'The consultant is on the ward asking juniors rapid-fire questions.',
      [ch('answer', 'Answer from your morning prep', 15),
       ch('honest', 'Admit what you do not know, offer to check', 8),
       ch('dodge', 'Let someone else answer first', -8)]),
  ],
  banking: [
    ev('cash_shortage', 'Vault cash running low',
      'The queue is long and the vault is nearly empty. The bullion van is late.',
      [ch('ration_cash', 'Serve small withdrawals, reassure the queue', 15),
       ch('escalate', 'Escalate to the branch manager early', 8),
       ch('close_early', 'Quietly slow down service', -8)]),
    ev('fraud_alert', 'Fraud alert on an account',
      'A high-value account just flagged for suspicious transfers. The customer is in the banking hall.',
      [ch('verify', 'Run full verification before any action', 15),
       ch('hold', 'Place a temporary hold and investigate', 8),
       ch('ignore_flag', 'Clear the flag — the customer looks legit', -8)]),
    ev('long_queue', 'Queue out the door',
      'Salary week: the hall is packed and tempers are rising.',
      [ch('triage', 'Open a second counter and triage the queue', 15),
       ch('apologize', 'Address the queue, set expectations', 8),
       ch('hide_back', 'Stay at your desk and work slower', -8)]),
  ],
  refining: [
    ev('pressure_spike', 'Pressure gauge spiking!',
      'A vessel pressure reading is climbing past the safe band.',
      [ch('shutdown', 'Initiate controlled shutdown of the unit', 15),
       ch('vent', 'Open the relief valve per procedure', 8),
       ch('watch', 'Watch it for a few more minutes', -8)]),
    ev('safety_drill', 'Unannounced safety drill',
      'The alarm just sounded — this is a drill, but the assessors are scoring.',
      [ch('muster', 'Lead your crew to the muster point by the book', 15),
       ch('follow', 'Follow the drill procedure calmly', 8),
       ch('phone', 'Finish your phone chat first', -8)]),
    ev('pipeline_leak', 'Suspected pipeline leak',
      'A faint smell near the manifold — could be nothing, could be everything.',
      [ch('report', 'Report immediately and isolate the section', 15),
       ch('inspect', 'Inspect with a buddy before raising alarm', 8),
       ch('sniff', 'Decide it is probably nothing', -8)]),
  ],
  media: [
    ev('live_mic', 'You are LIVE in 30 seconds',
      'The guest cancelled and the producer is pointing at YOU to fill the segment.',
      [ch('adlib', 'Go on air and own the segment', 15),
       ch('recap', 'Do a tight recap of today\'s headlines', 8),
       ch('freeze', 'Panic visibly on camera', -8)]),
    ev('breaking_news', 'Breaking news just dropped',
      'A major story broke mid-bulletin and the rundown is now wrong.',
      [ch('pivot', 'Pivot the bulletin cleanly to the breaking story', 15),
       ch('tease', 'Tease it and promise details after the break', 8),
       ch('old_script', 'Read the old script and hope nobody notices', -8)]),
    ev('diva_guest', 'Difficult guest',
      'The celebrity guest is refusing the agreed questions, live.',
      [ch('charm', 'Charm them into the flow of the interview', 15),
       ch('improvise_q', 'Improvise safe questions they will enjoy', 8),
       ch('argue', 'Argue with them on air', -8)]),
  ],
  corporate: [
    ev('board_deck', 'Board wants your deck',
      'Your slides are due to the board in one hour and the numbers do not foot.',
      [ch('rebuild', 'Rebuild the key slides from source data', 15),
       ch('footnote', 'Ship it with clear caveats footnoted', 8),
       ch('fudge', 'Smooth the numbers so they foot', -8)]),
    ev('audit_knock', 'Auditors arrived',
      'External auditors are asking for your files — now.',
      [ch('ready', 'Hand over the well-kept files', 15),
       ch('gather', 'Gather everything quickly and stay helpful', 8),
       ch('delay', 'Say the files are "with another department"', -8)]),
    ev('office_politics', 'Meeting ambush',
      'A colleague just threw your project under the bus in a big meeting.',
      [ch('facts', 'Respond with calm facts and receipts', 15),
       ch('defer', 'Defer: "let\'s take the details offline"', 8),
       ch('clapback', 'Clap back publicly', -8)]),
  ],
  campus: [
    ev('rowdy_class', 'Class is getting rowdy',
      'The back row has started a full gist session during your lesson.',
      [ch('engage', 'Turn the gist into a class discussion', 15),
       ch('firm', 'Reset the room firmly but warmly', 8),
       ch('shout', 'Shout over them until they stop', -8)]),
    ev('inspection_day', 'Ministry inspectors',
      'Inspectors are walking the corridors checking lesson notes.',
      [ch('notes', 'Your notes are current — present them proudly', 15),
       ch('polish', 'Quickly update today\'s entry', 8),
       ch('absent', 'Slip out for "an urgent call"', -8)]),
  ],
  service: [
    ev('double_booking', 'Double booking!',
      'Two guests were assigned the same room/seat and both just arrived.',
      [ch('upgrade', 'Upgrade one party and own the mistake', 15),
       ch('split', 'Find an equivalent alternative fast', 8),
       ch('argue_guest', 'Let them argue it out', -8)]),
    ev('complaint_escalation', 'Complaint going viral',
      'An angry guest is filming and threatening to post it.',
      [ch('resolve', 'Resolve it on the spot, generously', 15),
       ch('manager', 'Bring the duty manager immediately', 8),
       ch('film_back', 'Film them back', -8)]),
  ],
  transport: [
    ev('traffic_lockdown', 'Total standstill',
      'Third Mainland is locked. Your passengers are watching the clock.',
      [ch('reroute', 'Reroute through the back streets you know', 15),
       ch('update', 'Keep passengers updated honestly', 8),
       ch('nap', 'Switch off and wait it out', -8)]),
    ev('vehicle_fault', 'Strange noise from the engine',
      'Something is knocking under the bonnet mid-route.',
      [ch('stop_safe', 'Pull over safely and inspect', 15),
       ch('limp', 'Drive gently to the nearest mechanic', 8),
       ch('blast_music', 'Turn up the music to drown it out', -8)]),
  ],
  market: [
    ev('price_crash', 'Prices just crashed',
      'The wholesale price of your main line dropped 20% overnight.',
      [ch('buy_dip', 'Buy the dip and sell volume', 15),
       ch('hold', 'Hold stock and wait for rebound', 8),
       ch('panic_sell', 'Dump everything at a loss', -8)]),
    ev('supply_delay', 'Supplier delayed',
      'Your supplier\'s truck broke down — shelves will be empty by noon.',
      [ch('alt_source', 'Call your backup supplier now', 15),
       ch('ration_stock', 'Ration stock and tell customers', 8),
       ch('close_shop', 'Close early "for stocktaking"', -8)]),
  ],
  creative: [
    ev('client_revision', 'Client wants "small" changes',
      'The "final" design is back with seventeen "small" changes.',
      [ch('batch', 'Batch the changes and turn them fast', 15),
       ch('scope', 'Negotiate scope politely, then execute', 8),
       ch('sigh', 'Sigh audibly and do the bare minimum', -8)]),
    ev('inspiration_block', 'Blank page syndrome',
      'The brief is due and your mind is completely empty.',
      [ch('research', 'Do a rapid reference dive', 15),
       ch('sketch', 'Sketch ten bad ideas fast', 8),
       ch('scroll', 'Scroll socials "for inspiration"', -8)]),
  ],
  construction: [
    ev('material_shortage', 'Cement didn\'t arrive',
      'The mixer is scheduled and the cement truck is nowhere.',
      [ch('reschedule', 'Resequence the day\'s work smartly', 15),
       ch('borrow', 'Borrow from the neighbouring site', 8),
       ch('idle_crew', 'Let the crew idle till it comes', -8)]),
    ev('safety_violation', 'Worker without helmet',
      'You spot a labourer working at height with no harness.',
      [ch('stop_work', 'Stop work, enforce PPE, log it', 15),
       ch('warn', 'Warn them and move on', 8),
       ch('look_away', 'Pretend you didn\'t see', -8)]),
  ],
};

const PATH_POOLS = {};
for (const [path, list] of Object.entries(PATH_EVENTS)) PATH_POOLS[path] = list;

// Public (client-safe) projection of an event — deltas stay server-side.
export function publicEvent(stored) {
  return {
    id: stored.id,
    title: stored.title,
    flavor: stored.flavor,
    choices: stored.choices.map((c) => ({ id: c.id, label: c.label })),
    expiresAt: stored.expiresAt,
  };
}

export function pickEvent(path, seenCount, rand = Math.random) {
  const pool = [...GENERIC_EVENTS, ...(PATH_POOLS[path] || [])];
  const evDef = pool[Math.floor(rand() * pool.length) % pool.length];
  return evDef;
}

export function buildStoredEvent(evDef, now) {
  return {
    id: `${evDef.id}_${now}`,
    defId: evDef.id,
    title: evDef.title,
    flavor: evDef.flavor,
    choices: evDef.choices.map((c) => ({ id: c.id, label: c.label, delta: c.delta })),
    emittedAt: now,
    expiresAt: now + evDef.windowSec * 1000,
  };
}

export function applyEventDelta(perf, delta, bonusMult = 0) {
  const p = Number(perf);
  const base = Number.isFinite(p) ? p : PERF_BASELINE;
  const d = Number(delta) || 0;
  const scaled = d > 0 ? d * (1 + Math.max(0, Number(bonusMult) || 0)) : d;
  return clamp(Math.round(base + scaled), 0, 100);
}

// ------------------------------------------------------------
// 4. Performance → pay bonus tiers + promotion rules.
// ------------------------------------------------------------
export function perfBonusPct(performance) {
  const p = Number(performance) || 0;
  if (p >= 90) return 20;
  if (p >= 70) return 10;
  if (p >= 50) return 5;
  return 0;
}

// Promotion: the FINAL shift at the current rank must end at exactly
// 100% performance, AND enough shifts must be banked at the rank.
export function promotionEligible(career, rank, shiftsAtRank, performance) {
  if (!career || rank >= 4) return false;
  return Number(shiftsAtRank) >= Number(career.ranks[rank].minShifts)
    && Number(performance) === 100;
}

// ------------------------------------------------------------
// 5. Work-performance bonus — PHASE 1 INTEGRATION POINT.
//
// Phase 1 (parallel) is building a work-performance perk (+25%
// gain). THIS function is the shared contract: it reads
// `character.perks` for a perk whose effect is
//   { type: 'work_performance', pct: 25 }
// and returns the gain multiplier as a fraction (0.25). Positive
// event deltas are multiplied by (1 + bonus); negative deltas are
// never softened. Missing/invalid perks → 0.
// Consolidation note: if Phase 1 names the effect differently,
// update the EFFECT_TYPE constant below — one line — and both
// sides stay in sync. Do NOT invent a second reader.
// ------------------------------------------------------------
export const WORK_PERF_EFFECT_TYPE = 'work_performance';

export function getWorkPerformanceBonus(character) {
  try {
    const p = character && character.perks;
    const arr = typeof p === 'string' ? JSON.parse(p || '[]') : p;
    if (!Array.isArray(arr)) return 0;
    for (const perk of arr) {
      const eff = perk && perk.effect;
      if (eff && eff.type === WORK_PERF_EFFECT_TYPE) {
        const pct = Number(eff.pct);
        if (Number.isFinite(pct) && pct > 0) return Math.min(1, pct / 100);
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

// ------------------------------------------------------------
// 6. Storage — career columns on the characters row (same
//    pattern as m7's SHIFT_COLUMNS: explicit persist, belt and
//    suspenders; saveCharacter() is left untouched).
// ------------------------------------------------------------
export const CAREER_COLUMNS = [
  ['career_id', 'TEXT', 'TEXT'],                 // NULL = unemployed
  ['career_rank', 'INTEGER', 'INTEGER'],         // 0–4
  ['career_shifts', 'INTEGER', 'INTEGER'],       // completed shifts at current rank
  ['career_auto', 'INTEGER', 'INTEGER'],          // 1 = auto-start shifts on workdays
  ['career_promo', 'INTEGER', 'INTEGER'],        // 1 = promotion ready
  ['career_last_day', 'TEXT', 'TEXT'],           // Lagos YYYY-MM-DD of last shift/auto attempt
  ['shift_perf', 'INTEGER', 'INTEGER'],          // active shift performance % (NULL = none)
  ['shift_event', 'TEXT', 'TEXT'],               // JSON of the pending work event (NULL = none)
  ['shift_event_count', 'INTEGER', 'INTEGER'],   // events spawned this shift (cap)
];

export async function ensureSchema() {
  for (const [col, lite, pg] of CAREER_COLUMNS) {
    try {
      await dbRun(
        `ALTER TABLE characters ADD COLUMN ${col} ${lite}`,
        `ALTER TABLE characters ADD COLUMN ${col} ${pg}`,
        [],
      );
    } catch (e) {
      if (/duplicate|already exists/i.test(e.message || '')) continue;
      throw e;
    }
  }
}

// Explicit partial persist of career columns only.
export async function persistCareerState(userId, fields = {}) {
  const keys = Object.keys(fields).filter((k) => CAREER_COLUMNS.some(([c]) => c === k));
  if (!keys.length) return;
  const vals = keys.map((k) => fields[k] ?? null);
  await dbRun(
    `UPDATE characters SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE user_id=?`,
    `UPDATE characters SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(', ')} WHERE user_id=$${keys.length + 1}`,
    [...vals, Number(userId)],
  );
}

function parseEvent(raw) {
  if (!raw) return null;
  try {
    const e = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return e && e.id && Array.isArray(e.choices) ? e : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// 7. Core ops — shared by the WS intents (§8) and the REST
//    router (routes/careers.js). Each returns { ok, error?, ... }
//    and persists via persistCareerState; callers sync the patch
//    onto any in-memory character copy.
// ------------------------------------------------------------
function gateErrorFor(career, c) {
  if (career.certRequired && !Number(c.cert)) {
    return 'This career needs a certificate. Study at a campus first.';
  }
  if (career.skillLock) {
    const lvl = skillLevelOf(c, career.skillLock.skill);
    if (lvl < career.skillLock.level) {
      const label = career.skillLock.skill.charAt(0).toUpperCase() + career.skillLock.skill.slice(1);
      return `You need ${label} level ${career.skillLock.level} for ${career.name} (you're level ${lvl}). Train the skill first.`;
    }
  }
  return null;
}

export async function applyCareer(userId, careerId) {
  await ensureSchema();
  const career = careerById(careerId);
  if (!career) return { ok: false, error: 'Unknown career.' };
  const c = await getCharacter(userId);
  if (!c) return { ok: false, error: 'No character found.' };
  if (c.shift_job && Number(c.shift_ends_at) > Date.now()) {
    return { ok: false, error: 'Finish or leave your current shift before switching careers.' };
  }
  const gate = gateErrorFor(career, c);
  if (gate) return { ok: false, error: gate };
  const switching = !!c.career_id && c.career_id !== career.id;
  const patch = {
    career_id: career.id, career_rank: 0, career_shifts: 0,
    career_promo: 0, career_auto: 0,
    shift_perf: null, shift_event: null, shift_event_count: 0,
  };
  await persistCareerState(userId, patch);
  return { ok: true, patch, switching, status: await getCareerStatus(userId) };
}

export async function quitCareer(userId) {
  await ensureSchema();
  const c = await getCharacter(userId);
  if (!c) return { ok: false, error: 'No character found.' };
  if (!c.career_id) return { ok: false, error: "You're not employed anywhere." };
  if (c.shift_job && Number(c.shift_ends_at) > Date.now()) {
    return { ok: false, error: 'Finish or leave your current shift before quitting.' };
  }
  const career = careerById(c.career_id);
  const patch = {
    career_id: null, career_rank: 0, career_shifts: 0,
    career_promo: 0, career_auto: 0, career_last_day: null,
    shift_perf: null, shift_event: null, shift_event_count: 0,
  };
  await persistCareerState(userId, patch);
  return { ok: true, patch, careerName: career ? career.name : 'your job' };
}

export async function promoteCareer(userId) {
  await ensureSchema();
  const c = await getCharacter(userId);
  if (!c) return { ok: false, error: 'No character found.' };
  const career = c.career_id ? careerById(c.career_id) : null;
  if (!career) return { ok: false, error: "You're not employed anywhere." };
  const rank = clamp(Math.floor(Number(c.career_rank) || 0), 0, 4);
  if (rank >= 4) return { ok: false, error: "You're already at the top of this career. 👑" };
  const shifts = Math.max(0, Math.floor(Number(c.career_shifts) || 0));
  if (!Number(c.career_promo) || shifts < career.ranks[rank].minShifts) {
    const need = career.ranks[rank].minShifts;
    return {
      ok: false,
      error: `Not yet: finish ${need - shifts} more shift${need - shifts === 1 ? '' : 's'} as ${career.ranks[rank].title}, ending one at 100% performance.`,
    };
  }
  const patch = { career_rank: rank + 1, career_shifts: 0, career_promo: 0 };
  await persistCareerState(userId, patch);
  return { ok: true, patch, newTitle: career.ranks[rank + 1].title, status: await getCareerStatus(userId) };
}

export async function setAutoStart(userId, on) {
  await ensureSchema();
  const c = await getCharacter(userId);
  if (!c) return { ok: false, error: 'No character found.' };
  if (!c.career_id) return { ok: false, error: 'Get a career first, then set auto-start.' };
  const patch = { career_auto: on ? 1 : 0 };
  await persistCareerState(userId, patch);
  return { ok: true, patch, auto: !!on };
}

export async function respondToEvent(userId, eventId, choiceId, now = Date.now()) {
  await ensureSchema();
  const ts = Number(now) || Date.now();
  const c = await getCharacter(userId);
  if (!c) return { ok: false, error: 'No character found.' };
  if (!c.shift_job || !isCareerRoleId(c.shift_job)) {
    return { ok: false, error: "You're not on a career shift." };
  }
  const stored = parseEvent(c.shift_event);
  if (!stored) return { ok: false, error: 'No work event waiting for you.' };
  if (String(stored.id) !== String(eventId)) {
    return { ok: false, error: 'That event already passed.' };
  }
  const choice = stored.choices.find((x) => String(x.id) === String(choiceId));
  if (!choice) return { ok: false, error: 'Unknown response.' };
  const bonus = getWorkPerformanceBonus(c);
  let perf = clamp(Math.floor(Number(c.shift_perf) ?? PERF_BASELINE), 0, 100);
  let delta;
  if (ts > Number(stored.expiresAt)) {
    // Answered after the window: counts as a miss.
    delta = EVENT_TIMEOUT_DELTA;
  } else {
    delta = Number(choice.delta) || 0;
  }
  perf = applyEventDelta(perf, delta, bonus);
  const patch = { shift_perf: perf, shift_event: null };
  await persistCareerState(userId, patch);
  return { ok: true, patch, performance: perf, delta, timedOut: ts > Number(stored.expiresAt) };
}

// Full view-model for the Career tab UI.
export async function getCareerStatus(userId, now = Date.now()) {
  await ensureSchema();
  const ts = Number(now) || Date.now();
  const c = await getCharacter(userId);
  if (!c) return { employed: false };
  const career = c.career_id ? careerById(c.career_id) : null;
  if (!career) return { employed: false };
  const rank = clamp(Math.floor(Number(c.career_rank) || 0), 0, 4);
  const rankDef = career.ranks[rank];
  const next = rank < 4 ? career.ranks[rank + 1] : null;
  const shiftsAtRank = Math.max(0, Math.floor(Number(c.career_shifts) || 0));
  const onShift = !!(c.shift_job && isCareerRoleId(c.shift_job) && Number(c.shift_ends_at) > ts);
  const stored = parseEvent(c.shift_event);
  const pendingEvent = stored && Number(stored.expiresAt) > ts ? publicEvent(stored) : null;
  return {
    employed: true,
    careerId: career.id,
    careerName: career.name,
    careerIcon: career.icon,
    blurb: career.blurb,
    rank: rank + 1,
    rankOf: 5,
    rankTitle: rankDef.title,
    payPerShift: rankDef.payPerShift,
    energyCost: career.energyCost,
    workplaceId: career.locationId,
    performance: onShift ? clamp(Math.floor(Number(c.shift_perf) ?? PERF_BASELINE), 0, 100) : null,
    shiftsAtRank,
    shiftsNeeded: rankDef.minShifts,
    promotionReady: !!Number(c.career_promo) && rank < 4,
    nextRank: next ? { title: next.title, payPerShift: next.payPerShift, shiftsNeeded: rankDef.minShifts } : null,
    ladder: career.ranks.map((r, i) => ({
      title: r.title, payPerShift: r.payPerShift, minShifts: r.minShifts, current: i === rank,
    })),
    schedule: scheduleLabel(career),
    scheduleStrip: scheduleStrip(career),
    dayOffToday: !isWorkDay(career, ts),
    autoStart: !!Number(c.career_auto),
    onShift,
    shiftEndsAt: onShift ? Number(c.shift_ends_at) : null,
    shiftRoleId: onShift ? String(c.shift_job) : shiftRoleId(career.id, rank),
    pendingEvent,
  };
}

export function publicCareer(career) {
  return {
    id: career.id,
    name: career.name,
    icon: career.icon,
    blurb: career.blurb,
    path: career.path,
    energyCost: career.energyCost,
    workplaceId: career.locationId,
    certRequired: !!career.certRequired,
    skillLock: career.skillLock || null,
    schedule: scheduleLabel(career),
    scheduleStrip: scheduleStrip(career),
    payBand: [career.ranks[0].payPerShift, career.ranks[4].payPerShift],
    ranks: career.ranks.map((r) => ({ title: r.title, payPerShift: r.payPerShift, minShifts: r.minShifts })),
  };
}

// ------------------------------------------------------------
// 8. WS intents — wired by the coordinator into actions.js
//    (same api contract as the M7 intents). Mutations go through
//    the §7 core ops; the in-memory session row is synced from
//    the returned patch, then commit() pushes a fresh `you`.
// ------------------------------------------------------------
export const INTENTS = {
  career_apply: async (api, msg) => {
    const { conn, err, commit } = api;
    const r = await applyCareer(conn.user.id, msg && msg.careerId);
    if (!r.ok) { err(r.error); return; }
    Object.assign(conn.character, r.patch);
    const st = r.status;
    await commit({
      note: r.switching
        ? `💼 Career switch! You left your old hustle and joined ${st.careerName} as ${st.rankTitle} — back to rank 1 of 5.`
        : `💼 Hired! You're now a ${st.rankTitle} at ${st.careerName} — ${naira(st.payPerShift)}/shift.`,
    });
  },

  career_quit: async (api, msg) => {
    const { conn, err, commit } = api;
    const r = await quitCareer(conn.user.id);
    if (!r.ok) { err(r.error); return; }
    Object.assign(conn.character, r.patch);
    await commit({ note: `You quit ${r.careerName}. The streets will remember. 🌆` });
  },

  career_promote: async (api, msg) => {
    const { conn, err, commit } = api;
    const r = await promoteCareer(conn.user.id);
    if (!r.ok) { err(r.error); return; }
    Object.assign(conn.character, r.patch);
    await commit({ note: `🎉 PROMOTION! You're now ${r.newTitle} — ${naira(r.status.payPerShift)}/shift.` });
  },

  career_auto: async (api, msg) => {
    const { conn, err, commit } = api;
    const on = !!(msg && (msg.on === true || msg.on === 1 || msg.on === '1'));
    const r = await setAutoStart(conn.user.id, on);
    if (!r.ok) { err(r.error); return; }
    Object.assign(conn.character, r.patch);
    await commit({
      note: on
        ? '⏰ Auto-start ON — your shift begins automatically on workdays.'
        : '⏰ Auto-start OFF — you clock in manually.',
    });
  },

  career_respond: async (api, msg) => {
    const { conn, err, commit, now } = api;
    const r = await respondToEvent(conn.user.id, msg && msg.eventId, msg && msg.choiceId, now);
    if (!r.ok) { err(r.error); return; }
    Object.assign(conn.character, r.patch);
    const arrow = r.delta > 0 ? '📈' : r.delta < 0 ? '📉' : '➖';
    await commit({
      note: r.timedOut
        ? `⏳ Too slow — that one slipped. Performance ${r.performance}%.`
        : `${arrow} Handled it. Performance ${r.performance}%.`,
    });
  },

  career_status: async (api, msg) => {
    const { conn, send, now } = api;
    send(conn, { t: 'career_status', status: await getCareerStatus(conn.user.id, now) });
  },
};

// ------------------------------------------------------------
// 9. Per-minute tick — runs BEFORE m7's own tick in the v2tick
//    interval (see app.js). Two jobs:
//
//    (a) MINI-GAME: for live career shifts — initialise
//        performance, expire timed-out events (−10), spawn new
//        events (≤4/shift, ~35%/min) and push them to the player.
//    (b) END-OF-SHIFT: for career shifts that just expired —
//        credit the performance bonus via an atomic money UPDATE
//        (m7's tick then settles the BASE pay separately, so the
//        two can never double-pay), bank the shift at the rank,
//        flag promotion eligibility, and clear shift state.
//        Also auto-starts shifts for opted-in players.
//
//    ctx = { now, sendTo(userId, msg), broadcast?, rand? }
//    `rand` is injectable for deterministic tests.
// ------------------------------------------------------------
export async function onTickMinute(ctx = {}) {
  const ts = Number(ctx.now) || Date.now();
  const rand = typeof ctx.rand === 'function' ? ctx.rand : Math.random;
  await ensureSchema();
  const wageMult = await readWageMult();
  const chars = await listCharacters();
  const summary = { eventsSpawned: 0, eventsExpired: 0, shiftsClosed: 0, autoStarted: 0, bonusPaid: 0 };
  const sendTo = ctx.sendTo || (async () => {});
  const refreshYou = ctx.refreshYou || (async () => {});

  for (const ch of chars) {
    const userId = Number(ch.user_id);
    const career = ch.career_id ? careerById(ch.career_id) : null;
    const roleId = ch.shift_job ? String(ch.shift_job) : null;
    const isCareerShift = roleId && isCareerRoleId(roleId);
    const endsAt = Number(ch.shift_ends_at);
    const live = isCareerShift && Number.isFinite(endsAt) && endsAt > ts;

    // (b) shift just expired — close it BEFORE m7 settles base pay.
    // The shift_perf IS NOT NULL guard makes the close idempotent:
    // closeCareerShift NULLs shift_perf, so a second sighting of the
    // same expired shift (m7 clears shift_job later) is skipped — no
    // double bonus, no double shift-count. Shifts that expired without
    // ever being ticked (shift_perf NULL) are left for m7's base-pay
    // settle; their bonus is forfeited, same as the stale-settle path.
    if (isCareerShift && !live && ch.shift_ends_at != null && ch.shift_perf != null) {
      await closeCareerShift(ch, userId, career, ts, wageMult, sendTo, summary);
      continue;
    }
    if (live) {
      // (a) mini-game upkeep for the live shift.
      await tickLiveShift(ch, userId, career, ts, rand, sendTo, summary);
      continue;
    }
    if (career && !roleId && Number(ch.career_auto)) {
      // (c) auto-start on workdays.
      await maybeAutoStart(ch, userId, career, ts, sendTo, refreshYou, summary);
    }
  }
  return summary;
}

async function tickLiveShift(ch, userId, career, ts, rand, sendTo, summary) {
  // Baseline performance on first sight of the shift.
  if (ch.shift_perf == null) {
    await persistCareerState(userId, { shift_perf: PERF_BASELINE });
    ch.shift_perf = PERF_BASELINE;
  }
  const stored = parseEvent(ch.shift_event);
  if (stored) {
    if (ts > Number(stored.expiresAt)) {
      // Timed out — the −10 applies with no perk softening.
      const perf = applyEventDelta(ch.shift_perf, EVENT_TIMEOUT_DELTA, 0);
      await persistCareerState(userId, { shift_perf: perf, shift_event: null });
      summary.eventsExpired++;
      try {
        await sendTo(userId, { t: 'career_event_expired', performance: perf, note: '⏳ A work matter slipped while you were away (−10 performance).' });
      } catch (e) { console.error('[careers] sendTo:', e.message); }
    }
    return; // one pending event at a time
  }
  const seen = Math.max(0, Math.floor(Number(ch.shift_event_count) || 0));
  if (seen >= MAX_EVENTS_PER_SHIFT) return;
  if (rand() >= EVENT_SPAWN_PCT_PER_MIN) return;
  const def = pickEvent(career ? career.path : 'corporate', seen, rand);
  const storedEv = buildStoredEvent(def, ts);
  await persistCareerState(userId, { shift_event: JSON.stringify(storedEv), shift_event_count: seen + 1 });
  summary.eventsSpawned++;
  try {
    await sendTo(userId, {
      t: 'career_event',
      event: publicEvent(storedEv),
      performance: clamp(Math.floor(Number(ch.shift_perf) ?? PERF_BASELINE), 0, 100),
      note: `💼 Work needs you: ${def.title}`,
    });
  } catch (e) { console.error('[careers] sendTo:', e.message); }
}

async function closeCareerShift(ch, userId, career, ts, wageMult, sendTo, summary) {
  const ref = careerOfRoleId(ch.shift_job);
  const roleCareer = career || (ref && ref.career);
  const rank = ref ? ref.rank : clamp(Math.floor(Number(ch.career_rank) || 0), 0, 4);
  const rankDef = roleCareer ? roleCareer.ranks[rank] : null;
  const perf = clamp(Math.floor(Number(ch.shift_perf) ?? PERF_BASELINE), 0, 100);
  const payPerShift = rankDef ? rankDef.payPerShift : 8600;
  // Mirror m7's payout inputs so the bonus stacks on the same base.
  const base = calcShiftPay(payPerShift, {
    classMult: classPayMult(ch.class),
    wageMult,
    perkPct: workPayPerkPct(ch),
  });
  const bonus = Math.floor((base * perfBonusPct(perf)) / 100);
  const shiftsNow = Math.max(0, Math.floor(Number(ch.career_shifts) || 0)) + 1;
  const eligible = !!(roleCareer && rank < 4 && perf === 100 && shiftsNow >= roleCareer.ranks[rank].minShifts);
  const today = lagosDateStr(ts);
  const moneyBefore = Math.max(0, Math.floor(Number(ch.money) || 0));

  // Atomic credit + progress in ONE update (m7's tick settles base pay
  // afterwards on a fresh row read — sequential, no lost update).
  await dbRun(
    'UPDATE characters SET money=money+?, career_shifts=?, career_last_day=?, career_promo=?, shift_perf=NULL, shift_event=NULL, shift_event_count=0 WHERE user_id=?',
    'UPDATE characters SET money=money+$1, career_shifts=$2, career_last_day=$3, career_promo=$4, shift_perf=NULL, shift_event=NULL, shift_event_count=0 WHERE user_id=$5',
    [bonus, roleCareer ? shiftsNow : Math.max(0, Math.floor(Number(ch.career_shifts) || 0)), today, eligible ? 1 : 0, userId],
  );
  if (bonus > 0) {
    await addTransaction(userId, 'career_shift_bonus', bonus, moneyBefore + bonus, {
      career: roleCareer ? roleCareer.id : null, rank, performance: perf,
    });
    summary.bonusPaid += bonus;
  }
  summary.shiftsClosed++;
  try {
    await sendTo(userId, {
      t: 'career_shift_closed',
      performance: perf,
      bonus,
      shiftsAtRank: shiftsNow,
      promotionReady: eligible,
      note: eligible
        ? `🎉 Shift done at ${perf}% — PROMOTION READY! Tap Promote in your Career tab.`
        : `💼 Shift done — performance ${perf}%${bonus > 0 ? `, +${naira(bonus)} performance bonus` : ''}.`,
    });
  } catch (e) { console.error('[careers] sendTo:', e.message); }
}

async function maybeAutoStart(ch, userId, career, ts, sendTo, refreshYou, summary) {
  const today = lagosDateStr(ts);
  if (ch.career_last_day === today) return; // one attempt per day
  if (!isWorkDay(career, ts)) return;
  if (lagosParts(ts).hour < career.schedule.start) return; // not yet work o'clock
  const rank = clamp(Math.floor(Number(ch.career_rank) || 0), 0, 4);
  const roleId = shiftRoleId(career.id, rank);
  const energy = Math.floor(Number(ch.energy) || 0);
  if (energy < career.energyCost) {
    await persistCareerState(userId, { career_last_day: today });
    try {
      await sendTo(userId, {
        t: 'career_auto_skipped',
        note: `⏰ Auto-start skipped — too tired for your ${career.name} shift. Rest up and clock in manually.`,
      });
    } catch (e) { console.error('[careers] sendTo:', e.message); }
    return;
  }
  await dbRun(
    'UPDATE characters SET shift_job=?, shift_started_at=?, shift_ends_at=?, energy=?, shift_perf=?, shift_event=NULL, shift_event_count=0, career_last_day=? WHERE user_id=?',
    'UPDATE characters SET shift_job=$1, shift_started_at=$2, shift_ends_at=$3, energy=$4, shift_perf=$5, shift_event=NULL, shift_event_count=0, career_last_day=$6 WHERE user_id=$7',
    [roleId, ts, ts + SHIFT_MS, energy - career.energyCost, PERF_BASELINE, today, userId],
  );
  summary.autoStarted++;
  try { await refreshYou(userId); } catch (e) { console.error('[careers] refreshYou:', e.message); }
  try {
    await sendTo(userId, {
      t: 'career_auto_started',
      note: `⏰ Auto-started your ${career.name} shift (${career.ranks[rank].title}) — ends in 1 hour.`,
    });
  } catch (e) { console.error('[careers] sendTo:', e.message); }
}
