-- dialect: both
-- 011-questlines.sql — P1: story-questline expansion + reward columns.
-- Adds net-worth gating + rep/gem rewards, and seeds 5 original
-- venue-tied story arcs (stories 2–6). Story 6 is locked behind a
-- ₦50,000,000 net worth. Idempotent: IF NOT EXISTS + ON CONFLICT.
-- All copy is original to Èkó Life.

ALTER TABLE stories ADD COLUMN net_worth_req BIGINT DEFAULT 0;
ALTER TABLE stories ADD COLUMN reward_rep INTEGER DEFAULT 0;
ALTER TABLE stories ADD COLUMN reward_gems INTEGER DEFAULT 0;
ALTER TABLE story_choices ADD COLUMN reward_rep INTEGER DEFAULT 0;
ALTER TABLE story_choices ADD COLUMN reward_gems INTEGER DEFAULT 0;

-- Completion rewards for the seeded story 1 (Danfo to Headline).
UPDATE stories SET reward_rep = 150, reward_gems = 2 WHERE id = 1;

-- ============ STORY 2: Balogun Hustle (Balogun Market) ============
INSERT INTO stories (id, title, synopsis, chapters_count, cover_emoji, net_worth_req, reward_rep, reward_gems) VALUES
(2, 'Balogun Hustle',
 'Mama Caro''s fabric stall is drowning in rent wahala and the owambe crowd arrives Saturday. Save the stall, become market royalty.',
 5, '🏪', 0, 120, 2)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_chapters (id, story_id, chapter_no, title) VALUES
(101, 2, 1, 'The Stall'),
(102, 2, 2, 'Promo Fever'),
(103, 2, 3, 'The Collectors'),
(104, 2, 4, 'Saturday Rush'),
(105, 2, 5, 'Balogun Queen')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(12011, 101, 1, 'NARRATOR', 'Balogun market, Tuesday morning. The noise hits like a concert — generators, hawkers, somebody''s radio fighting somebody else''s. Mama Caro waves you over to her fabric stall, Ankara stacked higher than your head.', NULL),
(12012, 101, 2, 'MAMA CARO', 'My pikin! Dem say owambe people dey come Saturday, plenty. I need somebody with correct eye to arrange this stall before then.', NULL),
(12013, 101, 3, 'MAMA CARO', 'So — you go help me arrange the stall yourself, abi you get better idea?', 'What do you do?'),
(12021, 102, 1, 'NARRATOR', 'Wednesday. You chalk prices on cardboard and the new arrangement pulls eyes from three stalls away. A small crowd is already gathering.', NULL),
(12022, 102, 2, 'CUSTOMER', 'Fine bobo, how much be this lace? And no tell me oyinbo price o.', NULL),
(12023, 102, 3, 'NARRATOR', 'The customer is testing you. Mama Caro watches from the corner of her eye.', 'How do you sell?'),
(12031, 103, 1, 'NARRATOR', 'Thursday afternoon. Two men with a notebook and no smile stop at the stall. Everybody in the row suddenly finds somewhere else to look.', NULL),
(12032, 103, 2, 'COLLECTOR', 'Friday. Complete payment, or we lock this stall. No story.', NULL),
(12033, 103, 3, 'MAMA CARO', 'My pikin, talk to them. You sabi talk.', 'What do you try?'),
(12041, 104, 1, 'NARRATOR', 'Saturday. The owambe crowd descends like rain — aso-ebi everywhere, music from a shop two rows down. The stall is packed shoulder to shoulder.', NULL),
(12042, 104, 2, 'MAMA CARO', 'We don sell half the shop before noon! My pikin, you be better pass advert!', NULL),
(12043, 104, 3, 'NARRATOR', 'Stock is running low and the crowd keeps coming. Mama Caro leaves the call to you.', 'What is the move?'),
(12051, 105, 1, 'NARRATOR', 'Friday. The collectors return — and Mama Caro counts out the full rent in fresh notes, smiling like a woman with zero worries.', NULL),
(12052, 105, 2, 'MAMA CARO', 'You be correct pikin. Take this — and anytime you need fabric, na family price for you, forever.', NULL),
(12053, 105, 3, 'NARRATOR', 'The market has a new queen-maker, and the traders are already whispering your name across the rows.', 'How do you take her thanks?')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp, reward_rep, reward_gems) VALUES
(22011, 12013, 'Arrange the stall yourself', 'Hands-on hustle', 12021, 500, 0, 3, 0),
(22012, 12013, 'Suggest a promo sale', 'Big thinking', 12021, 500, 0, 3, 0),
(22021, 12023, 'Give the correct price', 'Honest trade', 12031, 800, 0, 4, 0),
(22022, 12023, 'Add small jara on top', 'Sweeten the deal', 12031, 800, 0, 4, 0),
(22031, 12033, 'Negotiate a small extension', 'Buy time', 12041, 0, 0, 5, 0),
(22032, 12033, 'Offer half payment now', 'Show good faith', 12041, 0, 0, 5, 0),
(22041, 12043, 'Restock fast from the wholesaler', 'Keep the momentum', 12051, 1500, 0, 5, 0),
(22042, 12043, 'Raise prices small-small', 'Ride the demand', 12051, 2000, 0, 4, 0),
(22051, 12053, 'Take the fabric gift', 'Family price forever', NULL, 0, 0, 6, 1),
(22052, 12053, 'Take the cash thank-you', 'Money now', NULL, 5000, 0, 4, 0)
ON CONFLICT(id) DO NOTHING;
-- ============ STORY 3: Lekki Night Run (Lekki Beach / club) ============
INSERT INTO stories (id, title, synopsis, chapters_count, cover_emoji, net_worth_req, reward_rep, reward_gems) VALUES
(3, 'Lekki Night Run',
 'Sunset at the beach, a missing phone, and a trail that leads straight into the loudest club on the Island. Get it back before sunrise.',
 5, '🌊', 0, 110, 1)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_chapters (id, story_id, chapter_no, title) VALUES
