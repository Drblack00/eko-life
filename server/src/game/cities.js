// ============================================================
// cities.js — Home City V1: Nigerian city packs.
//
// Each city defines its flavor, spawn point, venues, jobs and events.
// Venue/job entries carry a `cities` array for city scoping; entries
// WITHOUT the array are available everywhere. (Legacy Lagos entries in
// data.js are tagged cities:['lagos'] explicitly.)
//
// Gameplay coins only — nothing here touches real money.
// ============================================================

/** City metadata: id → display info + economy knobs + spawn venue. */
export const CITIES = {
  lagos: {
    id: 'lagos',
    name: 'Lagos',
    state: 'Lagos State',
    tagline: 'The hustle capital — higher pay, higher bills, zero sleep.',
    emoji: '🌉',
    starting_cash: 2000,
    pay_mult: 1.15,
    cost_mult: 1.15,
    spawn: 'ojuelegba',
  },
  benin: {
    id: 'benin',
    name: 'Benin City',
    state: 'Edo State',
    tagline: 'The ancient bronze kingdom — heritage, festivals, and quiet old money.',
    emoji: '🏛️',
    starting_cash: 3000,
    pay_mult: 1.0,
    cost_mult: 0.95,
    spawn: 'benin_ring_road',
  },
  ph: {
    id: 'ph',
    name: 'Port Harcourt',
    state: 'Rivers State',
    tagline: 'Oil & gas money flows here — big contracts, bigger weekends.',
    emoji: '🛢️',
    starting_cash: 3000,
    pay_mult: 1.2,
    cost_mult: 1.1,
    spawn: 'ph_oil_mill',
  },
  abuja: {
    id: 'abuja',
    name: 'Abuja',
    state: 'FCT',
    tagline: 'The capital — government contracts, civil service, planned-city calm.',
    emoji: '🦅',
    starting_cash: 2500,
    pay_mult: 1.1,
    cost_mult: 1.1,
    spawn: 'abuja_eagle_square',
  },
};

export function cityIds() {
  return Object.keys(CITIES);
}

/** City meta by id; unknown ids fall back to Lagos (never crash on bad data). */
export function getCity(id) {
  return CITIES[id] || CITIES.lagos;
}

/** Slim city summary for /api/config and /api/me. */
export function citySummary(id) {
  const c = getCity(id);
  return {
    id: c.id,
    name: c.name,
    state: c.state,
    tagline: c.tagline,
    emoji: c.emoji,
    starting_cash: c.starting_cash,
    pay_mult: c.pay_mult,
    cost_mult: c.cost_mult,
  };
}

