-- dialect: both
-- 003-story.sql — Story Questlines: chat-thread story arcs with tappable
-- reply-bubble choices. Portable SQL (SQLite + Postgres).
-- Seed: one complete original arc, "Danfo to Headline" (9 chapters).
-- Idempotent: IF NOT EXISTS + ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  synopsis TEXT NOT NULL,
  chapters_count INTEGER NOT NULL DEFAULT 0,
  cover_emoji TEXT NOT NULL DEFAULT '📖',
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS story_chapters (
  id INTEGER PRIMARY KEY,
  story_id INTEGER NOT NULL,
  chapter_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  UNIQUE(story_id, chapter_no)
);

CREATE TABLE IF NOT EXISTS story_scenes (
  id INTEGER PRIMARY KEY,
  chapter_id INTEGER NOT NULL,
  scene_no INTEGER NOT NULL,
  speaker TEXT NOT NULL DEFAULT 'narrator',
  text TEXT NOT NULL,
  choice_prompt TEXT,
  UNIQUE(chapter_id, scene_no)
);

CREATE TABLE IF NOT EXISTS story_choices (
  id INTEGER PRIMARY KEY,
  scene_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  consequence_hint TEXT,
  next_scene_id INTEGER,
  reward_coins INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS story_progress (
  user_id INTEGER NOT NULL,
  story_id INTEGER NOT NULL,
  chapter_no INTEGER NOT NULL DEFAULT 1,
  scene_no INTEGER NOT NULL DEFAULT 1,
  completed_at INTEGER,
  PRIMARY KEY (user_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_story_chapters_story ON story_chapters(story_id);
CREATE INDEX IF NOT EXISTS idx_story_scenes_chapter ON story_scenes(chapter_id);
CREATE INDEX IF NOT EXISTS idx_story_choices_scene ON story_choices(scene_id);

-- ============ SEED: "Danfo to Headline" (story id 1) ============

INSERT INTO stories (id, title, synopsis, chapters_count, cover_emoji) VALUES
(1, 'Danfo to Headline',
 'A danfo conductor''s Oshodi freestyle blows up overnight — park loyalty or music stardom? Every reply you tap writes the ending.',
 9, '🚌')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_chapters (id, story_id, chapter_no, title) VALUES
(1, 1, 1, 'Oshodi Under-Bridge'),
(2, 1, 2, 'The Video Don Blow'),
(3, 1, 3, 'Studio. Tonight.'),
(4, 1, 4, 'Paperwork'),
(5, 1, 5, 'The Park Calls'),
(6, 1, 6, 'Detty December'),
(7, 1, 7, 'Headline'),
(8, 1, 8, 'Encore: The Label Path'),
(9, 1, 9, 'Encore: Street King')
ON CONFLICT(id) DO NOTHING;

-- Chapter 1: Oshodi Under-Bridge
INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(101, 1, 1, 'NARRATOR', 'Oshodi under-bridge, 5:48pm. Your danfo is packed — market women, students, one tired civil servant. Somebody''s phone is blasting an old freestyle.', NULL),
(102, 1, 2, 'SEYI', 'Guy, do that your thing na. That verse about CMS traffic.', NULL),
(103, 1, 3, 'NARRATOR', 'Forty eyes on you. The engine is off. Somebody shouts: "CONDUCTOR DON TURN ARTISTE!"', NULL),
(104, 1, 4, 'SEYI', 'No dull. Na your moment be this.', NULL),
(105, 1, 5, 'SEYI', 'So? The whole bus dey wait.', 'The whole bus is watching. What do you do?'),
(106, 1, 6, 'NARRATOR', 'Seyi''s phone was recording. By midnight the clip is in three WhatsApp groups.', NULL)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp) VALUES
(1, 105, '🎤 Freestyle am — full chest.', 'The park will talk. Risky, but real.', NULL, 0, 25),
(2, 105, '🙈 Laugh am off — "no be my work be that."', 'Safe. The moment dies here.', NULL, 50, 5)
ON CONFLICT(id) DO NOTHING;

-- Chapter 2: The Video Don Blow
INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(201, 2, 1, 'NARRATOR', 'Next morning. 47 new messages. One repost of your freestyle don hit 80k views.', NULL),
(202, 2, 2, 'SEYI', 'GUYYYY! @LagosStreetzTV don post am. 80k views and e still dey rise!', NULL),
(203, 2, 3, 'MUMMY', 'Tunde, your uncle sent me a video. Is that you shouting inside bus?? 😂', NULL),
(204, 2, 4, 'BABA T', 'Conductor. Park office. Now.', NULL),
(205, 2, 5, 'BABA T', 'So na true. You wan turn star for my park?', 'Baba T is watching you like a paternity test result.'),
(206, 2, 6, 'NARRATOR', 'Baba T grunts. "Park first. Music second. No confusion." But something has shifted.', NULL)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp) VALUES
(3, 205, '🫡 "Baba, na just freestyle."', 'Respect keeps the park peaceful.', NULL, 0, 10),
(4, 205, '🎙️ "Baba, music fit change my life o."', 'Bold. He respects bold — or crushes it.', NULL, 0, 20)
ON CONFLICT(id) DO NOTHING;

-- Chapter 3: Studio. Tonight.
INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(301, 3, 1, 'NARRATOR', 'Friday, 6:40pm. A G-Wagon hazards at the junction. A card slides through your window: KB RECORDS, SURULERE.', NULL),
(302, 3, 2, 'KB', 'You. Studio. Tonight. Don''t dull yourself.', NULL),
(303, 3, 3, 'KB', 'Your evening route starts in 20 minutes. I know. Choose.', 'Your evening route starts in 20 minutes.'),
(304, 3, 4, 'NARRATOR', 'Surulere. The studio smells of AC and money. A beat drops — heavy log drums.', NULL),
(305, 3, 5, 'SEYI', 'Guy this na YOUR beat. The one from my laptop. Remember?', NULL),
(306, 3, 6, 'ENGINEER', 'Mic is live. Whenever you ready.', 'The engineer points at the mic.'),
(307, 3, 7, 'KB', 'Hmm. Come back Monday. We go talk numbers.', NULL)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp) VALUES
(5, 303, '🎙️ "I''m in. Send the address."', 'Lose tonight''s route money. Gain a shot.', NULL, 0, 40),
(6, 303, '🚌 "Make I finish my route first."', 'Keep tonight''s ₦3,500. KB may not wait.', NULL, 3500, 5),
(7, 306, '🔥 Record the Oshodi freestyle.', 'Raw and true. The streets will feel it.', NULL, 0, 50),
(8, 306, '✨ Try the new love song Seyi wrote.', 'Softer. Radio might like it.', NULL, 0, 40)
ON CONFLICT(id) DO NOTHING;

