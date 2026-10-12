// ============================================================
// v2/venues.js — Phase 5: venue activities ("things to do").
//
// Every activity below is ORIGINAL (invented names/text for Èkó Life);
// the pattern (venue dialog → food + social activities → travel row)
// mirrors the observed reference behavior, never its text or names.
//
// Shape per activity:
//   { id, name, icon, cost (coins, integer, 0 = free),
//     needs: { hunger, fun, happiness, energy, social, hygiene },
//     skillXp?: { skill, xp }, blurb, teaser }
// `tags` lists which venue tags the activity belongs to.
// Cooldown: 60s per activity, namespaced `venue:<activityId>`.
// ============================================================

export const VENUE_COOLDOWN_MS = 60 * 1000;

/** All venue activities. Each entry carries its own `tags` array. */
export const VENUE_ACTIVITIES = [
  // ---------------- market ----------------
  { id: 'mama_put_plate', name: 'Haggle a Mama Put plate', icon: '🍲', cost: 800,
    needs: { hunger: 35, fun: 3, happiness: 4 }, tags: ['market'],
    blurb: 'Point, price, argue, laugh — then eat like royalty.',
    teaser: '🍲 Haggle a Mama Put plate' },
  { id: 'thrift_dig', name: 'Dig the thrift racks', icon: '👕', cost: 300,
    needs: { fun: 10, happiness: 6, energy: -5 }, tags: ['market'],
    blurb: 'Okirika gold hides between the hangers. Dig deep.',
    teaser: '👕 Dig the thrift racks' },
  { id: 'stall_gist', name: 'Gist with a market woman', icon: '🗣️', cost: 0,
    needs: { social: 14, fun: 6, energy: -3 }, tags: ['market'],
    blurb: 'Nobody gists like a market woman. Bring your ears.',
    teaser: '🗣️ Gist with a market woman' },
  { id: 'offload_help', name: 'Help a trader offload goods', icon: '💪', cost: 0,
    needs: { social: 8, energy: -12 }, skillXp: { skill: 'hustle', xp: 10 }, tags: ['market'],
    blurb: 'Carry cartons, earn respect — and hustle XP.',
    teaser: '💪 Help a trader offload goods' },
  { id: 'fabric_window', name: 'Window-shop aso-ebi fabrics', icon: '👗', cost: 0,
    needs: { fun: 9, happiness: 5 }, tags: ['market'],
    blurb: 'Ankara, lace, adire — owambe planning starts here.',
    teaser: '👗 Window-shop aso-ebi fabrics' },
  { id: 'charger_bargain', name: 'Bargain for a phone charger', icon: '📱', cost: 600,
    needs: { happiness: 7, fun: 5 }, tags: ['market'],
    blurb: 'Start at half the price. Walk away twice. Win.',
    teaser: '📱 Bargain for a phone charger' },
  { id: 'pepper_taste', name: 'Taste the pepper-soup stand', icon: '🌶️', cost: 400,
    needs: { hunger: 14, happiness: 5 }, tags: ['market'],
    blurb: 'One spoon. Your sinuses will never forget.',
    teaser: '🌶️ Taste the pepper-soup stand' },

  // ---------------- motor_park ----------------
  { id: 'bus_load', name: 'Help load a danfo', icon: '🚌', cost: 0,
    needs: { social: 10, energy: -12 }, skillXp: { skill: 'hustle', xp: 8 }, tags: ['motor_park'],
    blurb: 'Shout the destination, stack the luggage, feel the park.',
    teaser: '🚌 Help load a danfo' },
  { id: 'park_elder', name: 'Hustle tips from a park elder', icon: '🎙️', cost: 0,
    needs: { social: 12, energy: -2 }, skillXp: { skill: 'hustle', xp: 6 }, tags: ['motor_park'],
    blurb: 'Thirty years of park wisdom in ten loud minutes.',
    teaser: '🎙️ Hustle tips from a park elder' },
  { id: 'puff_puff', name: 'Buy roadside puff-puff', icon: '🍩', cost: 300,
    needs: { hunger: 10, happiness: 5 }, tags: ['motor_park'],
    blurb: 'Hot, round, gone in four bites. Buy two wraps.',
    teaser: '🍩 Buy roadside puff-puff' },
  { id: 'conductor_shout', name: 'Shout conductor for a loading bus', icon: '📣', cost: 0,
    needs: { fun: 8, social: 8, energy: -8 }, tags: ['motor_park'],
    blurb: '"Oshodi! Oshodi! Enter with your change o!"',
    teaser: '📣 Shout conductor for a loading bus' },
  { id: 'fare_settle', name: 'Settle a fare quarrel', icon: '⚖️', cost: 0,
    needs: { social: 10, energy: -5 }, skillXp: { skill: 'charisma', xp: 8 }, tags: ['motor_park'],
    blurb: 'Two passengers, one seat, zero chill. Mediate it.',
    teaser: '⚖️ Settle a fare quarrel' },
  { id: 'park_shade', name: 'Rest under the park shade', icon: '🌳', cost: 0,
    needs: { energy: 12, fun: -2 }, tags: ['motor_park'],
    blurb: 'Even hustlers sit. Watch the chaos from the shade.',
    teaser: '🌳 Rest under the park shade' },

  // ---------------- campus ----------------
  { id: 'guest_lecture', name: 'Sneak into a guest lecture', icon: '📚', cost: 0,
    needs: { energy: -8, fun: 5, happiness: 3 }, tags: ['campus'],
    blurb: 'Sit at the back. Nod wisely. Learn something.',
    teaser: '📚 Sneak into a guest lecture' },
  { id: 'hack_sprint', name: 'Join a hackathon sprint', icon: '💻', cost: 0,
    needs: { energy: -12, fun: 10 }, skillXp: { skill: 'coding', xp: 16 }, tags: ['campus'],
    blurb: '48 hours, free pizza, one demo that must not crash.',
    teaser: '💻 Join a hackathon sprint' },
  { id: 'gate_shawarma', name: 'Shawarma run at the school gate', icon: '🌯', cost: 2200,
    needs: { hunger: 40, energy: 10, happiness: 6 }, tags: ['campus'],
    blurb: 'The gate shawarma guy has never missed. Ever.',
    teaser: '🌯 Shawarma run at the school gate' },
  { id: 'union_debate', name: 'Debate at the student union', icon: '🎤', cost: 0,
    needs: { social: 10, energy: -8 }, skillXp: { skill: 'charisma', xp: 12 }, tags: ['campus'],
    blurb: 'Motion: "Sapa is a mindset." Defend or destroy.',
    teaser: '🎤 Debate at the student union' },
  { id: 'handout_run', name: 'Photocopy handouts for coursemates', icon: '🖨️', cost: 0,
    needs: { social: 8, energy: -8 }, skillXp: { skill: 'hustle', xp: 10 }, tags: ['campus'],
    blurb: 'Fifty copies, one jammed machine, instant popularity.',
    teaser: '🖨️ Photocopy handouts for coursemates' },
  { id: 'field_ball', name: 'Evening football on the field', icon: '⚽', cost: 0,
    needs: { fun: 14, energy: -15 }, skillXp: { skill: 'fitness', xp: 12 }, tags: ['campus'],
    blurb: 'Winners stay on. Losers buy pure water.',
    teaser: '⚽ Evening football on the field' },
  { id: 'masterclass', name: 'Weekend masterclass', icon: '🧠', cost: 3000,
    needs: { energy: -10, fun: 6, social: 8 }, skillXp: { skill: 'charisma', xp: 15 }, tags: ['campus'],
    blurb: 'A certificate of attendance and actual confidence.',
    teaser: '🧠 Weekend masterclass' },

  // ---------------- mall ----------------
  { id: 'window_tour', name: 'Window-shop the boutiques', icon: '🛍️', cost: 0,
    needs: { fun: 12, happiness: 6 }, tags: ['mall'],
    blurb: 'Try everything. Buy nothing. Feel fantastic.',
    teaser: '🛍️ Window-shop the boutiques' },
  { id: 'matinee', name: 'Catch a cinema matinee', icon: '🎬', cost: 2500,
    needs: { fun: 25, happiness: 15, energy: -5 }, tags: ['mall'],
    blurb: 'Cold AC, loud sound, popcorn the size of your head.',
    teaser: '🎬 Catch a cinema matinee' },
  { id: 'arcade_hour', name: 'One hour at the arcade', icon: '🕹️', cost: 1200,
    needs: { fun: 18, happiness: 8 }, tags: ['mall'],
    blurb: 'Beat the high score or lose trying. Loudly.',
    teaser: '🕹️ One hour at the arcade' },
  { id: 'court_feast', name: 'Food-court feast', icon: '🍔', cost: 2800,
    needs: { hunger: 35, happiness: 10 }, tags: ['mall'],
    blurb: 'One tray, three cuisines, zero regrets.',
    teaser: '🍔 Food-court feast' },
  { id: 'fountain_watch', name: 'People-watch by the fountain', icon: '⛲', cost: 0,
    needs: { fun: 8, social: 4 }, tags: ['mall'],
    blurb: 'Invent backstories for strangers. Keep it kind.',
    teaser: '⛲ People-watch by the fountain' },
  { id: 'booth_strip', name: 'Photo-booth strip', icon: '📸', cost: 600,
    needs: { fun: 10, happiness: 5 }, skillXp: { skill: 'photography', xp: 8 }, tags: ['mall'],
    blurb: 'Four frames, your best faces, instant keepsake.',
    teaser: '📸 Photo-booth strip' },
  { id: 'sales_raid', name: 'Raid the sales rack', icon: '🏷️', cost: 1500,
    needs: { happiness: 12, fun: 8 }, tags: ['mall'],
    blurb: '70% off. Your size. It was meant to be.',
    teaser: '🏷️ Raid the sales rack' },

  // ---------------- bank ----------------
  { id: 'banker_tips', name: 'Ask a banker for money tips', icon: '💼', cost: 0,
    needs: { social: 6, energy: -5 }, skillXp: { skill: 'hustle', xp: 10 }, tags: ['bank'],
    blurb: 'Free financial advice between queue numbers.',
    teaser: '💼 Ask a banker for money tips' },
  { id: 'queue_chat', name: 'Small talk in the queue', icon: '💬', cost: 0,
    needs: { social: 10, fun: 3, energy: -3 }, tags: ['bank'],
    blurb: 'Two hours in line builds unexpected friendships.',
    teaser: '💬 Small talk in the queue' },
  { id: 'vault_peek', name: 'Peek at the vault display', icon: '🔐', cost: 0,
    needs: { fun: 8, happiness: 4 }, tags: ['bank'],
    blurb: 'Glass, steel, and more money than you will touch today.',
    teaser: '🔐 Peek at the vault display' },
  { id: 'forex_board', name: 'Study the forex board', icon: '📊', cost: 0,
    needs: { energy: -2 }, skillXp: { skill: 'hustle', xp: 6 }, tags: ['bank'],
    blurb: 'Red and green numbers. Someday they will obey you.',
    teaser: '📊 Study the forex board' },

  // ---------------- housing_office ----------------
  { id: 'desk_gist', name: 'Gist with the front-desk officer', icon: '🗂️', cost: 0,
    needs: { social: 8, fun: 3 }, tags: ['housing_office'],
    blurb: 'They know every estate secret. Ask nicely.',
    teaser: '🗂️ Gist with the front-desk officer' },
  { id: 'model_tour', name: 'Tour a model flat', icon: '🏠', cost: 0,
    needs: { fun: 10, happiness: 6 }, tags: ['housing_office'],
    blurb: 'Pretend you live here. The tiles are lovely.',
    teaser: '🏠 Tour a model flat' },
  { id: 'estate_gossip', name: 'Hear the estate gist', icon: '👂', cost: 0,
    needs: { social: 12, fun: 5 }, skillXp: { skill: 'charisma', xp: 6 }, tags: ['housing_office'],
    blurb: 'Who moved where, and why the gate man winks.',
    teaser: '👂 Hear the estate gist' },
  { id: 'paint_check', name: 'Inspect fresh paint jobs', icon: '🎨', cost: 0,
    needs: { fun: 5, happiness: 3 }, tags: ['housing_office'],
    blurb: 'Criticise the colour choices like an art director.',
    teaser: '🎨 Inspect fresh paint jobs' },

  // ---------------- hospital ----------------
  { id: 'desk_volunteer', name: 'Volunteer at the front desk', icon: '🤝', cost: 0,
    needs: { social: 15, happiness: 10, energy: -12 }, tags: ['hospital'],
    blurb: 'Point lost visitors the right way. Feel ten feet tall.',
    teaser: '🤝 Volunteer at the front desk' },
  { id: 'blood_drive', name: 'Donate at the blood drive', icon: '🩸', cost: 0,
    needs: { happiness: 15, social: 8, energy: -15 }, tags: ['hospital'],
    blurb: 'One pint, one biscuit, one life possibly saved.',
    teaser: '🩸 Donate at the blood drive' },
  { id: 'ward_errand', name: 'Run errands for a ward', icon: '💊', cost: 0,
    needs: { social: 8, energy: -10 }, skillXp: { skill: 'hustle', xp: 8 }, tags: ['hospital'],
    blurb: 'Fetch files, guide families, keep the ward moving.',
    teaser: '💊 Run errands for a ward' },
  { id: 'garden_rest', name: 'Sit in the healing garden', icon: '🌿', cost: 0,
    needs: { energy: 8, happiness: 6 }, tags: ['hospital'],
    blurb: 'Quiet benches, frangipani trees, deep breaths.',
    teaser: '🌿 Sit in the healing garden' },

  // ---------------- office ----------------
  { id: 'lift_chat', name: 'Elevator small talk', icon: '🛗', cost: 0,
    needs: { social: 8, fun: 2 }, tags: ['office'],
    blurb: 'Ten floors. Weather, traffic, done. Networking!',
    teaser: '🛗 Elevator small talk' },
  { id: 'lobby_coffee', name: 'Lobby espresso run', icon: '☕', cost: 800,
    needs: { energy: 15, fun: 5 }, tags: ['office'],
    blurb: 'Corporate-grade caffeine. Taste the ambition.',
    teaser: '☕ Lobby espresso run' },
  { id: 'mentor_cup', name: 'Coffee with a mentor', icon: '🤵', cost: 1500,
    needs: { social: 10, energy: -5 }, skillXp: { skill: 'charisma', xp: 12 }, tags: ['office'],
    blurb: 'Fifteen minutes that rewire your whole career plan.',
    teaser: '🤵 Coffee with a mentor' },
  { id: 'pitch_rehearse', name: 'Rehearse a pitch in an empty room', icon: '🎙️', cost: 0,
    needs: { energy: -8, fun: 4 }, skillXp: { skill: 'charisma', xp: 10 }, tags: ['office'],
    blurb: 'Whiteboard, marker, mirror. Sell it like funding depends on it.',
    teaser: '🎙️ Rehearse a pitch in an empty room' },
  { id: 'deck_shots', name: 'Skyline shots from the deck', icon: '📸', cost: 0,
    needs: { fun: 10 }, skillXp: { skill: 'photography', xp: 10 }, tags: ['office'],
    blurb: 'The city looks expensive from the 20th floor.',
    teaser: '📸 Skyline shots from the deck' },

  // ---------------- tech_hub ----------------
  { id: 'hack_night', name: 'Open hack night', icon: '💻', cost: 0,
    needs: { energy: -15, social: 8 }, skillXp: { skill: 'coding', xp: 18 }, tags: ['tech_hub'],
    blurb: 'Laptops, whiteboards, and bugs that fear you.',
    teaser: '💻 Open hack night' },
  { id: 'pitch_watch', name: 'Watch startup pitch night', icon: '🎤', cost: 0,
    needs: { fun: 10, social: 6 }, skillXp: { skill: 'hustle', xp: 10 }, tags: ['tech_hub'],
    blurb: 'Five minutes, one dream, zero mercy from the judges.',
    teaser: '🎤 Watch startup pitch night' },
  { id: 'hub_cafe', name: 'Work from the hub café', icon: '☕', cost: 1000,
    needs: { energy: 10, fun: 4 }, skillXp: { skill: 'coding', xp: 8 }, tags: ['tech_hub'],
    blurb: 'Wi-Fi fast enough to make you feel employed.',
    teaser: '☕ Work from the hub café' },
  { id: 'dev_mentor', name: '1:1 with a senior dev', icon: '🧑‍🏫', cost: 2000,
    needs: { energy: -10 }, skillXp: { skill: 'coding', xp: 22 }, tags: ['tech_hub'],
    blurb: 'Code review, career review, life review. Worth it.',
    teaser: '🧑‍🏫 1:1 with a senior dev' },
  { id: 'game_jam', name: 'Weekend game jam', icon: '🎮', cost: 0,
    needs: { energy: -15, fun: 15 }, skillXp: { skill: 'coding', xp: 12 }, tags: ['tech_hub'],
    blurb: 'Build a whole game before Monday. Sleep is optional.',
    teaser: '🎮 Weekend game jam' },

  // ---------------- beach ----------------
  { id: 'surf_swim', name: 'Swim in the surf', icon: '🏊', cost: 0,
    needs: { fun: 20, hygiene: -10, energy: -12 }, tags: ['beach'],
    blurb: 'Dive under the breakers. Come up a new person.',
    teaser: '🏊 Swim in the surf' },
  { id: 'beach_volley', name: 'Beach volleyball pickup', icon: '🏐', cost: 0,
    needs: { fun: 15, social: 10, energy: -15 }, skillXp: { skill: 'fitness', xp: 12 }, tags: ['beach'],
    blurb: 'Sand in everything. Glory in the third set.',
    teaser: '🏐 Beach volleyball pickup' },
  { id: 'coconut_break', name: 'Fresh coconut from a vendor', icon: '🥥', cost: 500,
    needs: { hunger: 12, happiness: 8 }, tags: ['beach'],
    blurb: 'Machete, straw, paradise. Ask him to cut it twice.',
    teaser: '🥥 Fresh coconut from a vendor' },
  { id: 'sunset_stroll', name: 'Sunset stroll on the sand', icon: '🌅', cost: 0,
    needs: { happiness: 15, energy: -5 }, tags: ['beach'],
    blurb: 'Bare feet, orange sky, problems on mute.',
    teaser: '🌅 Sunset stroll on the sand' },
  { id: 'beach_suya', name: 'Beach suya grill', icon: '🍢', cost: 1500,
    needs: { hunger: 30, happiness: 10 }, tags: ['beach'],
    blurb: 'Smoke, spice, sea air. The holy trinity.',
    teaser: '🍢 Beach suya grill' },
  { id: 'sand_build', name: 'Build a sand castle', icon: '🏰', cost: 0,
    needs: { fun: 12, happiness: 5 }, tags: ['beach'],
    blurb: 'Architectural ambition, tidal consequences.',
    teaser: '🏰 Build a sand castle' },

  // ---------------- club ----------------
  { id: 'dance_floor', name: 'Own the dance floor', icon: '💃', cost: 1000,
    needs: { fun: 20, social: 12, energy: -20 }, skillXp: { skill: 'dance', xp: 15 }, tags: ['club'],
    blurb: 'The DJ sees you. The crowd follows. Shine.',
    teaser: '💃 Own the dance floor' },
  { id: 'bottle_crew', name: 'Bottle service with the crew', icon: '🍾', cost: 5000,
    needs: { fun: 30, social: 20, happiness: 15, energy: -15 }, tags: ['club'],
    blurb: 'Sparklers, section, stories for Monday.',
    teaser: '🍾 Bottle service with the crew' },
  { id: 'dj_request', name: 'Request a song from the DJ', icon: '🎧', cost: 500,
    needs: { fun: 12, social: 6 }, skillXp: { skill: 'music', xp: 10 }, tags: ['club'],
    blurb: 'Pick the anthem. Watch the floor erupt.',
    teaser: '🎧 Request a song from the DJ' },
  { id: 'vip_chill', name: 'Chill in the VIP lounge', icon: '🛋️', cost: 2000,
    needs: { fun: 15, social: 15, energy: -5 }, tags: ['club'],
    blurb: 'Velvet seats, low lights, big conversations.',
    teaser: '🛋️ Chill in the VIP lounge' },
  { id: 'karaoke_duel', name: 'Karaoke battle', icon: '🎤', cost: 800,
    needs: { fun: 18, social: 10, energy: -10 }, skillXp: { skill: 'music', xp: 12 }, tags: ['club'],
    blurb: 'High notes or high comedy — the crowd decides.',
    teaser: '🎤 Karaoke battle' },

  // ---------------- boat ----------------
  { id: 'ferry_cross', name: 'Ferry ride across the lagoon', icon: '⛴️', cost: 800,
    needs: { fun: 18, happiness: 10, energy: -3 }, tags: ['boat'],
    blurb: 'Beat the traffic. Let the wind do the talking.',
    teaser: '⛴️ Ferry ride across the lagoon' },
  { id: 'canoe_paddle', name: 'Paddle a canoe with a fisherman', icon: '🛶', cost: 0,
    needs: { fun: 15, energy: -15 }, skillXp: { skill: 'fitness', xp: 10 }, tags: ['boat'],
    blurb: 'He has done this forty years. You have done this never.',
    teaser: '🛶 Paddle a canoe with a fisherman' },
  { id: 'dock_gist', name: 'Gist with the dock hands', icon: '⚓', cost: 0,
    needs: { social: 12, fun: 5 }, tags: ['boat'],
    blurb: 'Lagoon legends, told between rope coils.',
    teaser: '⚓ Gist with the dock hands' },
  { id: 'speedboat_run', name: 'Speedboat to the far beach', icon: '🚤', cost: 2500,
    needs: { fun: 30, happiness: 20, energy: -8 }, tags: ['boat'],
    blurb: 'Lifejacket on. Hold tight. Scream if you must.',
    teaser: '🚤 Speedboat to the far beach' },
  { id: 'fish_auction', name: 'Watch the morning fish auction', icon: '🐟', cost: 0,
    needs: { fun: 8 }, skillXp: { skill: 'hustle', xp: 6 }, tags: ['boat'],
    blurb: 'Bidding wars over croaker at 6am. Electric.',
    teaser: '🐟 Watch the morning fish auction' },

  // ---------------- stadium ----------------
  { id: 'street_ball', name: 'Join a street football game', icon: '⚽', cost: 0,
    needs: { fun: 20, social: 10, energy: -20 }, skillXp: { skill: 'fitness', xp: 15 }, tags: ['stadium'],
    blurb: 'Winners stay on. Bring your A-game and your lungs.',
    teaser: '⚽ Join a street football game' },
  { id: 'track_sprint', name: 'Sprint the stadium track', icon: '🏃', cost: 0,
    needs: { fun: 8, energy: -18 }, skillXp: { skill: 'fitness', xp: 12 }, tags: ['stadium'],
    blurb: 'Four hundred metres. Your legs will file a complaint.',
    teaser: '🏃 Sprint the stadium track' },
  { id: 'boxing_night', name: 'Watch grassroots boxing', icon: '🥊', cost: 0,
    needs: { fun: 15, social: 8 }, tags: ['stadium'],
    blurb: 'Future champions, present drama, ringside dust.',
    teaser: '🥊 Watch grassroots boxing' },
  { id: 'stand_snack', name: 'Stadium popcorn and zobo', icon: '🍿', cost: 600,
    needs: { hunger: 10, fun: 8, happiness: 5 }, tags: ['stadium'],
    blurb: 'The unofficial sponsor of every good match.',
    teaser: '🍿 Stadium popcorn and zobo' },
  { id: 'cheer_lead', name: 'Lead the cheer squad', icon: '📣', cost: 0,
    needs: { fun: 10, social: 15, energy: -10 }, skillXp: { skill: 'charisma', xp: 12 }, tags: ['stadium'],
    blurb: 'Start the chant. The whole stand follows.',
    teaser: '📣 Lead the cheer squad' },

  // ---------------- residential ----------------
  { id: 'neighbour_wave', name: 'Greet the neighbours', icon: '👋', cost: 0,
    needs: { social: 12, happiness: 5 }, tags: ['residential'],
    blurb: '"Good morning" opens more doors than keys.',
    teaser: '👋 Greet the neighbours' },
  { id: 'estate_stroll', name: 'Evening estate stroll', icon: '🚶', cost: 0,
    needs: { energy: 8, happiness: 8 }, tags: ['residential'],
    blurb: 'Mango trees, generator hums, golden light.',
    teaser: '🚶 Evening estate stroll' },
  { id: 'block_party', name: 'Street block party', icon: '🎉', cost: 1000,
    needs: { fun: 20, social: 20, happiness: 10, energy: -10 }, tags: ['residential'],
    blurb: 'Speakers on the pavement. Everybody is invited.',
    teaser: '🎉 Street block party' },
  { id: 'hood_suya', name: 'Neighbourhood suya spot', icon: '🍢', cost: 1200,
    needs: { hunger: 25, happiness: 8 }, tags: ['residential'],
    blurb: 'The corner grill man knows your order by heart.',
    teaser: '🍢 Neighbourhood suya spot' },
  { id: 'mango_nap', name: 'Nap under a mango tree', icon: '🥭', cost: 0,
    needs: { energy: 20, fun: -3 }, tags: ['residential'],
    blurb: 'Shade, breeze, and the occasional falling mango.',
    teaser: '🥭 Nap under a mango tree' },

  // ---------------- landmark ----------------
  { id: 'selfie_stop', name: 'Selfie at the landmark', icon: '🤳', cost: 0,
    needs: { fun: 10, happiness: 5 }, skillXp: { skill: 'photography', xp: 10 }, tags: ['landmark'],
    blurb: 'Angle, light, landmark. Post-worthy in one take.',
    teaser: '🤳 Selfie at the landmark' },
  { id: 'guide_tour', name: 'Follow a local tour guide', icon: '🗺️', cost: 1000,
    needs: { fun: 15, social: 8 }, tags: ['landmark'],
    blurb: 'Stories the plaque left out. Tip if he earns it.',
    teaser: '🗺️ Follow a local tour guide' },
  { id: 'golden_shots', name: 'Golden-hour photo session', icon: '📸', cost: 0,
    needs: { fun: 12 }, skillXp: { skill: 'photography', xp: 12 }, tags: ['landmark'],
    blurb: 'The city glows. So will your camera roll.',
    teaser: '📸 Golden-hour photo session' },
  { id: 'story_hear', name: 'Hear the landmark\'s story', icon: '📖', cost: 0,
    needs: { fun: 8, social: 6 }, tags: ['landmark'],
    blurb: 'Every stone has a gist. Ask the oldest trader.',
    teaser: '📖 Hear the landmark\'s story' },
  { id: 'landmark_snack', name: 'Buy from a landmark vendor', icon: '🥜', cost: 300,
    needs: { hunger: 8, happiness: 4 }, tags: ['landmark'],
    blurb: 'Roasted groundnuts, still warm from the pan.',
    teaser: '🥜 Buy from a landmark vendor' },
];

