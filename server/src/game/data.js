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
  bed:    { id: 'bed',    name: 'Comfy Bed',       price: 15000, icon: '🛏️', effect: 'sleep_health', desc: 'Sleep restores +20 extra health', category: 'sleep',   size: [2, 1] },
  fridge: { id: 'fridge', name: 'Fridge',          price: 20000, icon: '🧊', effect: 'eat_hunger',   desc: 'Eating restores +15 extra hunger', category: 'kitchen', size: [1, 1] },
  tv:     { id: 'tv',     name: 'Flat-screen TV',  price: 25000, icon: '📺', effect: 'fun_happy',    desc: 'Fun gives +10 extra happiness', category: 'comfort', size: [2, 1] },
  sofa:   { id: 'sofa',   name: 'Sofa Set',        price: 18000, icon: '🛋️', effect: 'fun_happy',    desc: 'Fun gives +8 extra happiness', category: 'comfort', size: [2, 1] },
  gen:    { id: 'gen',    name: 'Generator',       price: 30000, icon: '🔌', effect: 'daily_happy',  desc: '+5 happiness every game day (no more "up NEPA")', category: 'comfort', size: [1, 1] },
  ac:     { id: 'ac',     name: 'Air Conditioner', price: 45000, icon: '❄️', effect: 'sleep_happy',  desc: 'Sleep restores +10 extra happiness', category: 'comfort', size: [1, 1] },
  // M14: buy-mode catalogue expansion — category + 2D grid footprint (size: [w, d] cells on the 6×6 home grid)
  mattress:     { id: 'mattress',     name: 'Sturdy Mattress', price: 3000,  icon: '🛏️', effect: 'sleep_health', desc: 'Sleep restores +8 extra health', category: 'sleep',   size: [2, 1] },
  cooler:       { id: 'cooler',       name: 'Party Cooler',    price: 2500,  icon: '🧊', effect: 'eat_hunger',   desc: 'Eating restores +5 extra hunger', category: 'kitchen', size: [1, 1] },
  stove:        { id: 'stove',        name: 'Gas Stove',       price: 8000,  icon: '🍳', effect: 'eat_hunger',   desc: 'Eating restores +10 extra hunger', category: 'kitchen', size: [1, 1] },
  dining_table: { id: 'dining_table', name: 'Dining Table',    price: 6600,  icon: '🍽️', effect: 'eat_hunger',   desc: 'Eating restores +8 extra hunger', category: 'kitchen', size: [2, 1] },
  drum:         { id: 'drum',         name: 'Water Drum',      price: 1500,  icon: '🛢️', effect: 'day_happy',    desc: '+2 happiness every game day', category: 'bath',    size: [1, 1] },
  mirror:       { id: 'mirror',       name: 'Standing Mirror', price: 4000,  icon: '🪞', effect: 'day_happy',    desc: '+2 happiness every game day', category: 'bath',    size: [1, 1] },
  plastic_chair:{ id: 'plastic_chair',name: 'Plastic Chair',   price: 500,   icon: '🪑', effect: 'fun_happy',    desc: 'Fun gives +2 extra happiness', category: 'comfort', size: [1, 1] },
  fan:          { id: 'fan',          name: 'Standing Fan',    price: 2200,  icon: '🌀', effect: 'sleep_happy',  desc: 'Sleep restores +5 extra happiness', category: 'comfort', size: [1, 1] },
  beanbag:      { id: 'beanbag',      name: 'Bean Bag',        price: 12000, icon: '🟠', effect: 'fun_happy',    desc: 'Fun gives +6 extra happiness', category: 'comfort', size: [1, 1] },
  bookshelf:    { id: 'bookshelf',    name: 'Bookshelf',       price: 9000,  icon: '📚', effect: 'fun_happy',    desc: 'Fun gives +4 extra happiness', category: 'comfort', size: [1, 1] },
};
export const HOME_SLOTS = 6;