(106, 3, 1, 'Golden Hour'),
(107, 3, 2, 'The Search'),
(108, 3, 3, 'The Club Detour'),
(109, 3, 4, 'The Trade'),
(110, 3, 5, 'Sunrise')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(13011, 106, 1, 'NARRATOR', 'Lekki beach, 6:12pm. The sun is doing its golden-hour magic, your guys are laughing, the waves are keeping time. Perfect evening — until Adaeze pats her empty pocket.', NULL),
(13012, 106, 2, 'ADAEZE', 'My phone! It was right here on the wrapper. Somebody pick am or e fall — I no know!', NULL),
(13013, 106, 3, 'NARRATOR', 'The group looks at you. You are the one who always finds lost things.', 'Where do you start?'),
(13021, 107, 1, 'NARRATOR', 'You retrace every step: the coconut spot, the horse guy, the volleyball corner. Sand everywhere, phone nowhere.', NULL),
(13022, 107, 2, 'VENDOR', 'Phone? Hmm. One fine boy in red shorts bin dey ask people about lost phone near the club entrance. That na like one hour ago.', NULL),
(13023, 107, 3, 'NARRATOR', 'A lead — and the night is getting loud. The beach club down the shore is already thumping.', 'What is the plan?'),
(13031, 108, 1, 'NARRATOR', 'The club gate. A bouncer built like a wardrobe crosses his arms. Entry is "strictly by list" tonight.', NULL),
(13032, 108, 2, 'BOUNCER', 'Oga, list don close. Except you get better reason.', NULL),
(13033, 108, 3, 'NARRATOR', 'You need inside, and begging never opened any door in Lagos.', 'How do you get in?'),
(13041, 109, 1, 'NARRATOR', 'Inside: strobes, sweat, somebody''s birthday. And there — by the DJ booth — a guy in red shorts, Adaeze''s phone glowing in his hand.', NULL),
(13042, 109, 2, 'RED SHORTS', 'I found am for sand! I bin dey wait make somebody describe am. But my night don start — make it worth my while na.', NULL),
(13043, 109, 3, 'NARRATOR', 'He is not a thief, just an opportunist. The phone is inches away.', 'How do you close this?'),
(13051, 110, 1, 'NARRATOR', '4:48am. Phone back in Adaeze''s hand, her scream of joy scattering the last club stragglers. You all walk back to the shore as the sky turns pink.', NULL),
(13052, 110, 2, 'ADAEZE', 'You be the real MVP. Breakfast na on me — fisherman pepper soup, the hot one.', NULL),
(13053, 110, 3, 'NARRATOR', 'Sunrise over the water. Some nights you will gist about for years.', 'How do you end the night?')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp, reward_rep, reward_gems) VALUES
(23011, 13013, 'Grid-search the sand', 'Slow and sure', 13021, 300, 0, 3, 0),
(23012, 13013, 'Ask every vendor first', 'People see things', 13021, 300, 0, 3, 0),
(23021, 13023, 'Head straight to the club', 'Follow the lead', 13031, 0, 0, 4, 0),
(23022, 13023, 'Call the phone and listen', 'Old trick', 13031, 0, 0, 4, 0),
(23031, 13033, 'Name-drop the DJ', 'Fake it steady', 13041, 0, 0, 5, 0),
(23032, 13033, 'Pay the "gate fee"', 'Money talks', 13041, -2000, 0, 3, 0),
(23041, 13043, 'Offer him a finder''s reward', 'Fair exchange', 13051, -3000, 0, 5, 0),
(23042, 13043, 'Describe the phone to prove it', 'No reward, just truth', 13051, 0, 0, 6, 1),
(23051, 13053, 'Pepper soup at sunrise', 'Eat the victory', NULL, 0, 0, 5, 0),
(23052, 13053, 'Sleep — gist tomorrow', 'Rest the legend', NULL, 1000, 0, 4, 0)
ON CONFLICT(id) DO NOTHING;
-- ============ STORY 4: Campus Wahala (UNILAG) ============
INSERT INTO stories (id, title, synopsis, chapters_count, cover_emoji, net_worth_req, reward_rep, reward_gems) VALUES
(4, 'Campus Wahala',
 'Your roommate''s laptop vanishes two days before exams. Follow the corridor gist, run a night-class stakeout, and save the semester.',
 5, '🎓', 0, 100, 1)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_chapters (id, story_id, chapter_no, title) VALUES
