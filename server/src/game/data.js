// ============================================================
// Èkó Life — server source-of-truth game data (M1)
// 100% ORIGINAL content. Locations, jobs, food, fun and housing
// are original riffs inspired by Lagos life — never copied from
// any reference product.
// ============================================================

// ---------------- Character classes ----------------
export const CLASSES = {
  silver_spoon: {
    id: 'silver_spoon',
    name: 'Silver Spoon',
    icon: '🥄',
    tagline: 'Born with a silver spoon. Soft life — but the hustle pays you a little less.',
    startMoney: 50000,
    housing: 'selfcon',
    happinessBonus: 10,
    payMult: 0.9,          // "soft life tax": jobs pay 10% less
    starterLoan: 0,
    perks: ['Start with ₦50,000', 'Own self-contain apartment', '+10 starting happiness', 'Jobs pay 10% less (soft-life tax)'],
  },
  street_smart: {
    id: 'street_smart',
    name: 'Street Smart',
    icon: '💪',
    tagline: 'Started from the bottom. Every hustle pays extra — nothing was handed to you.',
    startMoney: 5000,
    housing: 'face-me',
    happinessBonus: 0,
    payMult: 1.1,          // hustle bonus: jobs pay 10% more
    starterLoan: 10000,    // one-time starter loan (M2)
    perks: ['Start with ₦5,000', 'Face-me-I-face-you housing', 'Jobs pay 10% more (hustle bonus)', 'One-time ₦10,000 starter loan'],
  },
};