// Placed-furniture effect hooks consumed by actions/day tick.
// sleep/eat/fun trigger inside those actions (aggregated by
// furnitureEffects()); day hooks are consumed by applyDayEconomy()
// from each placed item's `day` key (gen/drum/mirror).
export const FURN_EFFECTS = {
  bed:    { sleep: { health: 20 } },
  fridge: { eat: { hunger: 15 } },
  tv:     { fun: { happiness: 10 } },
  sofa:   { fun: { happiness: 8 } },
  ac:     { sleep: { happiness: 10 } },
  gen:    { day: { happiness: 5 } },
  // M14: hooks for the expanded catalogue
  mattress:      { sleep: { health: 8 } },
  cooler:        { eat: { hunger: 5 } },
  stove:         { eat: { hunger: 10 } },
  dining_table:  { eat: { hunger: 8 } },
  drum:          { day: { happiness: 2 } },
  mirror:        { day: { happiness: 2 } },
  plastic_chair: { fun: { happiness: 2 } },
  fan:           { sleep: { happiness: 5 } },
  beanbag:       { fun: { happiness: 6 } },
  bookshelf:     { fun: { happiness: 4 } },
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
    // M15: avatar look (JSON text) + home style ids
    avatar_look: null,
    home_wall: null,
    home_floor: null,
  };
}

// Game-day length (ms) — M1: day ticker only, full sim lands in M2
export const DAY_MS = 5 * 60 * 1000;

// ============================================================
// M15: avatar + home-style customization (100% original content)
// AvatarLook = { body:'woman'|'man', skin, hair, outfit, fabric,
//                topColor, bottomColor } — stored on the character
// as JSON text (c.avatar_look); home_wall / home_floor are style ids.
// ============================================================

export const AVATAR_BODIES = [
  { id: 'woman', name: 'Woman' },
  { id: 'man', name: 'Man' },
];

export const AVATAR_SKINS = [
  { id: 'deep_espresso', name: 'Deep Espresso', hex: '#3b2314' },
  { id: 'dark_cocoa',    name: 'Dark Cocoa',    hex: '#4a2c17' },
  { id: 'burnt_caramel', name: 'Burnt Caramel', hex: '#5d3a1f' },
  { id: 'mahogany',      name: 'Mahogany',      hex: '#6f4426' },
  { id: 'walnut',        name: 'Walnut',        hex: '#7d5330' },
  { id: 'cocoa',         name: 'Cocoa',         hex: '#8a5f38' },
  { id: 'coffee',        name: 'Coffee',        hex: '#9a6f45' },
  { id: 'latte',         name: 'Latte',         hex: '#ab8054' },
  { id: 'honey',         name: 'Honey',         hex: '#bc9066' },
  { id: 'sand',          name: 'Sand',          hex: '#cda077' },
  { id: 'amber',         name: 'Amber',         hex: '#dcb07e' },
  { id: 'cream',         name: 'Cream',         hex: '#e8cfa3' },
];

export const AVATAR_HAIRS = [
  { id: 'lowcut',  name: 'Low cut' },
  { id: 'bald',    name: 'Bald' },
  { id: 'curls',   name: 'Curls' },
  { id: 'afro',    name: 'Afro' },
  { id: 'locs',    name: 'Locs' },
  { id: 'braids',  name: 'Braids' },
  { id: 'classic', name: 'Classic' },
  { id: 'hair_taper_fade_01', name: 'Taper fade' },
  { id: 'hair_waves_01',      name: 'Waves' },
];
// v1 slots (served via /api/avatar/catalog; validated by game/appearance.js).
export const AVATAR_HAIR_COLORS = [
  { id: 'hair_black_01',      name: 'Black',      hex: '#171110' },
  { id: 'hair_dark_brown_01', name: 'Dark brown', hex: '#3b2417' },
  { id: 'hair_brown_01',      name: 'Brown',      hex: '#5b3a21' },
];
export const AVATAR_FACIAL_HAIRS = [
  { id: 'facialhair_none_01',     name: 'None' },
  { id: 'facialhair_mustache_01', name: 'Light mustache' },
  { id: 'facialhair_goatee_01',   name: 'Mustache + chin goatee' },
  { id: 'facialhair_beard_short_01', name: 'Short boxed beard' },
];