(111, 4, 1, 'Missing Laptop'),
(112, 4, 2, 'The Corridor Gist'),
(113, 4, 3, 'The Night Class'),
(114, 4, 4, 'The Confession'),
(115, 4, 5, 'Exam Eve')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(14011, 111, 1, 'NARRATOR', 'UNILAG hostel, 9pm. Your roommate Tunde turns his bag upside down for the third time. The laptop with all his notes — gone.', NULL),
(14012, 111, 2, 'TUNDE', 'Exams start Thursday! If I no see that laptop, na carryover straight. Abeg, help me think.', NULL),
(14013, 111, 3, 'NARRATOR', 'Nobody saw anything. But hostels always talk.', 'Where do you dig first?'),
(14021, 112, 1, 'NARRATOR', 'Corridor gist never fails. By 11pm you have three stories: a cleaner saw a laptop bag near the fellowship hall, and Emeka from 204 has been "borrowing" things all semester.', NULL),
(14022, 112, 2, 'MAMA PUT WOMAN', 'That Emeka? E bin dey press laptop for night class yesterday. E type like say exam na tomorrow.', NULL),
(14023, 112, 3, 'NARRATOR', 'Emeka denies everything by day. But night class is where the truth types.', 'What is the move?'),
(14031, 113, 1, 'NARRATOR', 'Midnight. The night-class hall hums with generators and whispered reading. You take the back row and watch.', NULL),
(14032, 113, 2, 'NARRATOR', '1:47am. Emeka walks in, opens a bag — and there it is. Tunde''s sticker-covered laptop, glowing in the dark hall.', NULL),
(14033, 113, 3, 'NARRATOR', 'Your blood is hot. But a scene here helps nobody.', 'How do you handle it?'),
(14041, 114, 1, 'NARRATOR', 'Outside, under the faculty light, Emeka breaks. His own laptop died; he "borrowed" Tunde''s to finish an assignment and fear kept it in his bag.', NULL),
(14042, 114, 2, 'EMEKA', 'I swear I for return am today. Abeg no report me — my mama go hear am.', NULL),
(14043, 114, 3, 'NARRATOR', 'The laptop is back. What happens to Emeka is your call.', 'Your verdict?'),
(14051, 115, 1, 'NARRATOR', 'Exam eve. The room smells of coffee and panic. Tunde''s notes are safe, Emeka is on reading duty for the whole floor, and you — you are the hostel''s unofficial detective.', NULL),
(14052, 115, 2, 'TUNDE', 'Na you save my semester. After exams, amala on me. The big one.', NULL),
(14053, 115, 3, 'NARRATOR', 'Some wahala ends with everybody wiser.', 'How do you close the semester?')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp, reward_rep, reward_gems) VALUES
(24011, 14013, 'Question the corridor', 'Gist is data', 14021, 300, 0, 3, 0),
(24012, 14013, 'Check the porters'' lodge', 'Official channel', 14021, 300, 0, 3, 0),
(24021, 14023, 'Stake out night class', 'Catch am red-handed', 14031, 0, 0, 5, 0),
(24022, 14023, 'Confront Emeka directly', 'Straight talk', 14031, 0, 0, 4, 0),
(24031, 14033, 'Wait and follow him out', 'No scene', 14041, 500, 0, 5, 0),
(24032, 14033, 'Snap a photo as evidence', 'Proof first', 14041, 500, 0, 4, 0),
(24041, 14043, 'Forgive, but he reads for all', 'Community service', 14051, 0, 0, 6, 1),
(24042, 14043, 'Report to the porter', 'Rules are rules', 14051, 0, 0, 3, 0),
(24051, 14053, 'Amala victory feast', 'Chop the win', NULL, 0, 0, 5, 0),
(24052, 14053, 'Sleep — exams need you sharp', 'Rest na strategy', NULL, 1000, 0, 4, 0)
ON CONFLICT(id) DO NOTHING;