-- Chapter 4: Paperwork
INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(401, 4, 1, 'NARRATOR', 'Monday. An office with a glass table. A man called Deji slides a contract across — 14 pages.', NULL),
(402, 4, 2, 'DEJI', 'Standard 360 deal. We push you, we chop small percentage. Sign here.', NULL),
(403, 4, 3, 'SEYI', 'Guy, no sign anything today o. Make lawyer see am first.', NULL),
(404, 4, 4, 'DEJI', 'So? Pen dey here.', 'Deji is tapping his pen.'),
(405, 4, 5, 'NARRATOR', 'Deji nods slowly. "Sharp guy." The papers go into a folder — signed or not.', NULL),
(406, 4, 6, 'MUMMY', 'Tunde, your father said music people no dey pay house rent. Call me.', NULL)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp) VALUES
(9, 404, '✍️ Sign it now — no time to waste.', '₦200k advance today. But 360 means 360.', NULL, 200000, 10),
(10, 404, '📄 "I go carry am go show my lawyer."', 'No advance today. But you keep your power.', NULL, 0, 30),
(11, 404, '🤝 "Make we do single first, no album."', 'Smaller deal, smaller risk.', NULL, 50000, 25)
ON CONFLICT(id) DO NOTHING;

-- Chapter 5: The Park Calls
INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(501, 5, 1, 'NARRATOR', 'Wednesday. Baba T summons you. The park boys are all there — arms folded.', NULL),
(502, 5, 2, 'BABA T', 'So na true. You wan leave the park for music.', NULL),
(503, 5, 3, 'BABA T', 'This park feed you when nobody know your name.', NULL),
(504, 5, 4, 'BABA T', 'Talk. We dey listen.', 'Everybody is quiet. Your answer decides everything.'),
(505, 5, 5, 'NARRATOR', 'Baba T stares for a long time. Then: "No forget where you come from." Meeting over.', NULL),
(506, 5, 6, 'SEYI', 'Guy, Detty December show — mainland stadium. KB wants you on the lineup!', NULL),
(507, 5, 7, 'NARRATOR', 'One show. Twenty thousand people. This is the one.', NULL)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp) VALUES
(12, 504, '🫡 "Baba, park na my home. Music na my hustle."', 'Loyalty keeps the streets behind you.', NULL, 10000, 20),
(13, 504, '🎤 "Baba, I must chase this. Na my destiny."', 'The park may turn cold.', NULL, 0, 40)
ON CONFLICT(id) DO NOTHING;