export const AVATAR_OUTFITS = [
  { id: 'casual',   name: 'Casual' },
  { id: 'hoodie',   name: 'Hoodie' },
  { id: 'office',   name: 'Office' },
  { id: 'chill',    name: 'Chill' },
  { id: 'sitework', name: 'Site work' },
];

/* ------------------------------------------------------------------ */
/* Phase 6: Boutique — premium outfits bought with gameplay coins.     */
/* Each item maps to a renderer OutfitId (see                        */
/* web/src/views/avatar/parts/clothing.ts) with distinct procedural   */
/* geometry. The decomposition mirrors the client's OUTFIT_ROWS so    */
/* the server can invert a saved v1 clothing block to its outfit and  */
/* enforce wardrobe ownership on avatar saves.                        */
/* ------------------------------------------------------------------ */

export const BOUTIQUE_ITEMS = [
  { id: 'bq_senator',    outfitId: 'senator',    name: 'Senator Set',         price: 85000,   occasion: 'traditional', blurb: 'Knee-length embroidered tunic with gold chest embroidery. Boardroom to owambe, no changing room needed.' },
  { id: 'bq_dashiki',    outfitId: 'dashiki',    name: 'Dashiki Royale',      price: 45000,   occasion: 'traditional', blurb: 'Relaxed dashiki with a bold embroidered V. Heritage you can feel.' },
  { id: 'bq_kaftan',     outfitId: 'kaftan',     name: 'Kaftan Luxe',         price: 120000,  occasion: 'traditional', blurb: 'Ankle-length flowing kaftan with a hand-finished neckline. Effortless grace.' },
  { id: 'bq_adire_gown', outfitId: 'adire_gown', name: 'Adire Gown',          price: 150000,  occasion: 'owambe',      blurb: 'Floor-length adire gown on a fitted bodice. The entrance makes itself.' },
  { id: 'bq_ankara_set', outfitId: 'ankara_set', name: 'Ankara Two-Piece',    price: 95000,   occasion: 'owambe',      blurb: 'Fitted ankara top over a wrapper skirt. Print game: undefeated.' },
  { id: 'bq_asoebi',     outfitId: 'asoebi',     name: 'Aso-Ebi Glam',        price: 250000,  occasion: 'owambe',      blurb: 'Peplum party dress with a flared ruffle. For when the gele has to sit right.' },
  { id: 'bq_tuxedo',     outfitId: 'tuxedo',     name: 'Black Tie Tuxedo',    price: 550000,  occasion: 'office',      blurb: 'Sharp tuxedo, bow tie, peaked lapels. The deal closes itself.' },
  { id: 'bq_suit',       outfitId: 'suit',       name: 'Executive Suit',      price: 350000,  occasion: 'office',      blurb: 'Tailored two-piece with notch lapels. Corner-office energy.' },
  { id: 'bq_streetwear', outfitId: 'streetwear', name: 'Streetwear Drop',     price: 60000,   occasion: 'street',      blurb: 'Oversized hoodie, cargo, and a chain. Limited-drop attitude, everyday price.' },
  { id: 'bq_denim',      outfitId: 'denim',      name: 'Denim Culture',       price: 75000,   occasion: 'street',      blurb: 'Denim trucker jacket over clean jeans. Never out of season.' },
  { id: 'bq_sport_luxe', outfitId: 'sport_luxe', name: 'Sport Luxe Tracksuit', price: 55000,  occasion: 'street',      blurb: 'Zip-up track jacket and track pants. Athleisure, but make it luxury.' },
  { id: 'bq_royalty',    outfitId: 'royalty',    name: 'Royalty Agbada',      price: 1800000, occasion: 'traditional', blurb: 'Grand royal boubou with heavy gold embroidery and a sternum medallion. For thrones, not queues.' },
];