// ---------------- Locations (map coords x,y in 0..100) ----------------
// west = Mainland, center = Lagos Lagoon (water), east = Island.
// `tags` drive which actions are available: market / motor_park / campus /
// mall / bank / housing_office / hospital / office / tech_hub / beach /
// club / boat / stadium / residential / landmark.
export const LOCATIONS = [
  // ---- Mainland ----
  { id: 'ojuelegba', name: 'Ojuelegba Under-Bridge', region: 'mainland', icon: '🌉', x: 15, y: 62, tags: ['motor_park'], blurb: "The city's busiest roundabout — danfos, hawkers and 24/7 hustle." },
  { id: 'tejuosho', name: 'Tejuosho Market', region: 'mainland', icon: '🧺', x: 28, y: 55, tags: ['market'], blurb: 'Bargain paradise: fabrics, electronics, and Mama Put on every corner.' },
  { id: 'ikeja_mall', name: 'Ikeja City Mall', region: 'mainland', icon: '🏬', x: 38, y: 28, tags: ['mall'], blurb: 'Glass towers, cinemas and the coldest air-conditioning on the Mainland.' },
  { id: 'unilag', name: 'Unilag Campus', region: 'mainland', icon: '🎓', x: 46, y: 42, tags: ['campus'], blurb: "Akokites' kingdom — books by day, parties by night." },
  { id: 'oshodi', name: 'Oshodi Motor Park', region: 'mainland', icon: '🚌', x: 22, y: 70, tags: ['motor_park'], blurb: 'Danfo central. If you can hustle here, you can hustle anywhere.' },
  { id: 'surulere_stadium', name: 'Surulere Stadium', region: 'mainland', icon: '⚽', x: 20, y: 58, tags: ['stadium'], blurb: 'Football dreams are made here — street legends welcome.' },
  { id: 'mushin', name: 'Mushin Market', region: 'mainland', icon: '🍅', x: 30, y: 68, tags: ['market'], blurb: "Wholesale food hub — the city's giant kitchen pantry." },
  { id: 'alaba', name: 'Alaba Electronics', region: 'mainland', icon: '📺', x: 8, y: 55, tags: ['market'], blurb: "Nigeria's biggest electronics market — every gadget has a price." },
  { id: 'agege', name: 'Agege Bread Junction', region: 'mainland', icon: '🍞', x: 32, y: 22, tags: ['market'], blurb: 'Famous for hot Agege bread at dawn. Queue like your life depends on it.' },
  { id: 'ketu', name: 'Ketu Motor Park', region: 'mainland', icon: '🚐', x: 45, y: 58, tags: ['motor_park'], blurb: 'Gateway east — buses leave before the traffic wakes up.' },
  { id: 'kudi_row', name: 'Kudi Row Bank Street', region: 'mainland', icon: '🏦', x: 40, y: 48, tags: ['bank', 'office'], blurb: 'Glass banking halls and forex bureaus — money never sleeps here.' },
  { id: 'laspotech_gate', name: 'Lagos Poly Main Gate', region: 'mainland', icon: '🎓', x: 44, y: 36, tags: ['campus'], blurb: 'Polytechnic hustle: photocopy shops, handouts and shawarma stands.' },
  { id: 'yaba_hub', name: 'Yaba Tech Hub', region: 'mainland', icon: '💻', x: 42, y: 52, tags: ['tech_hub', 'office'], blurb: 'Startups in co-working lofts, laptops glowing past midnight.' },
  { id: 'housing_office_m', name: 'Mainland Housing Office', region: 'mainland', icon: '🏠', x: 36, y: 44, tags: ['housing_office'], blurb: 'Queue here to sign a new rental or change your apartment.' },
  { id: 'lasuth', name: 'Lasuth General Hospital', region: 'mainland', icon: '🏥', x: 33, y: 34, tags: ['hospital'], blurb: 'The big teaching hospital — always hiring orderlies and porters.' },
  { id: 'iyana_ipaja', name: 'Iyana Ipaja Park', region: 'mainland', icon: '🚐', x: 26, y: 18, tags: ['motor_park'], blurb: 'Rush-hour chaos with the best roadside puff-puff in the west.' },
  { id: 'dopemu_plaza', name: 'Dopemu Plaza', region: 'mainland', icon: '🛒', x: 24, y: 28, tags: ['market'], blurb: 'Compact market square — provisions, thrift clothes and tailors.' },
  { id: 'otigba_gadgets', name: 'Otigba Gadget Village', region: 'mainland', icon: '📱', x: 34, y: 30, tags: ['market'], blurb: 'Phone engineers on every stool — no screen is beyond repair.' },
  { id: 'abule_egba', name: 'Abule Egba Park', region: 'mainland', icon: '🚏', x: 18, y: 14, tags: ['motor_park'], blurb: 'Last stop before the expressway — buses load fast here.' },
  { id: 'ajegunle_arena', name: 'Ajegunle Arena', region: 'mainland', icon: '🥊', x: 10, y: 68, tags: ['stadium'], blurb: 'Grassroots boxing and street football — champions are born here.' },
  { id: 'ajanaku_night', name: 'Ajanaku Night Market', region: 'mainland', icon: '🌙', x: 14, y: 74, tags: ['market'], blurb: 'Opens when others close — lanterns, pepper soup and late deals.' },
  { id: 'ikeja_underbridge', name: 'Ikeja Under-Bridge Food Court', region: 'mainland', icon: '🍲', x: 36, y: 32, tags: ['market'], blurb: 'Steam, spice and sizzling grills under the flyover.' },
  { id: 'ogba_market', name: 'Ogba Market', region: 'mainland', icon: '🥬', x: 30, y: 12, tags: ['market'], blurb: 'Fresh produce at dawn prices — the early bird eats well.' },
  { id: 'berger_park', name: 'Berger Park', region: 'mainland', icon: '🚌', x: 40, y: 16, tags: ['motor_park'], blurb: 'Interstate buses and big dreams, departing every few minutes.' },
  { id: 'mende_villa', name: 'Mende Villa Estate', region: 'mainland', icon: '🏘️', x: 44, y: 26, tags: ['residential'], blurb: 'Quiet bungalows behind high fences — middle-class calm.' },
  { id: 'shomolu_press', name: 'Shomolu Press Quarter', region: 'mainland', icon: '📰', x: 36, y: 56, tags: ['office'], blurb: 'Printing presses and newspaper houses running all night.' },
  { id: 'bariga_waterfront', name: 'Bariga Waterfront', region: 'mainland', icon: '🌅', x: 48, y: 50, tags: ['landmark'], blurb: 'Where the city ends and the lagoon begins — golden hour views.' },
  { id: 'gbagada_estate', name: 'Gbagada Estate', region: 'mainland', icon: '🏘️', x: 46, y: 54, tags: ['residential'], blurb: 'Leafy duplex streets a stone’s throw from the water.' },
  { id: 'ojota_park', name: 'Ojota Park', region: 'mainland', icon: '🚐', x: 42, y: 62, tags: ['motor_park'], blurb: 'The eastbound interchange — every danfo passes through here.' },
  { id: 'anthony_village', name: 'Anthony Village', region: 'mainland', icon: '🏘️', x: 40, y: 66, tags: ['residential'], blurb: 'Old-money neighbourhood with legendary street parties.' },
  // ---- Lagoon ----
  { id: 'third_mainland', name: 'Third Mainland Bridge', region: 'lagoon', icon: '🌁', x: 52, y: 50, tags: ['landmark'], blurb: "11.8 km of asphalt over water — Lagos's famous traffic postcard." },
  { id: 'makoko', name: 'Makoko Floating Village', region: 'lagoon', icon: '🛶', x: 47, y: 40, tags: ['residential'], blurb: 'Stilt houses on the lagoon — the Venice of Lagos.' },
  { id: 'ebute_metta', name: 'Ebute Metta Jetty', region: 'lagoon', icon: '⛴️', x: 55, y: 58, tags: ['boat', 'market'], blurb: 'Ferry dock linking the Mainland to the Island.' },
  { id: 'carter_bridge', name: 'Carter Bridge', region: 'lagoon', icon: '🌉', x: 50, y: 64, tags: ['landmark'], blurb: 'Old steel bridge with sunset views and fish sellers at its foot.' },
  { id: 'lagos_yacht', name: 'Lagos Yacht Wharf', region: 'lagoon', icon: '🛥️', x: 57, y: 52, tags: ['boat'], blurb: 'White sails and weekend sailors — the lagoon’s luxury side.' },
  { id: 'falomo_jetty', name: 'Falomo Jetty', region: 'lagoon', icon: '⛴️', x: 49, y: 56, tags: ['boat'], blurb: 'Quick ferries to the Island — beat the traffic, ride the waves.' },
  { id: 'ikorodu_view', name: 'Ikorodu Lagoon View', region: 'lagoon', icon: '🌅', x: 54, y: 46, tags: ['landmark'], blurb: 'Fishermen’s canoes drifting past at sunrise.' },
  { id: 'waterways_terminal', name: 'Waterways Terminal', region: 'lagoon', icon: '⚓', x: 51, y: 60, tags: ['boat', 'office'], blurb: 'The lagoon bus station — timetables, tickets and tannoy calls.' },
  { id: 'oworo_jetty', name: 'Oworo Jetty', region: 'lagoon', icon: '🛶', x: 58, y: 60, tags: ['boat'], blurb: 'A sleepy dock where canoe men haggle over fares.' },
  { id: 'apapa_wharf', name: 'Apapa Cargo Wharf', region: 'lagoon', icon: '🚢', x: 48, y: 70, tags: ['boat', 'landmark'], blurb: 'Container ships on the horizon — the port that feeds the city.' },
  // ---- Island ----
  { id: 'lekki_beach', name: 'Lekki Beach', region: 'island', icon: '🏖️', x: 80, y: 75, tags: ['beach'], blurb: 'Palm trees, sea breeze and weekend owambe energy.' },
  { id: 'palms_mall', name: 'Palms Shopping Mall', region: 'island', icon: '🛍️', x: 72, y: 60, tags: ['mall'], blurb: 'Victoria Island retail therapy — window shopping counts too.' },
  { id: 'tinubu_sq', name: 'Tinubu Square', region: 'island', icon: '🏛️', x: 64, y: 62, tags: ['market'], blurb: 'Historic commercial heart of old Lagos.' },
  { id: 'ikoyi', name: 'Ikoyi Golf Estate', region: 'island', icon: '⛳', x: 70, y: 50, tags: ['residential'], blurb: 'Quiet streets, big gates, bigger money.' },
  { id: 'elegushi', name: 'Elegushi Beach', region: 'island', icon: '🌊', x: 88, y: 80, tags: ['beach', 'club'], blurb: 'Nightlife beach — music plays till mama calls.' },
  { id: 'ajah', name: 'Ajah Market', region: 'island', icon: '🛒', x: 85, y: 55, tags: ['market'], blurb: 'Fast-growing market town on the Lekki axis.' },
  { id: 'obalende', name: 'Obalende Suya Spot', region: 'island', icon: '🍢', x: 62, y: 58, tags: ['market'], blurb: 'Legendary suya grills and late-night crowds.' },
  { id: 'cms_marina', name: 'CMS Marina', region: 'island', icon: '⚓', x: 58, y: 66, tags: ['boat', 'bank'], blurb: 'Colonial-era waterfront — boats, banks and old Lagos.' },
  { id: 'eko_atlantic', name: 'Eko Atlantic', region: 'island', icon: '🏗️', x: 75, y: 85, tags: ['residential', 'landmark'], blurb: 'The rising new city on reclaimed ocean land.' },
  { id: 'tarkwa_bay', name: 'Tarkwa Bay', region: 'island', icon: '🏝️', x: 60, y: 85, tags: ['beach', 'boat'], blurb: 'Hidden island beach reachable only by boat.' },
  { id: 'housing_office_i', name: 'Island Housing Office', region: 'island', icon: '🏠', x: 74, y: 64, tags: ['housing_office'], blurb: 'Sign leases with a sea view — Island rents, Island standards.' },
  { id: 'vgc_banks', name: 'VGC Banking District', region: 'island', icon: '🏦', x: 82, y: 62, tags: ['bank', 'office'], blurb: 'Marble lobbies and glass towers — corporate Lagos at full shine.' },
  { id: 'lekki_nature', name: 'Lekki Nature Walk', region: 'island', icon: '🌳', x: 84, y: 70, tags: ['landmark'], blurb: 'Canopy walkway through the last green forest on the Island.' },
  { id: 'club_kasanova', name: 'Club Kasanova', region: 'island', icon: '🪩', x: 78, y: 78, tags: ['club'], blurb: 'Bottles, bass and velvet ropes — the Island never truly sleeps.' },
  { id: 'oniru_strip', name: 'Oniru Sand Strip', region: 'island', icon: '🏖️', x: 82, y: 82, tags: ['beach'], blurb: 'A quieter stretch of sand for slow Sunday afternoons.' },
  { id: 'admiralty_food', name: 'Admiralty Food Street', region: 'island', icon: '🍜', x: 70, y: 66, tags: ['market'], blurb: 'Street-food row: shawarma, grills and fresh juice bars.' },
  { id: 'ikate_night', name: 'Ikate Night Market', region: 'island', icon: '🌙', x: 68, y: 72, tags: ['market', 'club'], blurb: 'Boutique stalls by day, open-air lounges by night.' },
  { id: 'osapa_junction', name: 'Osapa Junction', region: 'island', icon: '🚏', x: 86, y: 48, tags: ['motor_park'], blurb: 'Buses and kekes fan out across the Lekki corridor.' },
  { id: 'sangotedo_tech', name: 'Sangotedo Tech Park', region: 'island', icon: '💻', x: 88, y: 52, tags: ['tech_hub', 'office'], blurb: 'Fintech offices and startup garages along the expressway.' },
  { id: 'badore_jetty', name: 'Badore Jetty', region: 'island', icon: '⛴️', x: 90, y: 60, tags: ['boat'], blurb: 'Speedboats to the far beaches — lifejackets on, hold tight.' },
  { id: 'chevron_drive', name: 'Chevron Drive Offices', region: 'island', icon: '🏢', x: 84, y: 58, tags: ['office'], blurb: 'Corporate towers humming with air-conditioning and ambition.' },
  { id: 'etiosa_poly', name: 'Eti-Osa Polytechnic', region: 'island', icon: '🎓', x: 76, y: 56, tags: ['campus'], blurb: 'Island-side lectures with a sea breeze through the windows.' },
  { id: 'victoria_hospital', name: 'Victoria Court Hospital', region: 'island', icon: '🏥', x: 72, y: 54, tags: ['hospital'], blurb: 'Private wards, polished floors and top-tier care.' },
  { id: 'marina_court', name: 'Marina Courthouse', region: 'island', icon: '⚖️', x: 60, y: 64, tags: ['office'], blurb: 'Wigs, gavels and long queues — justice moves at its own pace.' },
  { id: 'agungi_round', name: 'Agungi Roundabout', region: 'island', icon: '🚏', x: 86, y: 64, tags: ['motor_park'], blurb: 'Keke riders swarm the roundabout at every rush hour.' },
  { id: 'ikota_complex', name: 'Ikota Shopping Complex', region: 'island', icon: '🛍️', x: 88, y: 68, tags: ['mall'], blurb: 'Boutiques and cinemas stacked over five floors.' },
  { id: 'jakande_gate', name: 'Jakande Estate Gate', region: 'island', icon: '🏘️', x: 80, y: 52, tags: ['residential'], blurb: 'Classic estate living — security gates and mango trees.' },
  { id: 'vi_skyline', name: 'VI Skyline Towers', region: 'island', icon: '🏙️', x: 66, y: 56, tags: ['office'], blurb: 'Corner offices with lagoon views and corner-office egos.' },
];