// ---------------- Per-city venues ----------------
// Full location shape (matches data.js LOCATIONS): id, name, region, icon,
// x/y (0–100 map coords), tags, blurb, cities. Lagos keeps its legacy
// LOCATIONS entries (tagged cities:['lagos']); these packs cover the rest.
export const CITY_VENUES = {
  benin: [
    { id: 'benin_ring_road', name: 'Ring Road Roundabout', region: 'mainland', icon: '🏛️', x: 50, y: 50, tags: ['motor_park', 'landmark'], blurb: "The Oba's city centre — bronze casters, traffic, and history at every turn.", cities: ['benin'] },
    { id: 'benin_oba_market', name: 'Oba Market', region: 'mainland', icon: '🧺', x: 45, y: 58, tags: ['market'], blurb: 'A market older than most countries — brass, coral beads and street food.', cities: ['benin'] },
    { id: 'benin_uniben', name: 'UNIBEN Main Gate', region: 'mainland', icon: '🎓', x: 62, y: 38, tags: ['campus'], blurb: "University of Benin — Ekosodin's student hustle never sleeps.", cities: ['benin'] },
    { id: 'benin_igue_ground', name: 'Igue Festival Ground', region: 'mainland', icon: '🎭', x: 52, y: 44, tags: ['landmark'], blurb: 'Home of the Igue festival — bronze, beads and royal ceremony.', cities: ['benin'] },
    { id: 'benin_sakponba', name: 'Sakponba Road', region: 'mainland', icon: '🛣️', x: 38, y: 52, tags: ['motor_park'], blurb: 'Interstate buses and spare-parts dealers as far as the eye can see.', cities: ['benin'] },
    { id: 'benin_ogba_park', name: 'Ogba Zoo & Nature Park', region: 'island', icon: '🦁', x: 70, y: 62, tags: ['landmark'], blurb: 'Lions, monkeys and picnic Sundays.', cities: ['benin'] },
  ],
  ph: [
    { id: 'ph_oil_mill', name: 'Oil Mill Market', region: 'mainland', icon: '🛢️', x: 50, y: 55, tags: ['market'], blurb: 'Wednesday market madness — everything sells, everyone haggles.', cities: ['ph'] },
    { id: 'ph_gra', name: 'GRA Phase 2', region: 'island', icon: '🏘️', x: 68, y: 45, tags: ['residential'], blurb: 'Oil-company money lives here — quiet streets, loud generators.', cities: ['ph'] },
    { id: 'ph_uniport', name: 'Uniport Campus', region: 'mainland', icon: '🎓', x: 40, y: 35, tags: ['campus'], blurb: "Choba's finest — books, boats and big dreams.", cities: ['ph'] },
    { id: 'ph_stadium', name: 'Yakubu Gowon Stadium', region: 'mainland', icon: '⚽', x: 45, y: 65, tags: ['stadium'], blurb: 'Football fever every weekend — Sharks and Dolphins country.', cities: ['ph'] },
    { id: 'ph_creek_road', name: 'Creek Road Market', region: 'lagoon', icon: '🐟', x: 55, y: 70, tags: ['market', 'boat'], blurb: "Fresh catch from the creeks — the city's fish basket.", cities: ['ph'] },
    { id: 'ph_aba_road', name: 'Aba Road', region: 'mainland', icon: '🛣️', x: 58, y: 50, tags: ['motor_park'], blurb: 'The long commercial spine — spare parts, boutiques and bus parks.', cities: ['ph'] },
  ],
  abuja: [
    { id: 'abuja_eagle_square', name: 'Eagle Square', region: 'mainland', icon: '🦅', x: 50, y: 50, tags: ['landmark'], blurb: "Parades and national ceremonies — the capital's front yard.", cities: ['abuja'] },
    { id: 'abuja_wuse_market', name: 'Wuse Market', region: 'mainland', icon: '🧺', x: 45, y: 58, tags: ['market'], blurb: "The capital's bargain basement — fabrics, phones and food.", cities: ['abuja'] },
    { id: 'abuja_millennium_park', name: 'Millennium Park', region: 'island', icon: '🌳', x: 60, y: 62, tags: ['landmark'], blurb: "Picnics and proposals under the capital's biggest trees.", cities: ['abuja'] },
    { id: 'abuja_banex', name: 'Banex Plaza', region: 'mainland', icon: '💻', x: 55, y: 45, tags: ['tech_hub', 'office'], blurb: 'Wuse 2 tech plaza — laptops, phones and hustle in suits.', cities: ['abuja'] },
    { id: 'abuja_nyanya_park', name: 'Nyanya Motor Park', region: 'mainland', icon: '🚌', x: 38, y: 55, tags: ['motor_park'], blurb: 'The great eastern gateway — buses to everywhere, all night.', cities: ['abuja'] },
    { id: 'abuja_national_mosque', name: 'National Mosque', region: 'mainland', icon: '🕌', x: 52, y: 42, tags: ['landmark'], blurb: 'Golden dome on the skyline — the capital at prayer.', cities: ['abuja'] },
  ],
};

/** Flat list of every city-pack venue (Lagos venues live in data.js). */
export function allCityVenues() {
  return Object.values(CITY_VENUES).flat();
}

/** Find any venue by id across legacy + city packs. */
export function findVenue(id, legacyLocations) {
  const lid = String(id);
  const legacy = (legacyLocations || []).find((l) => l.id === lid);
  if (legacy) return legacy;
  return allCityVenues().find((l) => l.id === lid) || null;
}

/** Venues visible in a city: no `cities` array → everywhere; else must include the city. */
export function locationsForCity(locations, cityId) {
  const cid = cityId || 'lagos';
  return (locations || []).filter((l) => !l.cities || l.cities.includes(cid));
}