/** Decompositions mirror web/src/views/avatar/editor/catalog.ts OUTFIT_ROWS. */
export const BOUTIQUE_DECOMPOSITION = {
  senator:    { topId: 'top_agbada_01',       bottomId: 'bottom_trouser_01', outerwearId: null,               shoeId: 'shoe_oxford_01' },
  dashiki:    { topId: 'top_tee_01',          bottomId: 'bottom_trouser_01', outerwearId: null,               shoeId: 'shoe_sandal_01' },
  kaftan:     { topId: 'top_agbada_01',       bottomId: 'bottom_skirt_01',   outerwearId: null,               shoeId: 'shoe_sandal_01' },
  adire_gown: { topId: 'top_dress_01',        bottomId: 'bottom_skirt_01',   outerwearId: null,               shoeId: 'shoe_sneaker_01' },
  ankara_set: { topId: 'top_dress_01',        bottomId: 'bottom_skirt_01',   outerwearId: null,               shoeId: 'shoe_sandal_01' },
  asoebi:     { topId: 'top_dress_01',        bottomId: 'bottom_short_01',   outerwearId: null,               shoeId: 'shoe_heel_01' },
  tuxedo:     { topId: 'top_shirt_office_01', bottomId: 'bottom_cargo_01',   outerwearId: null,               shoeId: 'shoe_oxford_01' },
  suit:       { topId: 'top_tee_01',          bottomId: 'bottom_trouser_01', outerwearId: null,               shoeId: 'shoe_oxford_01' },
  streetwear: { topId: 'top_tee_01',          bottomId: 'bottom_cargo_01',   outerwearId: null,               shoeId: 'shoe_sneaker_01' },
  denim:      { topId: 'top_tank_01',         bottomId: 'bottom_trouser_01', outerwearId: null,               shoeId: 'shoe_sneaker_01' },
  sport_luxe: { topId: 'top_tank_01',         bottomId: 'bottom_trouser_01', outerwearId: 'outer_hoodie_01',  shoeId: 'shoe_sneaker_01' },
  royalty:    { topId: 'top_agbada_01',       bottomId: 'bottom_cargo_01',   outerwearId: null,               shoeId: 'shoe_sandal_01' },
};

export function boutiqueItemById(id) {
  return BOUTIQUE_ITEMS.find(i => i.id === id) || null;
}

/** outfitId → boutique item (only premium outfits are listed). */
export function boutiqueItemForOutfit(outfitId) {
  return BOUTIQUE_ITEMS.find(i => i.outfitId === outfitId) || null;
}

export const AVATAR_FABRICS = [
  { id: 'plain',  name: 'Plain' },
  { id: 'ankara', name: 'Ankara' },
  { id: 'adire',  name: 'Adire' },
  { id: 'asoke',  name: 'Aso-oke' },
];

export const AVATAR_TOP_COLORS = [
  '#22d3ee', '#f472b6', '#a3e635', '#fbbf24', '#c084fc',
  '#fb7185', '#34d399', '#60a5fa', '#ef4444', '#fb923c',
  // Phase 6 (boutique): signature garment colors for premium outfits.
  '#f8fafc', '#c2703d', '#0f766e', '#1e3a8a', '#e11d48',
  '#f5d76e', '#111418', '#374151', '#7c3aed', '#3b82c4',
  '#18181b',
];