/** All activities whose `tags` intersect the given tag list, deduped by id (first tag wins). */
export function activitiesForTags(tags) {
  const wanted = new Set(Array.isArray(tags) ? tags : []);
  const seen = new Set();
  const out = [];
  for (const a of VENUE_ACTIVITIES) {
    if (seen.has(a.id)) continue;
    if (a.tags.some((t) => wanted.has(t))) {
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

/** Activities available at a location object (uses its `tags`). */
export function activitiesForLocation(loc) {
  if (!loc) return [];
  return activitiesForTags(loc.tags);
}

/** Find one activity by id (any tag). */
export function findActivity(id) {
  return VENUE_ACTIVITIES.find((a) => a.id === String(id)) || null;
}

/** True when the activity is offered at the given location (tag match). */
export function activityOfferedAt(loc, activityId) {
  const a = findActivity(activityId);
  if (!a || !loc) return false;
  const wanted = new Set(loc.tags || []);
  return a.tags.some((t) => wanted.has(t));
}

/** Every tag used by LOCATIONS must have ≥1 activity. Defensive check for tests. */
export function tagsWithoutActivities(allTags) {
  return [...new Set(allTags)].filter(
    (t) => !VENUE_ACTIVITIES.some((a) => a.tags.includes(t))
  );
}