-- ============ STORY 5: Yaba Bullets (Yaba Tech Hub) ============
INSERT INTO stories (id, title, synopsis, chapters_count, cover_emoji, net_worth_req, reward_rep, reward_gems) VALUES
(5, 'Yaba Bullets',
 'Demo day in 48 hours. Your team''s app must impress real investors — through dead laptops, NEPA wahala, and one game-changing bowl of rice.',
 5, '💻', 0, 140, 2)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_chapters (id, story_id, chapter_no, title) VALUES
(116, 5, 1, 'Demo Day Minus 48'),
(117, 5, 2, 'The Bug'),
(118, 5, 3, 'The Pivot'),
(119, 5, 4, 'Pitch Night'),
(120, 5, 5, 'Term Sheet')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(15011, 116, 1, 'NARRATOR', 'Yaba hub, 8pm. Whiteboards full, coffee cups everywhere. Your team''s market-app demo must sing in 48 hours — investors, real ones, are coming.', NULL),
(15012, 116, 2, 'ZAINAB', 'Payments flow works. But the onboarding? E be like say we build am for ourselves, not for Mama Nkechi.', NULL),
(15013, 116, 3, 'NARRATOR', 'Two days, one shaky demo, and a UX that only a developer could love.', 'Where do you strike first?'),
(15021, 117, 1, 'NARRATOR', '2:13am. The payment webhook dies mid-test. Then NEPA takes the light. The generator coughs, thinks about it, and refuses.', NULL),
(15022, 117, 2, 'CHIDI', 'We fit hotfix am by morning — if light comes back. If not, we dey demo with screenshots and vibes.', NULL),
(15023, 117, 3, 'NARRATOR', 'The team is running on fumes and stubbornness.', 'What carries the night?'),
(15031, 118, 1, 'NARRATOR', 'Fuel-station queue at dawn, then Mama Put for breakfast. Watching her count change with market-woman speed, something clicks.', NULL),
(15032, 118, 2, 'ZAINAB', 'Wait. What if onboarding na just voice note? Like she dey gist the app? No typing, no wahala.', NULL),
(15033, 118, 3, 'NARRATOR', 'A pivot with 24 hours left. Madness — or the whole game.', 'Do you pivot?'),
(15041, 119, 1, 'NARRATOR', 'Pitch night. The room is full of people who have heard one thousand pitches. Your palms are doing their own thing.', NULL),
(15042, 119, 2, 'INVESTOR', 'Interesting. But why will Mama Nkechi choose you over her notebook?', NULL),
(15043, 119, 3, 'NARRATOR', 'This is the question. The whole demo hangs on your answer.', 'How do you answer?'),
(15051, 120, 1, 'NARRATOR', 'One week later. A term sheet sits on the table — real money, real pressure. Bootstrapping kept you free; funding makes you fast.', NULL),
(15052, 120, 2, 'ZAINAB', 'Whatever we choose, we choose together. You carried demo night.', NULL),
(15053, 120, 3, 'NARRATOR', 'The pen is in your hand.', 'What does the team become?')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp, reward_rep, reward_gems) VALUES
(25011, 15013, 'Fix onboarding first', 'Users over features', 15021, 500, 50, 3, 0),
(25012, 15013, 'Harden the payments flow', 'Money must move', 15021, 500, 50, 3, 0),
(25021, 15023, 'Buy fuel, keep coding', 'Sleep is for later', 15031, -1500, 50, 5, 0),
(25022, 15023, 'Sleep 3 hours, then attack', 'Sharp brain wins', 15031, 0, 50, 4, 0),
(25031, 15033, 'Pivot to voice onboarding', 'Bet on Mama Put wisdom', 15041, 0, 100, 6, 1),
(25032, 15033, 'Polish what we have', 'Safe hands', 15041, 0, 100, 4, 0),
(25041, 15043, 'Demo it live with her voice', 'Show, don''t tell', 15051, 2000, 100, 6, 0),
(25042, 15043, 'Numbers: traders save 2hrs daily', 'Data wins rooms', 15051, 2000, 100, 5, 0),
(25051, 15053, 'Take the funding', 'Go fast', NULL, 50000, 0, 6, 1),
(25052, 15053, 'Bootstrap and stay free', 'Go far', NULL, 0, 200, 7, 1)
ON CONFLICT(id) DO NOTHING;
-- ============ STORY 6: Quilox Nights (LOCKED: net worth ₦50,000,000+) ============
INSERT INTO stories (id, title, synopsis, chapters_count, cover_emoji, net_worth_req, reward_rep, reward_gems) VALUES
(6, 'Quilox Nights',
 'The biggest night of the year. You are not on the list — yet. Talk your way in, save the main set, and leave through the owner''s door.',
 5, '🔒', 50000000, 200, 3)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_chapters (id, story_id, chapter_no, title) VALUES
