-- dialect: postgres
-- 005-events-seed.sql — Live Events Calendar seed data (Postgres).
-- 6 events: ONE live right now (starts_at <= now <= ends_at), the rest
-- scheduled over the next 2 weeks. Offsets are computed from the moment
-- the migration first runs. Idempotent via INSERT ... ON CONFLICT DO NOTHING.
-- Prize text is gameplay coins only — never real money.

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'freestyle-friday', 'Freestyle Friday', '🎤', 'Oshodi Under-Bridge', '8pm',
  EXTRACT(EPOCH FROM NOW() - INTERVAL '30 minutes')::BIGINT,
  EXTRACT(EPOCH FROM NOW() + INTERVAL '90 minutes')::BIGINT,
  '[{"icon":"📍","rich":"<b>Oshodi Under-Bridge</b> · mic opens 8pm sharp"},{"icon":"🎁","rich":"Winner takes <b>₦50,000</b> game cash"},{"icon":"🎤","rich":"Bring your own beat — DJ on the decks"}]',
  '₦50,000 game cash',
  1, 'weekly', NULL, NULL, 640
ON CONFLICT(id) DO NOTHING;

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'owambe-saturdays', 'Owambe Saturdays', '🎉', 'VI Event Hall', '2pm · weekly',
  EXTRACT(EPOCH FROM NOW() + INTERVAL '2 days')::BIGINT,
  EXTRACT(EPOCH FROM NOW() + INTERVAL '2 days 6 hours')::BIGINT,
  '[{"icon":"📍","rich":"<b>VI Event Hall</b> · free danfo from CMS"},{"icon":"🎁","rich":"Best dressed wins <b>₦200,000</b> game cash"},{"icon":"👗","rich":"Aso-ebi: <b>Royal Purple</b> (optional)"}]',
  'Best dressed wins ₦200,000 game cash',
  1, 'weekly', NULL, NULL, 1208
ON CONFLICT(id) DO NOTHING;

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'danfo-drag-race', 'Danfo Drag Race', '🏁', 'Lekki-Epe Expressway', '11pm',
  EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days')::BIGINT,
  EXTRACT(EPOCH FROM NOW() + INTERVAL '3 days 3 hours')::BIGINT,
  '[{"icon":"📍","rich":"<b>Lekki-Epe Expressway</b> · straight stretch past Ajah"},{"icon":"🎁","rich":"Fastest danfo takes <b>₦150,000</b> game cash"},{"icon":"🏁","rich":"Head-to-head heats, quarter-mile dash"}]',
  '₦150,000 game cash',
  0, NULL, NULL, NULL, 852
ON CONFLICT(id) DO NOTHING;

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'lagos-food-fest', 'Lagos Food Fest', '🍲', 'Muri Okunola Park', 'all day',
  EXTRACT(EPOCH FROM NOW() + INTERVAL '6 days')::BIGINT,
  EXTRACT(EPOCH FROM NOW() + INTERVAL '6 days 10 hours')::BIGINT,
  '[{"icon":"📍","rich":"<b>Muri Okunola Park</b> · gates open 10am"},{"icon":"🍲","rich":"40+ food stalls, live grill-offs all day"},{"icon":"🎁","rich":"Chop Challenge winner takes <b>₦100,000</b> game cash"}]',
  '₦100,000 game cash',
  0, NULL, NULL, NULL, 2310
ON CONFLICT(id) DO NOTHING;

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'street-ballers-cup', 'Street Ballers Cup', '⚽', 'Yaba Stadium', 'qualifiers',
  EXTRACT(EPOCH FROM NOW() + INTERVAL '9 days')::BIGINT,
  EXTRACT(EPOCH FROM NOW() + INTERVAL '11 days')::BIGINT,
  '[{"icon":"📍","rich":"<b>Yaba Stadium</b> · qualifiers all weekend"},{"icon":"🎁","rich":"Champions take <b>₦250,000</b> game cash"},{"icon":"⚽","rich":"5-a-side — bring your crew"}]',
  '₦250,000 game cash',
  0, NULL, NULL, NULL, 1735
ON CONFLICT(id) DO NOTHING;

INSERT INTO events (id, title, emoji, venue, time_label, starts_at, ends_at, details_json, prize_text, is_recurring, recurring_rule, season_tag, season_blurb, base_attendees)
SELECT 'detty-december', 'Detty December', '🎄', 'Eko Atlantic City', 'Dec 1 – Jan 5',
  EXTRACT(EPOCH FROM NOW() + INTERVAL '13 days')::BIGINT,
  EXTRACT(EPOCH FROM NOW() + INTERVAL '16 days')::BIGINT,
  '[{"icon":"📍","rich":"<b>Eko Atlantic City</b> · beachfront main stage"},{"icon":"🎄","rich":"Concerts, beach raves &amp; IJGB homecomings — all month"},{"icon":"🎁","rich":"Grand raffle: <b>₦1,000,000</b> game cash"}]',
  '₦1,000,000 game cash',
  0, NULL, 'detty-december', 'Concerts, beach raves & IJGB homecomings — all month', 5200
ON CONFLICT(id) DO NOTHING;