export const SPAWN = 'ojuelegba';
export const WORLD_BOUNDS = { xMin: 0, xMax: 100, yMin: 0, yMax: 100 };

// ---------------- Jobs ----------------
export const JOBS = [
  { id: 'market_porter', name: 'Market Porter', locationId: 'tejuosho', pay: 2500, energyCost: 25, cooldownSec: 30, icon: '🧺', path: 'market' },
  { id: 'danfo_conductor', name: 'Danfo Conductor', locationId: 'oshodi', pay: 3200, energyCost: 30, cooldownSec: 60, icon: '🚌', path: 'transport' },
  { id: 'shop_assistant', name: 'Shop Assistant', locationId: 'ikeja_mall', pay: 4000, energyCost: 25, cooldownSec: 45, icon: '🏬', path: 'corporate' },
  { id: 'beach_lifeguard', name: 'Beach Lifeguard', locationId: 'lekki_beach', pay: 3800, energyCost: 30, cooldownSec: 60, icon: '🛟', path: 'leisure' },
  { id: 'lounge_barista', name: 'Lounge Barista', locationId: 'palms_mall', pay: 5500, energyCost: 30, cooldownSec: 90, icon: '☕', path: 'corporate' },
  { id: 'junior_dev', name: 'Junior Dev Intern', locationId: 'ikoyi', pay: 8000, energyCost: 35, cooldownSec: 120, certRequired: true, icon: '💻', path: 'corporate' },
  { id: 'bank_teller', name: 'Bank Teller', locationId: 'kudi_row', pay: 9000, energyCost: 35, cooldownSec: 120, certRequired: true, icon: '🏦', path: 'corporate' },
  { id: 'hospital_orderly', name: 'Hospital Orderly', locationId: 'lasuth', pay: 4500, energyCost: 30, cooldownSec: 60, icon: '🏥', path: 'service' },
  { id: 'market_trader', name: 'Market Trader', locationId: 'mushin', pay: 7000, energyCost: 35, cooldownSec: 120, icon: '💰', path: 'market' },
  { id: 'campus_tutor', name: 'Campus Tutor', locationId: 'unilag', pay: 6000, energyCost: 25, cooldownSec: 90, certRequired: true, icon: '📚', path: 'campus' },
];