(121, 6, 1, 'The List'),
(122, 6, 2, 'The Plug'),
(123, 6, 3, 'Inside'),
(124, 6, 4, 'The Set'),
(125, 6, 5, 'Owner''s Table')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(16011, 121, 1, 'NARRATOR', 'Saturday night. Everywhere you look, Lagos is dressed for the one party nobody wants to miss. Your phone buzzes: the guest list just closed. Your name is not on it.', NULL),
(16012, 121, 2, 'NARRATOR', 'Some people accept "no". You were not raised by some people.', NULL),
(16013, 121, 3, 'NARRATOR', 'The list is locked, but lists are made by people — and people can be found.', 'How do you start?'),
(16021, 122, 1, 'NARRATOR', 'You remember Seyi — old classmate, now somehow the door manager. One call, straight to voicemail. Second call: "Who be this?"', NULL),
(16022, 122, 2, 'SEYI', 'Ah! My guy! Longest time. You wan enter tonight? E go hard o... but for old times sake, come around 11. No African time.', NULL),
(16023, 122, 3, 'NARRATOR', 'A maybe. In Lagos nightlife, a maybe is a door.', 'How do you play it?'),
(16031, 123, 1, 'NARRATOR', 'Inside. The air is perfume and bass. Then the whisper spreads table to table: the headline DJ''s flight got cancelled. No DJ, no night.', NULL),
(16032, 123, 2, 'SEYI', 'Omo, wahala dey. If this night flops, na my head. You sabi anybody wey fit hold crowd?', NULL),
(16033, 123, 3, 'NARRATOR', 'You do know somebody — DJ Kola, underground king, fifteen minutes away if he moves now.', 'What do you do?'),
(16041, 124, 1, 'NARRATOR', 'DJ Kola walks in like he owns the decks — and within twenty minutes, he does. The floor is a single moving body. The owner watches from the VIP rail.', NULL),
(16042, 124, 2, 'OWNER', 'You. The one who made the call. Come — let''s talk.', NULL),
(16043, 124, 3, 'NARRATOR', 'The owner''s table. Bottles you cannot pronounce. This is the room where Lagos nights get decided.', 'How do you carry yourself?'),
(16051, 125, 1, 'NARRATOR', '3am. The owner slides a card across the table: a residency plug — your people, your nights, your cut. "You sabi move rooms," he says.', NULL),
(16052, 125, 2, 'NARRATOR', 'You walked in with no list. You are leaving with a business.', NULL),
(16053, 125, 3, 'NARRATOR', 'Lagos rewards the bold — but only the bold who deliver.', 'What do you take from the night?')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp, reward_rep, reward_gems) VALUES
(26011, 16013, 'Call every plug you know', 'Work the phones', 16021, 0, 0, 4, 0),
(26012, 16013, 'Show up early and charm the door', 'Confidence entry', 16021, 0, 0, 4, 0),
(26021, 16023, 'Arrive 10:55 sharp, clean', 'Respect the maybe', 16031, -5000, 0, 5, 0),
(26022, 16023, 'Roll deep with your crew', 'Numbers impress', 16031, 0, 0, 4, 0),
(26031, 16033, 'Call DJ Kola now', 'Save the night', 16041, 0, 100, 7, 1),
(26032, 16033, 'Keep it to yourself', 'Not your wahala', 16041, 1000, 0, 2, 0),
(26041, 16043, 'Calm, grateful, sharp', 'Owner energy', 16051, 5000, 100, 6, 0),
(26042, 16043, 'Pitch your own night idea', 'Bold moves', 16051, 0, 150, 7, 1),
(26051, 16053, 'Take the residency plug', 'Build the empire', NULL, 25000, 0, 8, 1),
(26052, 16053, 'Take the cash thank-you', 'Secure the bag', NULL, 100000, 0, 5, 0)
ON CONFLICT(id) DO NOTHING;