export const AVATAR_BOTTOM_COLORS = [
  '#334155', '#111827', '#f8fafc', '#1e3a8a', '#64748b',
  '#78350f', '#14532d', '#7c2d12', '#831843', '#3b0764',
  // Phase 6 (boutique): signature garment colors for premium outfits.
  '#1f2430', '#3b2f2f', '#134e4a', '#172554', '#b45309',
  '#92400e', '#111418', '#1f2937', '#18181b', '#1e40af',
];

export const DEFAULT_AVATAR = {
  body: 'woman',
  skin: 'cocoa',
  hair: 'lowcut',
  outfit: 'casual',
  fabric: 'plain',
  topColor: '#22d3ee',
  bottomColor: '#334155',
};

// Validate an AvatarLook payload. Every field is checked against the
// allowlists; colors must appear in the color lists (case-insensitive).
// Returns { ok:true, avatar } with canonical values on success, or
// { ok:false, avatar:null, error } naming the bad field on failure.
export function sanitizeAvatar(raw) {
  const bad = (field, value) => ({ ok: false, avatar: null, error: `Invalid avatar ${field}: '${value}'.` });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('body', '');
  if (!AVATAR_BODIES.some(b => b.id === raw.body)) return bad('body', raw.body);
  if (!AVATAR_SKINS.some(s => s.id === raw.skin)) return bad('skin', raw.skin);
  if (!AVATAR_HAIRS.some(h => h.id === raw.hair)) return bad('hair', raw.hair);
  if (!AVATAR_OUTFITS.some(o => o.id === raw.outfit)) return bad('outfit', raw.outfit);
  if (!AVATAR_FABRICS.some(f => f.id === raw.fabric)) return bad('fabric', raw.fabric);
  const top = String(raw.topColor || '').toLowerCase();
  if (!AVATAR_TOP_COLORS.includes(top)) return bad('topColor', raw.topColor);
  const bottom = String(raw.bottomColor || '').toLowerCase();
  if (!AVATAR_BOTTOM_COLORS.includes(bottom)) return bad('bottomColor', raw.bottomColor);
  return {
    ok: true,
    avatar: {
      body: raw.body, skin: raw.skin, hair: raw.hair,
      outfit: raw.outfit, fabric: raw.fabric,
      topColor: top, bottomColor: bottom,
    },
    error: null,
  };
}

// ---------------- Home styles (wall/floor finishes, priced in naira) ----------------
export const WALLS = [
  { id: 'smooth_matte', name: 'Smooth Matte', price: 1500,  hex: '#e7e5e4', desc: 'Clean matte finish — easy on the eyes, cheap to refresh.' },
  { id: 'lagoon_teal',  name: 'Lagoon Teal',  price: 4500,  hex: '#0e7490', desc: 'Cool teal wash, like the lagoon at noon.' },
  { id: 'sunset_ochre', name: 'Sunset Ochre', price: 8000,  hex: '#b45309', desc: 'Warm ochre walls — golden-hour glow all day.' },
  { id: 'regal_plum',   name: 'Regal Plum',   price: 14000, hex: '#6d28d9', desc: 'Deep plum with a premium, owambe-night feel.' },
  { id: 'gold_leaf',    name: 'Gold Leaf',    price: 25000, hex: '#a16207', desc: 'Metallic gold shimmer — proper soft-life walls.' },
];

export const FLOORS = [
  { id: 'polished_concrete', name: 'Polished Concrete', price: 5000,  hex: '#9ca3af', desc: 'Sleek polished concrete — modern and cool underfoot.' },
  { id: 'lagos_hardwood',    name: 'Lagos Hardwood',    price: 10000, hex: '#7c4a2d', desc: 'Warm hardwood planks, classic comfort.' },
  { id: 'marble_vein',       name: 'Marble Vein',       price: 15000, hex: '#e2e8f0', desc: 'Bright marble with soft grey veining.' },
  { id: 'obsidian_gloss',    name: 'Obsidian Gloss',    price: 20000, hex: '#1f2937', desc: 'Dark glossy tiles — sharp, premium finish.' },
];
