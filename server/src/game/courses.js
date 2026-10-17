// ============================================================
// game/courses.js — Èkó Trade School (P5).
//
// 13 ORIGINAL vocational courses × 5 lessons each. Distinct from
// M12's campus Academy (skill XP): these are career-trade courses
// ending in a certificate that boosts work performance / pay for
// related careers. 100% original copy.
//
// Rules: ₦1,000–₦4,000 per lesson, max 2 lessons per real day,
// one 3-question quiz per course (pass: ≥2 correct), certificate on
// completion. Server-authoritative; client never sends numbers.
//
// HOOKS:
//   - getCourseBoosts(userId): Phase 3 (career/pay) multiplies shift
//     pay / work performance by these. E.g. Software Development
//     gives +15% work performance.
//   - listCertificates(userId) / awardCertificate(): Phase 1 exposes
//     a certificates surface — this module is the award side; join
//     the read side there.
// ============================================================
import { dbRun, dbGet, dbAll } from '../db.js';

export const LESSONS_PER_DAY = 2;
export const QUIZ_PASS = 2; // correct answers needed out of 3

// boosts: key → multiplier. Phase 3 reads via getCourseBoosts().
const B = (workPerf = 0, shiftPay = 0) => ({ workPerf, shiftPay });

export const COURSES = [
  {
    id: 'software_dev', name: 'Software Development', icon: '💻', fee: 4000,
    tagline: 'From hello world to hired.',
    boost: B(0.15, 0), boostLabel: '+15% work performance',
    lessons: ['Thinking Like a Programmer', 'HTML & CSS: Your First Page', 'JavaScript Basics', 'APIs and Data', 'Build & Deploy a Mini App'],
    quiz: [
      { q: 'What does HTML stand for?', options: ['HyperText Markup Language', 'High Tech Machine Learning', 'Home Tool Markup Language'], answer: 0 },
      { q: 'Which one stores a list of values in JavaScript?', options: ['A string', 'An array', 'A comment'], answer: 1 },
      { q: 'An API is best described as…', options: ['A design tool', 'A way for apps to talk to each other', 'A type of database only'], answer: 1 },
    ],
  },
  {
    id: 'digital_marketing', name: 'Digital Marketing', icon: '📣', fee: 3000,
    tagline: 'Sell anything to anyone online.',
    boost: B(0.10, 0), boostLabel: '+10% work performance',
    lessons: ['Know Your Customer', 'Content That Converts', 'Running IG & TikTok Ads', 'WhatsApp Selling Funnels', 'Reading Your Numbers'],
    quiz: [
      { q: 'The first step of marketing is…', options: ['Posting every day', 'Knowing who you are selling to', 'Buying followers'], answer: 1 },
      { q: 'A funnel moves a customer from…', options: ['Awareness to purchase', 'Purchase to refund', 'DM to block'], answer: 0 },
      { q: 'The most important ad metric for a vendor is…', options: ['Likes', 'Cost per sale', 'Font choice'], answer: 1 },
    ],
  },
  {
    id: 'tailoring', name: 'Tailoring & Fashion', icon: '🧵', fee: 2500,
    tagline: 'Measure twice, cut once.',
    boost: B(0.10, 0), boostLabel: '+10% work performance',
    lessons: ['Tools of the Trade', 'Taking Measurements', 'Cutting Ankara & Aso-ebi', 'Sewing Straight Seams', 'Finishing & Fitting'],
    quiz: [
      { q: 'Before cutting fabric you must…', options: ['Iron it', 'Measure twice', 'Wash the machine'], answer: 1 },
      { q: 'A seam allowance is…', options: ['Extra fabric for stitching', 'A discount for tailors', 'A type of zip'], answer: 0 },
      { q: 'The best way to keep customers is…', options: ['Cheap prices only', 'Good fit + on-time delivery', 'Free drinks'], answer: 1 },
    ],
  },
  {
    id: 'catering', name: 'Catering & Events', icon: '🍲', fee: 2500,
    tagline: 'Feed the owambe, own the weekend.',
    boost: B(0.10, 0), boostLabel: '+10% work performance',
    lessons: ['Kitchen Hygiene First', 'Cooking for 200 People', 'Small Chops That Sell', 'Pricing an Owambe Menu', 'Serving & Presentation'],
    quiz: [
      { q: 'The golden rule of bulk cooking is…', options: ['Cook everything at once', 'Prep (mise en place) before you start', 'Taste at the end only'], answer: 1 },
      { q: 'Pricing a catering job must cover…', options: ['Ingredients + labour + profit', 'Ingredients only', 'Whatever the client suggests'], answer: 0 },
      { q: 'Small chops are popular because they are…', options: ['Expensive', 'Easy to share at parties', 'Only for weddings'], answer: 1 },
    ],
  },
  {
    id: 'photography', name: 'Photography', icon: '📸', fee: 3000,
    tagline: 'Every shot tells a story.',
    boost: B(0.10, 0), boostLabel: '+10% work performance',
    lessons: ['Know Your Camera', 'Light Is Everything', 'Framing & Composition', 'Shooting Events', 'Editing & Delivery'],
    quiz: [
      { q: 'Golden hour means…', options: ['Midday sun', 'Soft light just after sunrise / before sunset', 'Indoor lighting'], answer: 1 },
      { q: 'The rule of thirds helps with…', options: ['Pricing', 'Composition', 'Battery life'], answer: 1 },
      { q: 'A client gallery should be delivered…', options: ['Whenever', 'On time, edited, and backed up', 'As raw files only'], answer: 1 },
    ],
  },
  {
    id: 'music_production', name: 'Music Production', icon: '🎹', fee: 3000,
    tagline: 'Make the beat they can\'t skip.',
    boost: B(0.10, 0), boostLabel: '+10% work performance',
    lessons: ['Your First DAW', 'Drums & Rhythm', 'Melody & Chords', 'Recording Vocals', 'Mixing & Mastering Basics'],
    quiz: [
      { q: 'A DAW is…', options: ['A speaker brand', 'Software for making music', 'A dance move'], answer: 1 },
      { q: 'The backbone of Afrobeats rhythm is…', options: ['The drum pattern', 'The album cover', 'The artist\'s name'], answer: 0 },
      { q: 'Mastering is done…', options: ['Before recording', 'As the final polish before release', 'Only for videos'], answer: 1 },
    ],
  },
  {
    id: 'plumbing', name: 'Plumbing & Pipework', icon: '🔧', fee: 2000,
    tagline: 'Water must flow. You make it flow.',
    boost: B(0, 0.10), boostLabel: '+10% shift pay (trade)',
    lessons: ['Tools & Safety', 'Reading a Pipe Layout', 'Fixing Leaks & Taps', 'Installing a Water Closet', 'Quoting a Job'],
    quiz: [
      { q: 'First thing before opening a pipe…', options: ['Call the client', 'Shut off the water supply', 'Take a photo'], answer: 1 },
      { q: 'Teflon tape is used to…', options: ['Seal threaded joints', 'Paint pipes', 'Measure pressure'], answer: 0 },
      { q: 'A good quote includes…', options: ['Materials + labour, written down', 'A guess over the phone', 'Only labour'], answer: 0 },
    ],
  },
  {
    id: 'electrical', name: 'Electrical Installation', icon: '💡', fee: 2000,
    tagline: 'Light up the street, safely.',
    boost: B(0, 0.10), boostLabel: '+10% shift pay (trade)',
    lessons: ['Safety: Respect the Current', 'Wiring a Room', 'Breakers & Distribution Boards', 'Fixing Common Faults', 'Quoting & Certification'],
    quiz: [
      { q: 'Before touching any wiring…', options: ['Wear rubber slippers', 'Isolate the power and test dead', 'Work fast'], answer: 1 },
      { q: 'A circuit breaker protects against…', options: ['High NEPA bills', 'Overload and short circuits', 'Rain'], answer: 1 },
      { q: 'After finishing a job you should…', options: ['Leave quickly', 'Test everything and explain to the client', 'Ask for a tip'], answer: 1 },
    ],
  },
  {
    id: 'barbing', name: 'Barbing & Grooming', icon: '💈', fee: 1500,
    tagline: 'Fresh cuts, loyal customers.',
    boost: B(0, 0.10), boostLabel: '+10% shift pay (trade)',
    lessons: ['Clipper Basics', 'Fade Techniques', 'Beard Sculpting', 'Shop Hygiene', 'Keeping Customers Coming Back'],
    quiz: [
      { q: 'A clean fade blends…', options: ['Two guard lengths smoothly', 'Only one length', 'Colours'], answer: 0 },
      { q: 'Clipper hygiene matters because…', options: ['It looks professional', 'It prevents skin infections', 'Both'], answer: 2 },
      { q: 'The best marketing for a barber is…', options: ['Loud music', 'Consistent quality + booked appointments', 'Free cuts forever'], answer: 1 },
    ],
  },
  {
    id: 'makeup', name: 'Makeup & Beauty', icon: '💄', fee: 2000,
    tagline: 'Beat faces, build a brand.',
    boost: B(0.10, 0), boostLabel: '+10% work performance',
    lessons: ['Skin Prep', 'Foundation Matching', 'Eyes That Speak', 'Gele & Head Styling', 'Bridal Packages & Pricing'],
    quiz: [
      { q: 'Foundation must match the…', options: ['Dress colour', 'Client\'s skin tone', 'Lipstick'], answer: 1 },
      { q: 'Skin prep before makeup…', options: ['Is optional', 'Makes the look last longer', 'Wastes time'], answer: 1 },
      { q: 'A bridal package should be priced…', options: ['Per product used', 'As a package covering trial + day-of', 'Hourly only'], answer: 1 },
    ],
  },
  {
    id: 'driving', name: 'Commercial Driving', icon: '🚐', fee: 1500,
    tagline: 'Master the road, own the route.',
    boost: B(0, 0.12), boostLabel: '+12% shift pay (transport)',
    lessons: ['Know Your Vehicle', 'Defensive Driving', 'Navigating Lagos Traffic', 'Passenger Service', 'Daily Returns & Maintenance'],
    quiz: [
      { q: 'Defensive driving means…', options: ['Driving fast', 'Expecting other drivers\' mistakes', 'Honing always'], answer: 1 },
      { q: 'Before a day\'s work you should…', options: ['Check tyres, oil, and brakes', 'Just start the engine', 'Wash the bus'], answer: 0 },
      { q: 'Good passenger service earns…', options: ['Nothing', 'Repeat customers and tips', 'Fines'], answer: 1 },
    ],
  },
  {
    id: 'real_estate', name: 'Real Estate Hustle', icon: '🏘️', fee: 3500,
    tagline: 'Land no dey depreciate.',
    boost: B(0.10, 0.10), boostLabel: '+10% work performance & shift pay',
    lessons: ['How Property Markets Work', 'Inspection & Due Diligence', 'Agency & Commission', 'Closing a Deal', 'Building Your Listings'],
    quiz: [
      { q: 'Due diligence before buying land means…', options: ['Paying quickly', 'Verifying title documents', 'Trusting the agent'], answer: 1 },
      { q: 'A C of O is…', options: ['A receipt', 'A government land title document', 'An estate gate pass'], answer: 1 },
      { q: 'An agent earns through…', options: ['Salary only', 'Commission on closed deals', 'Rent collection'], answer: 1 },
    ],
  },
  {
    id: 'trading_fx', name: 'Markets & Trading Basics', icon: '📊', fee: 4000,
    tagline: 'Charts before cheques.',
    boost: B(0.10, 0), boostLabel: '+10% work performance',
    lessons: ['What Moves Markets', 'Risk Management First', 'Reading Candlesticks', 'Demo Before Real Money', 'The Trading Journal'],
    quiz: [
      { q: 'The first rule of trading is…', options: ['Go big early', 'Never risk money you can\'t lose', 'Follow signals blindly'], answer: 1 },
      { q: 'A stop loss…', options: ['Guarantees profit', 'Caps how much a trade can lose', 'Is optional'], answer: 1 },
      { q: 'A trading journal helps you…', options: ['Show off', 'Learn from your own patterns', 'Avoid taxes'], answer: 1 },
    ],
  },
];