// ---------------- Food ----------------
export const FOOD = [
  { id: 'mama_put', name: 'Mama Put Plate', cost: 800, hunger: 35, energy: 10, happy: 5, icon: '🍲' },
  { id: 'agege_bread', name: 'Agege Bread & Beans', cost: 500, hunger: 22, energy: 8, happy: 3, icon: '🍞' },
  { id: 'suya', name: 'Suya & Sides', cost: 1500, hunger: 30, energy: 5, happy: 10, icon: '🍢' },
  { id: 'ofada', name: 'Ofada & Ayamase', cost: 1800, hunger: 45, energy: 10, happy: 6, icon: '🍛' },
  { id: 'shawarma', name: 'Chicken Shawarma', cost: 2200, hunger: 40, energy: 15, happy: 8, icon: '🌯' },
];

// ---------------- Fun ----------------
export const FUN = [
  { id: 'beach_day', name: 'Beach Day', cost: 1000, happy: 20, energyDelta: -10, locationId: 'lekki_beach', icon: '🏖️' },
  { id: 'owambe', name: 'Owambe Party', cost: 1500, happy: 25, energyDelta: -5, locationId: 'surulere_stadium', icon: '🎉' },
  { id: 'arcade', name: 'Arcade Hour', cost: 1200, happy: 18, energyDelta: -5, locationId: 'ikeja_mall', icon: '🕹️' },
  { id: 'cinema', name: 'Cinema Night', cost: 2500, happy: 30, energyDelta: 0, locationId: 'ikeja_mall', icon: '🎬' },
  { id: 'club_night', name: 'Club Night', cost: 3000, happy: 35, energyDelta: -15, locationId: 'club_kasanova', icon: '🪩' },
];

