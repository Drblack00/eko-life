/**
 * Local fallback pins for the landing map.
 * All names and blurbs are original — used only when GET /api/config is
 * unreachable or returns unusable data.
 */

export interface PinLocation {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  x: number; // world coords: x in [-90, 90]
  z: number; // world coords: z in [-90, 90]
  zone: "mainland" | "island" | "lagoon";
}

export const STUB_PINS: PinLocation[] = [
  { id: "sunrise-market", name: "Sunrise Market", emoji: "🧺", blurb: "The loudest, proudest open market on the Mainland. Everything has a price — and a bargain.", x: -58, z: -30, zone: "mainland" },
  { id: "danfo-park", name: "Danfo Park", emoji: "🚐", blurb: "Yellow buses, shouted destinations, and conductors with superhuman balance.", x: -62, z: 12, zone: "mainland" },
  { id: "suya-row", name: "Suya Row", emoji: "🍢", blurb: "Smoke, spice, and midnight queues. The grill never sleeps here.", x: -48, z: 34, zone: "mainland" },
  { id: "unity-campus", name: "Unity Campus", emoji: "🎓", blurb: "Lecture halls by day, gist spots by night. Students run this corner of the city.", x: -70, z: -58, zone: "mainland" },
  { id: "freedom-arena", name: "Freedom Arena", emoji: "🎶", blurb: "Live music, street food, and art walls. Weekends start here.", x: -44, z: -52, zone: "mainland" },
  { id: "chop-bar-street", name: "Chop Bar Street", emoji: "🍲", blurb: "Amala, rice, and pepper soup — served fast, eaten faster.", x: -66, z: 52, zone: "mainland" },
  { id: "tech-hub-row", name: "Tech Hub Row", emoji: "💻", blurb: "Co-working lofts and coffee shops where the next big app is being coded.", x: -40, z: -14, zone: "mainland" },
  { id: "old-library", name: "Old Library", emoji: "📚", blurb: "Quiet floors, dusty archives, and the best reading nooks in town.", x: -52, z: -66, zone: "mainland" },
  { id: "night-market", name: "Night Market", emoji: "🏮", blurb: "It only wakes up after 9pm. Thrift finds, street snacks, and haggling sport.", x: -58, z: 68, zone: "mainland" },
  { id: "grand-terminal", name: "Grand Terminal", emoji: "🚌", blurb: "Intercity buses to everywhere. Goodbyes and homecomings happen daily.", x: -76, z: 28, zone: "mainland" },
  { id: "radio-tower", name: "Radio Tower", emoji: "📻", blurb: "The city's loudest voice. Request shows, street interviews, and traffic gist.", x: -36, z: 56, zone: "mainland" },
  { id: "hospital-hill", name: "Hospital Hill", emoji: "🏥", blurb: "The general hospital on the hill — patch up here when the hustle wears you down.", x: -72, z: -12, zone: "mainland" },
  { id: "palm-gardens", name: "Palm Gardens", emoji: "🌴", blurb: "Manicured lawns and ocean breeze. Picnics, proposals, and golden-hour photos.", x: 52, z: -34, zone: "island" },
  { id: "sunset-beach", name: "Sunset Beach", emoji: "🏖️", blurb: "Soft sand, loud waves, and the best sunset on this side of the lagoon.", x: 64, z: 44, zone: "island" },
  { id: "marina-walk", name: "Marina Walk", emoji: "⛵", blurb: "A breezy promenade of cafes and boutiques facing the water.", x: 44, z: -8, zone: "island" },
  { id: "skyline-plaza", name: "Skyline Plaza", emoji: "🏙️", blurb: "Glass towers and rooftop lounges. The money moves through here.", x: 58, z: -58, zone: "island" },
  { id: "cinema-plaza", name: "Cinema Plaza", emoji: "🎬", blurb: "Premieres, popcorn, and first dates. The big screen never disappoints.", x: 66, z: -16, zone: "island" },
  { id: "golf-greens", name: "Golf Greens", emoji: "⛳", blurb: "Eighteen holes of quiet deals. Membership has its privileges.", x: 74, z: -72, zone: "island" },
  { id: "arts-theatre", name: "Arts Theatre", emoji: "🎭", blurb: "Stage plays, dance battles, and comedy nights under the lights.", x: 46, z: 22, zone: "island" },
  { id: "city-stadium", name: "City Stadium", emoji: "⚽", blurb: "Match days shake the ground. Pick a side, learn the chants.", x: 62, z: 66, zone: "island" },
  { id: "cathedral-point", name: "Cathedral Point", emoji: "⛪", blurb: "The old stone cathedral — weddings, choirs, and quiet mornings.", x: 38, z: -48, zone: "island" },
  { id: "central-mosque", name: "Central Mosque", emoji: "🕌", blurb: "Golden dome, cool marble floors, and a call that steadies the city.", x: 50, z: 52, zone: "island" },
  { id: "lagoon-jetty", name: "Lagoon Jetty", emoji: "🛶", blurb: "Ferries and fishing boats cross the lagoon from this wooden pier.", x: -6, z: 18, zone: "lagoon" },
  { id: "floating-cafe", name: "Floating Café", emoji: "☕", blurb: "Coffee on the water. The deck sways, the playlist doesn't.", x: 4, z: -30, zone: "lagoon" },
];