-- Chapter 6: Detty December
INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(601, 6, 1, 'NARRATOR', 'December 22nd. Mainland stadium. The crowd is a sea of phone lights.', NULL),
(602, 6, 2, 'KB', 'You go on in ten minutes. No shaking.', NULL),
(603, 6, 3, 'MUMMY', 'I dey front row with your sister! Make us proud 😭❤️', NULL),
(604, 6, 4, 'KB', 'Wetin you go open with?', 'Stage fright is real. What''s your first move?'),
(605, 6, 5, 'NARRATOR', 'The crowd doesn''t just cheer — it ROARS. Phones everywhere. You''re trending before you leave the stage.', NULL),
(606, 6, 6, 'DEJI', 'Numbers are in. Come office tomorrow. We need to talk about your future.', NULL)
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp) VALUES
(14, 604, '🔥 Open with the Oshodi freestyle.', 'The streets erupt. Pure energy.', NULL, 25000, 60),
(15, 604, '🎵 Open with the new single.', 'Polished. The label smiles.', NULL, 25000, 50),
(16, 604, '🙏 Shout out the park first.', 'Baba T is watching the livestream.', NULL, 15000, 40)
ON CONFLICT(id) DO NOTHING;

-- Chapter 7: Headline
INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(701, 7, 1, 'NARRATOR', 'Deji''s office. Two folders on the glass table.', NULL),
(702, 7, 2, 'DEJI', 'Folder one: 3-album label deal. Big money. Big machine.', NULL),
(703, 7, 3, 'DEJI', 'Folder two: distribution only. You stay independent — the park, the streets, all yours.', NULL),
(704, 7, 4, 'BABA T', 'Whatever you pick, boy — no forget who carried you when danfo break down for Mile 2.', NULL),
(705, 7, 5, 'MUMMY', 'Pray about it, Tunde. Then choose like a man.', NULL),
(706, 7, 6, 'SEYI', 'Guy… this is the biggest decision of your life. No pressure 😅', NULL),
(707, 7, 7, 'DEJI', 'So? Which folder?', 'Two folders. One future.')
ON CONFLICT(id) DO NOTHING;

INSERT INTO story_choices (id, scene_id, label, consequence_hint, next_scene_id, reward_coins, reward_xp) VALUES
(17, 707, '📝 Sign the label deal.', 'Big machine, big money, big rules.', 801, 500000, 100),
(18, 707, '👑 Stay independent — street king.', 'Your crown, your rules, your risk.', 901, 100000, 120)
ON CONFLICT(id) DO NOTHING;

-- Chapter 8: Encore — The Label Path (reached only via choice 17)
INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(801, 8, 1, 'NARRATOR', 'Six months later. Your face is on billboards from Lekki to Ikeja. The single is at 12 million streams.', NULL),
(802, 8, 2, 'SEYI', 'Guy, we made it. But… you miss the danfo sometimes, abi?', NULL),
(803, 8, 3, 'NARRATOR', 'You smile. "Oshodi made me. Nothing fit erase that." THE END — Label Path 📝', NULL)
ON CONFLICT(id) DO NOTHING;

-- Chapter 9: Encore — Street King (reached only via choice 18)
INSERT INTO story_scenes (id, chapter_id, scene_no, speaker, text, choice_prompt) VALUES
(901, 9, 1, 'NARRATOR', 'Six months later. Your own label — Oshodi Records. You sign two park boys.', NULL),
(902, 9, 2, 'BABA T', 'You no forget us. That''s why the streets will never forget you.', NULL),
(903, 9, 3, 'NARRATOR', 'Detty December again. This time YOU headline — and the whole park is in the front row. THE END — Street King 👑', NULL)
ON CONFLICT(id) DO NOTHING;