// ---------------- Housing (rent per game day) ----------------
export const HOUSING = {
  face_me: { id: 'face_me', name: 'Face-me-I-face-you', rent: 5000, icon: '🏘️' },
  selfcon: { id: 'selfcon', name: 'Self-Contain', rent: 12000, icon: '🏠' },
  flat:    { id: 'flat', name: '2-Bedroom Flat', rent: 25000, icon: '🏡' },
  duplex:  { id: 'duplex', name: 'Duplex', rent: 60000, icon: '🏰' },
  // Eviction fallback: no rent, no comfort. Never listed as a rentable option.
  bridge:  { id: 'bridge', name: 'Under the Bridge', rent: 0, icon: '🌉' },
};

// ---------------- Owned properties (one per player) ----------------
// Buy once, keep forever. No rent — instead a daily happiness bonus
// applied in the day tick. Replacing = no refund (kept simple).
export const PROPERTIES = {
  selfcon_own:  { id: 'selfcon_own',  name: 'Owned Self-Contain',  price: 250000,  happy: 5,  icon: '🏠' },
  bungalow_own: { id: 'bungalow_own', name: 'Owned Bungalow',      price: 600000,  happy: 8,  icon: '🏡' },
  flat_own:     { id: 'flat_own',     name: 'Owned 2-Bedroom Flat', price: 1200000, happy: 10, icon: '🏘️' },
  duplex_own:   { id: 'duplex_own',   name: 'Owned Duplex',        price: 3000000, happy: 15, icon: '🏰' },
};