export function getCourse(id) {
  return COURSES.find(c => c.id === id) || null;
}

const SCHEMA_SQLITE = `
CREATE TABLE IF NOT EXISTS trade_school_progress (
  user_id INTEGER NOT NULL,
  course_id TEXT NOT NULL,
  lessons_done INTEGER NOT NULL DEFAULT 0,
  lesson_day TEXT NOT NULL DEFAULT '',
  lessons_today INTEGER NOT NULL DEFAULT 0,
  quiz_passed INTEGER NOT NULL DEFAULT 0,
  cert_awarded INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, course_id)
);`;

const SCHEMA_PG = `
CREATE TABLE IF NOT EXISTS trade_school_progress (
  user_id BIGINT NOT NULL,
  course_id TEXT NOT NULL,
  lessons_done INTEGER NOT NULL DEFAULT 0,
  lesson_day TEXT NOT NULL DEFAULT '',
  lessons_today INTEGER NOT NULL DEFAULT 0,
  quiz_passed INTEGER NOT NULL DEFAULT 0,
  cert_awarded INTEGER NOT NULL DEFAULT 0,
  completed_at BIGINT,
  updated_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, course_id)
);`;

let _ready = false;
export async function ensureCoursesSchema() {
  if (_ready) return;
  await dbRun(SCHEMA_SQLITE, SCHEMA_PG);
  _ready = true;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function getProgress(userId, courseId) {
  await ensureCoursesSchema();
  const r = await dbGet(
    'SELECT lessons_done, lesson_day, lessons_today, quiz_passed, cert_awarded, completed_at FROM trade_school_progress WHERE user_id = ? AND course_id = ?',
    'SELECT lessons_done, lesson_day, lessons_today, quiz_passed, cert_awarded, completed_at FROM trade_school_progress WHERE user_id = $1 AND course_id = $2',
    [Number(userId), courseId]);
  if (!r) {
    return { lessonsDone: 0, lessonDay: '', lessonsToday: 0, quizPassed: false, certAwarded: false, completedAt: null };
  }
  return {
    lessonsDone: Number(r.lessons_done) || 0,
    lessonDay: r.lesson_day || '',
    lessonsToday: Number(r.lessons_today) || 0,
    quizPassed: !!Number(r.quiz_passed),
    certAwarded: !!Number(r.cert_awarded),
    completedAt: r.completed_at ? Number(r.completed_at) : null,
  };
}

async function saveProgress(userId, courseId, p) {
  await ensureCoursesSchema();
  await dbRun(
    `INSERT INTO trade_school_progress (user_id, course_id, lessons_done, lesson_day, lessons_today, quiz_passed, cert_awarded, completed_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id, course_id) DO UPDATE SET lessons_done=excluded.lessons_done, lesson_day=excluded.lesson_day,
       lessons_today=excluded.lessons_today, quiz_passed=excluded.quiz_passed, cert_awarded=excluded.cert_awarded,
       completed_at=excluded.completed_at, updated_at=excluded.updated_at`,
    `INSERT INTO trade_school_progress (user_id, course_id, lessons_done, lesson_day, lessons_today, quiz_passed, cert_awarded, completed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(user_id, course_id) DO UPDATE SET lessons_done=excluded.lessons_done, lesson_day=excluded.lesson_day,
       lessons_today=excluded.lessons_today, quiz_passed=excluded.quiz_passed, cert_awarded=excluded.cert_awarded,
       completed_at=excluded.completed_at, updated_at=excluded.updated_at`,
    [Number(userId), courseId, p.lessonsDone, p.lessonDay, p.lessonsToday,
     p.quizPassed ? 1 : 0, p.certAwarded ? 1 : 0, p.completedAt, Date.now()]);
}

/** Full course list with the viewer's progress merged in. */
export async function listCoursesWithProgress(userId) {
  const out = [];
  for (const c of COURSES) {
    const p = await getProgress(userId, c.id);
    out.push({
      id: c.id, name: c.name, icon: c.icon, fee: c.fee,
      tagline: c.tagline, boostLabel: c.boostLabel,
      lessonsTotal: c.lessons.length,
      lessonsDone: p.lessonsDone,
      lessonsToday: p.lessonsToday,
      lessonsTodayLeft: Math.max(0, LESSONS_PER_DAY - (p.lessonDay === todayKey() ? p.lessonsToday : 0)),
      quizUnlocked: p.lessonsDone >= c.lessons.length,
      quizPassed: p.quizPassed,
      certAwarded: p.certAwarded,
      completedAt: p.completedAt,
    });
  }
  return out;
}

/** Course detail: lesson list (titles only — content is in-app copy). */
export async function courseDetail(userId, courseId) {
  const c = getCourse(courseId);
  if (!c) return null;
  const p = await getProgress(userId, courseId);
  return {
    id: c.id, name: c.name, icon: c.icon, fee: c.fee,
    tagline: c.tagline, boostLabel: c.boostLabel,
    lessons: c.lessons.map((t, i) => ({ n: i + 1, title: t, done: i < p.lessonsDone })),
    quiz: c.quiz.map(q => ({ q: q.q, options: q.options })), // answers stay server-side
    progress: p,
  };
}

/**
 * Take the next lesson. Validates the 2/day cap and charges the fee.
 * Returns { lesson, lessonsDone } or throws.
 */
export async function takeLesson(userId, courseId, { chargeFee }) {
  const c = getCourse(courseId);
  if (!c) throw Object.assign(new Error('Unknown course.'), { status: 404 });
  const p = await getProgress(userId, courseId);
  if (p.certAwarded) throw Object.assign(new Error('You already hold this certificate.'), { status: 400 });
  if (p.lessonsDone >= c.lessons.length) throw Object.assign(new Error('All lessons done — take the quiz!'), { status: 400 });
  const tk = todayKey();
  const todayCount = p.lessonDay === tk ? p.lessonsToday : 0;
  if (todayCount >= LESSONS_PER_DAY) {
    throw Object.assign(new Error(`Max ${LESSONS_PER_DAY} lessons per day. Come back tomorrow.`), { status: 400 });
  }
  // chargeFee() is provided by the router (money.js semantics, admin-aware).
  await chargeFee(c.fee, { kind: 'course_lesson', course: courseId, lesson: p.lessonsDone + 1 });
  const np = {
    ...p,
    lessonsDone: p.lessonsDone + 1,
    lessonDay: tk,
    lessonsToday: todayCount + 1,
  };
  await saveProgress(userId, courseId, np);
  return {
    lesson: { n: np.lessonsDone, title: c.lessons[np.lessonsDone - 1] },
    lessonsDone: np.lessonsDone,
    lessonsTotal: c.lessons.length,
    quizUnlocked: np.lessonsDone >= c.lessons.length,
  };
}

/**
 * Submit quiz answers (array of option indexes). Pass = ≥ QUIZ_PASS/3.
 * Awards the certificate on pass.
 */
export async function submitQuiz(userId, courseId, answers) {
  const c = getCourse(courseId);
  if (!c) throw Object.assign(new Error('Unknown course.'), { status: 404 });
  const p = await getProgress(userId, courseId);
  if (p.certAwarded) throw Object.assign(new Error('You already hold this certificate.'), { status: 400 });
  if (p.lessonsDone < c.lessons.length) {
    throw Object.assign(new Error('Finish all lessons before the quiz.'), { status: 400 });
  }
  if (!Array.isArray(answers) || answers.length !== c.quiz.length) {
    throw Object.assign(new Error('Answer every question.'), { status: 400 });
  }
  let correct = 0;
  c.quiz.forEach((q, i) => { if (Number(answers[i]) === q.answer) correct += 1; });
  const passed = correct >= QUIZ_PASS;
  const np = { ...p, quizPassed: passed || p.quizPassed };
  if (passed && !p.certAwarded) {
    np.certAwarded = true;
    np.completedAt = Date.now();
    await awardCertificate(userId, courseId);
  }
  await saveProgress(userId, courseId, np);
  return { correct, total: c.quiz.length, passed, certAwarded: np.certAwarded };
}

/**
 * HOOK — award side of certificates. Phase 1's certificates surface
 * joins here via listCertificates(). Currently a no-op marker: the
 * trade_school_progress row is the source of truth.
 */
export async function awardCertificate(userId, courseId) {
  await ensureCoursesSchema();
  return { userId: Number(userId), courseId, awardedAt: Date.now() };
}

/** HOOK — read side for Phase 1's certificates surface. */
export async function listCertificates(userId) {
  await ensureCoursesSchema();
  const rows = await dbAll(
    'SELECT course_id, completed_at FROM trade_school_progress WHERE user_id = ? AND cert_awarded = 1 ORDER BY completed_at DESC',
    'SELECT course_id, completed_at FROM trade_school_progress WHERE user_id = $1 AND cert_awarded = 1 ORDER BY completed_at DESC',
    [Number(userId)]);
  return (rows || []).map(r => {
    const c = getCourse(r.course_id);
    return {
      courseId: r.course_id,
      name: c ? c.name : r.course_id,
      icon: c ? c.icon : '🎓',
      boostLabel: c ? c.boostLabel : '',
      awardedAt: r.completed_at ? Number(r.completed_at) : null,
    };
  });
}

/**
 * HOOK — career boost map for Phase 3 (career/pay). Sums the boosts of
 * all certified courses: { workPerfMult, shiftPayMult }.
 */
export async function getCourseBoosts(userId) {
  await ensureCoursesSchema();
  const rows = await dbAll(
    'SELECT course_id FROM trade_school_progress WHERE user_id = ? AND cert_awarded = 1',
    'SELECT course_id FROM trade_school_progress WHERE user_id = $1 AND cert_awarded = 1',
    [Number(userId)]);
  let workPerf = 0, shiftPay = 0;
  for (const r of rows || []) {
    const c = getCourse(r.course_id);
    if (c && c.boost) { workPerf += c.boost.workPerf; shiftPay += c.boost.shiftPay; }
  }
  return {
    workPerfMult: 1 + workPerf,
    shiftPayMult: 1 + shiftPay,
    courses: (rows || []).map(r => r.course_id),
  };
}
