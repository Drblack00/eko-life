-- dialect: sqlite
-- 006-events-seed-sqlite.sql — Live Events Calendar seed data (SQLite).
-- Same 6 events as 005-events-seed.sql (Postgres), using SQLite date
-- functions instead of EXTRACT(EPOCH ...). ONE live right now, the rest
-- scheduled over the next 2 weeks. Idempotent via
-- INSERT ... ON CONFLICT DO NOTHING. Gameplay coins only.

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'freestyle-friday', 'Freestyle Friday', '🎤', 'Oshodi Under-Bridge', '8pm',
  strftime('%s','now') - 1800,
  strftime('%s','now') + 5400,
  '[{"icon":"📍","rich":"<b>Oshodi Under-Bridge</b> · mic opens 8pm sharp"},{"icon":"🎁","rich":"Winner takes <b>₦50,000</b> game cash"},{"icon":"🎤","rich":"Bring your own beat — DJ on the decks"}]',
  '₦50,000 game cash',
  1, 'weekly', NULL, NULL, 640
ON CONFLICT(id) DO NOTHING;

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'owambe-saturdays', 'Owambe Saturdays', '🎉', 'VI Event Hall', '2pm · weekly',
  strftime('%s','now') + 172800,
  strftime('%s','now') + 194400,
  '[{"icon":"📍","rich":"<b>VI Event Hall</b> · free danfo from CMS"},{"icon":"🎁","rich":"Best dressed wins <b>₦200,000</b> game cash"},{"icon":"👗","rich":"Aso-ebi: <b>Royal Purple</b> (optional)"}]',
  'Best dressed wins ₦200,000 game cash',
  1, 'weekly', NULL, NULL, 1208
ON CONFLICT(id) DO NOTHING;

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'danfo-drag-race', 'Danfo Drag Race', '🏁', 'Lekki-Epe Expressway', '11pm',
  strftime('%s','now') + 259200,
  strftime('%s','now') + 270000,
  '[{"icon":"📍","rich":"<b>Lekki-Epe Expressway</b> · straight stretch past Ajah"},{"icon":"🎁","rich":"Fastest danfo takes <b>₦150,000</b> game cash"},{"icon":"🏁","rich":"Head-to-head heats, quarter-mile dash"}]',
  '₦150,000 game cash',
  0, NULL, NULL, NULL, 852
ON CONFLICT(id) DO NOTHING;

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'lagos-food-fest', 'Lagos Food Fest', '🍲', 'Muri Okunola Park', 'all day',
  strftime('%s','now') + 518400,
  strftime('%s','now') + 554400,
  '[{"icon":"📍","rich":"<b>Muri Okunola Park</b> · gates open 10am"},{"icon":"🍲","rich":"40+ food stalls, live grill-offs all day"},{"icon":"🎁","rich":"Chop Challenge winner takes <b>₦100,000</b> game cash"}]',
  '₦100,000 game cash',
  0, NULL, NULL, NULL, 2310
ON CONFLICT(id) DO NOTHING;

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'street-ballers-cup', 'Street Ballers Cup', '⚽', 'Yaba Stadium', 'qualifiers',
  strftime('%s','now') + 777600,
  strftime('%s','now') + 950400,
  '[{"icon":"📍","rich":"<b>Yaba Stadium</b> · qualifiers all weekend"},{"icon":"🎁","rich":"Champions take <b>₦250,000</b> game cash"},{"icon":"⚽","rich":"5-a-side — bring your crew"}]',
  '₦250,000 game cash',
  0, NULL, NULL, NULL, 1735
ON CONFLICT(id) DO NOTHING;

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'detty-december', 'Detty December', '🎄', 'Eko Atlantic City', 'Dec 1 – Jan 5',
  strftime('%s','now') + 1123200,
  strftime('%s','now') + 1382400,
  '[{"icon":"📍","rich":"<b>Eko Atlantic City</b> · beachfront main stage"},{"icon":"🎄","rich":"Concerts, beach raves &amp; IJGB homecomings — all month"},{"icon":"🎁","rich":"Grand raffle: <b>₦1,000,000</b> game cash"}]',
  '₦1,000,000 game cash',
  0, NULL, 'detty-december', 'Concerts, beach raves & IJGB homecomings — all month', 5200
ON CONFLICT(id) DO NOTHING;