// ---------------- Businesses (one per player, income lands per game day) ----------------
// ROI decays with scale: small hustles pay proportionally better.
export const BIZ = {
  mamaput:  { id: 'mamaput',  name: 'Mama Put Spot', cost: 50000,  income: 4000,  icon: '🍲' },
  carwash:  { id: 'carwash',  name: 'Car Wash Hub',  cost: 80000,  income: 6000,  icon: '🚗' },
  boutique: { id: 'boutique', name: 'Boutique',      cost: 150000, income: 10000, icon: '👗' },
  lounge:   { id: 'lounge',   name: 'Lounge & Bar',  cost: 400000, income: 25000, icon: '🍾' },
};

// ---------------- Vehicles (speed multiplier feeds the move anti-cheat) ----------------
export const VEHICLES = {
  none: { id: 'none', name: 'Trek (on foot)', cost: 0,      mult: 1,   icon: '🚶' },
  keke: { id: 'keke', name: 'Keke Napep',      cost: 80000,  mult: 1.6, icon: '🛺' },
  car:  { id: 'car',  name: 'Toyota Camry',    cost: 300000, mult: 2.2, icon: '🚗' },
};

// ---------------- Furniture ----------------
// Buy into inventory, place up to HOME_SLOTS at home. Placed items feed
// gameplay effect hooks (see FURN_EFFECTS) instead of being decoration.
export const FURN = {
  bed:    { id: 'bed',    name: 'Comfy Bed',       price: 15000, icon: '🛏️', effect: 'sleep_health', desc: 'Sleep restores +20 extra health' },
  fridge: { id: 'fridge', name: 'Fridge',          price: 20000, icon: '🧊', effect: 'eat_hunger',   desc: 'Eating restores +15 extra hunger' },
  tv:     { id: 'tv',     name: 'Flat-screen TV',  price: 25000, icon: '📺', effect: 'fun_happy',    desc: 'Fun gives +10 extra happiness' },
  sofa:   { id: 'sofa',   name: 'Sofa Set',        price: 18000, icon: '🛋️', effect: 'fun_happy',    desc: 'Fun gives +8 extra happiness' },
  gen:    { id: 'gen',    name: 'Generator',       price: 30000, icon: '🔌', effect: 'daily_happy',  desc: '+5 happiness every game day (no more "up NEPA")' },
  ac:     { id: 'ac',     name: 'Air Conditioner', price: 45000, icon: '❄️', effect: 'sleep_happy',  desc: 'Sleep restores +10 extra happiness' },
};
export const HOME_SLOTS = 6;