// ---------------- Per-city jobs ----------------
// Same shape as data.js JOBS; pay is already tuned per city.
export const CITY_JOBS = {
  benin: [
    { id: 'benin_bronze_apprentice', name: 'Bronze Caster Apprentice', locationId: 'benin_igue_ground', pay: 3500, energyCost: 30, cooldownSec: 60, icon: '🗿', path: 'craft', cities: ['benin'] },
    { id: 'benin_market_porter', name: 'Oba Market Porter', locationId: 'benin_oba_market', pay: 2800, energyCost: 25, cooldownSec: 30, icon: '🧺', path: 'market', cities: ['benin'] },
    { id: 'benin_campus_driver', name: 'Campus Shuttle Driver', locationId: 'benin_uniben', pay: 4200, energyCost: 30, cooldownSec: 90, icon: '🚐', path: 'transport', cities: ['benin'] },
  ],
  ph: [
    { id: 'ph_oil_assistant', name: 'Oil Servicing Assistant', locationId: 'ph_gra', pay: 9500, energyCost: 35, cooldownSec: 120, icon: '🛢️', path: 'corporate', cities: ['ph'] },
    { id: 'ph_fish_trader', name: 'Creek Fish Trader', locationId: 'ph_creek_road', pay: 6500, energyCost: 35, cooldownSec: 90, icon: '🐟', path: 'market', cities: ['ph'] },
    { id: 'ph_site_intern', name: 'Site Engineer Intern', locationId: 'ph_gra', pay: 8000, energyCost: 35, cooldownSec: 120, certRequired: true, icon: '🦺', path: 'corporate', cities: ['ph'] },
  ],
  abuja: [
    { id: 'abuja_ministry_clerk', name: 'Ministry Clerk', locationId: 'abuja_eagle_square', pay: 7500, energyCost: 30, cooldownSec: 120, certRequired: true, icon: '📋', path: 'corporate', cities: ['abuja'] },
    { id: 'abuja_phone_repairer', name: 'Plaza Phone Repairer', locationId: 'abuja_banex', pay: 6000, energyCost: 30, cooldownSec: 90, icon: '📱', path: 'market', cities: ['abuja'] },
    { id: 'abuja_park_attendant', name: 'Motor Park Attendant', locationId: 'abuja_nyanya_park', pay: 3200, energyCost: 25, cooldownSec: 60, icon: '🎫', path: 'transport', cities: ['abuja'] },
  ],
};

/** Jobs visible in a city: no `cities` array → everywhere; else must include the city. */
export function jobsForCity(jobs, cityId) {
  const cid = cityId || 'lagos';
  return (jobs || []).filter((j) => !j.cities || j.cities.includes(cid));
}

/** Flat list of every city-pack job. */
export function allCityJobs() {
  return Object.values(CITY_JOBS).flat();
}

// ---------------- Per-city flavor events ----------------
// Narrative flavor for the city packs (the Events feature has its own system;
// these are just the cultural beats each city is known for).
export const CITY_EVENTS = {
  lagos: [
    { name: 'Eyo Festival', blurb: 'White-clad processions through Lagos Island — the city at its most ceremonial.' },
    { name: 'Lagos Fashion Week', blurb: 'Runways, designers and street style — Africa’s fashion capital shows off.' },
  ],
  benin: [
    { name: 'Igue Festival', blurb: 'The Oba’s annual festival — bronze, coral beads and royal blessings.' },
    { name: 'Bronze Casting Exhibition', blurb: 'Master casters open their workshops — centuries of craft on display.' },
  ],
  ph: [
    { name: 'Bole & Fish Festival', blurb: 'Roasted plantain, fresh fish and music — Port Harcourt’s tastiest weekend.' },
    { name: 'Oil & Gas Career Fair', blurb: 'Energy majors recruit in the GRA — suits, CVs and big dreams.' },
  ],
  abuja: [
    { name: 'Abuja Carnival', blurb: 'States parade through Eagle Square — Nigeria in one long colourful line.' },
    { name: 'National Trade Fair', blurb: 'Exhibitors from every state — deals signed under the capital sun.' },
  ],
};

// ---------------- Inter-city travel ----------------
// Approximate road distances (km) between city pairs.
const CITY_KM = {
  'benin|lagos': 300,
  'lagos|ph': 610,
  'abuja|lagos': 750,
  'benin|ph': 280,
  'abuja|benin': 470,
  'abuja|ph': 560,
};

function cityDistanceKm(a, b) {
  if (a === b) return 0;
  return CITY_KM[`${a}|${b}`] ?? CITY_KM[`${b}|${a}`] ?? 500;
}

/**
 * Inter-city fare in game coins. Bus is cheap/slow, flight is expensive/fast.
 * Same city → 0 (callers should reject same-city trips outright).
 */
export function cityTravelFare(fromId, toId, mode) {
  const km = cityDistanceKm(fromId, toId);
  if (km === 0) return 0;
  if (mode === 'flight') return Math.round((4000 + 12 * km) / 100) * 100;
  return Math.round((800 + 4 * km) / 50) * 50; // bus (default)
}

/** Spawn venue id for a city (where travelers arrive / new characters start). */
export function citySpawn(cityId) {
  return getCity(cityId).spawn;
}

/** Spawn venue object (from city packs; Lagos spawn lives in data.js LOCATIONS). */
export function citySpawnVenue(cityId, legacyLocations) {
  const spawnId = citySpawn(cityId);
  return findVenue(spawnId, legacyLocations);
}