// Placed-furniture effect hooks consumed by actions/day tick.
// gen is the only daily one; the rest trigger inside eat/fun/sleep.
export const FURN_EFFECTS = {
  bed:    { sleep: { health: 20 } },
  fridge: { eat: { hunger: 15 } },
  tv:     { fun: { happiness: 10 } },
  sofa:   { fun: { happiness: 8 } },
  ac:     { sleep: { happiness: 10 } },
  gen:    { day: { happiness: 5 } },
};

// ---------------- Bank & economy rates ----------------
export const BANK = {
  savingsRate: 0.02,   // +2% of savings per game day (floored)
  loanRate: 0.10,      // +10% of loan per game day (ceiled)
  loanMax: 100000,     // max single loan; none allowed while one is outstanding
};

// M4: one-time street_smart starter loan — exactly ₦10,000 at 0% interest.
export const STARTER_LOAN_AMOUNT = 10000;

// ---------------- Travel fares (per trip) ----------------
export const TRAVEL_FARES = {
  sameRegion: 0,   // moving within mainland / lagoon / island
  crossRegion: 200, // mainland ↔ island ("danfo fare")
  boat: 500,       // any trip touching the lagoon region
};

// ---------------- Study ----------------
export const STUDY_COST = 5000; // cost of a study session; grants a cert

// ---------------- Street finds (spawns) ----------------
export const SPAWN_TTL_MS = 3 * 60 * 1000; // spawns expire after 3 minutes
export const COLLECT_RADIUS = 4;           // map units (coords are 0–100)
export const SPAWN_KINDS = [
  { kind: 'cash',   icon: '💵', w: 50 },
  { kind: 'snack',  icon: '🍲', w: 25 },
  { kind: 'energy', icon: '🥤', w: 25 },
];

// ---------------- Move anti-cheat ----------------
export const MOVE_BASE_SPEED = 8; // map units per second on foot (× vehicle mult)

// ---------------- Character customization allowlists ----------------
export const AVATARS = ['🧑', '👩', '👨', '🧔', '👩‍🦰', '🧑‍🦱', '👩‍🦱', '🧓', '👵', '🤠', '😎', '🦸', '👷', '🧕'];
export const COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#fbbf24', '#c084fc', '#fb7185', '#34d399', '#60a5fa'];

// ---------------- Chat profanity filter (same approach as prior art) ----------------
export const BAD_WORDS = ['fuck', 'shit', 'bitch', 'nigga', 'nigger', 'dick', 'pussy', 'asshole', 'bastard', 'whore', 'slut'];

export function cleanText(text, maxLen = 200) {
  let t = String(text || '').trim().slice(0, maxLen);
  for (const w of BAD_WORDS) t = t.replace(new RegExp(w, 'gi'), '***');
  return t;
}

// ---------------- Character factory (single source of truth for defaults) ----------------
export function DEFAULT_CHARACTER(classId = 'street_smart', displayName = 'Player') {
  const c = CLASSES[classId] || CLASSES.street_smart;
  const spawn = LOCATIONS.find(l => l.id === SPAWN) || LOCATIONS[0];
  return {
    name: String(displayName || 'Player').slice(0, 32),
    class: c.id,
    avatar: '🧑',
    color: '#22d3ee',
    money: c.startMoney,
    energy: 100,
    health: 100,
    happiness: Math.min(100, 60 + (c.happinessBonus || 0)),
    hunger: 100,
    // V2: six needs (M8), shifts (M7), perks (M9), rent-to-own (M10), skills (M12)
    fun: 100,
    social: 100,
    hygiene: 100,
    bladder: 100,
    shift_job: null,
    shift_started_at: null,
    shift_ends_at: null,
    perk_stars: 0,
    perks: '[]',
    housing_owned: 0,
    skills: null,
    skills_used: null,
    housing: c.housing,
    property: 'none',
    vehicle: 'none',
    biz: null,
    savings: 0,
    loan: 0,
    cert: 0,
    location_id: SPAWN,
    x: spawn.x,
    y: spawn.y,
    rent_misses: 0,
    customized: 0,
    starter_loan_available: 0,
    loan_free: 0,
  };
}

// Game-day length (ms) — M1: day ticker only, full sim lands in M2
export const DAY_MS = 5 * 60 * 1000;
