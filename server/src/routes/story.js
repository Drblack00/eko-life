// ============================================================
// routes/story.js — Story Questlines REST API.
//
// Stories play out as phone chat threads: scenes are chat messages,
// and decision scenes offer tappable reply-bubble choices. Progress
// is per user + story; advancing validates the choice server-side
// and applies coin / music-skill-XP rewards. Gameplay coins only.
// ============================================================
import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import {
  getUserById,
  ensureCharacter,
  saveCharacter,
  addTransaction,
  dbAll,
  dbGet,
  dbRun,
} from '../db.js';
import { addSkillXp } from '../game/v2/m12.js';
// PORT-P1: rep + gem rewards, net-worth gating.
import { addRep, grantGems, netWorth } from '../game/vitality.js';

const STORY_SKILL = 'music';

export function createStoryRouter() {
  const router = Router();
  router.use(authMiddleware);

  async function authedUser(req, res) {
    const user = await getUserById(req.userId);
    if (!user) { res.status(401).json({ error: 'Account not found.' }); return null; }
    if (Number(user.banned)) { res.status(403).json({ error: 'This account is banned.' }); return null; }
    return user;
  }

  function storyIdOf(req, res) {
    const id = Math.floor(Number(req.params.id));
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Bad story id.' });
      return null;
    }
    return id;
  }

  async function getProgress(userId, storyId) {
    return dbGet(
      'SELECT * FROM story_progress WHERE user_id=? AND story_id=?',
      'SELECT * FROM story_progress WHERE user_id=$1 AND story_id=$2',
      [userId, storyId]);
  }

  /** Chapters remaining (unread badge count). 0 when completed. */
  function unreadCount(story, progress) {
    if (!progress) return Number(story.chapters_count) || 0;
    if (progress.completed_at) return 0;
    return Math.max(0, (Number(story.chapters_count) || 0) - (Number(progress.chapter_no) - 1));
  }

  // ---- GET /api/stories — list with per-user unread/progress badges ----
  router.get('/', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const stories = await dbAll(
      // PORT-P1: net-worth gate + completion rewards
      'SELECT id, title, synopsis, chapters_count, cover_emoji, net_worth_req, reward_rep, reward_gems FROM stories ORDER BY id ASC',
      'SELECT id, title, synopsis, chapters_count, cover_emoji, net_worth_req, reward_rep, reward_gems FROM stories ORDER BY id ASC',
      []);
    const progs = await dbAll(
      'SELECT story_id, chapter_no, scene_no, completed_at FROM story_progress WHERE user_id=?',
      'SELECT story_id, chapter_no, scene_no, completed_at FROM story_progress WHERE user_id=$1',
      [req.userId]);
    const byStory = new Map(progs.map((p) => [Number(p.story_id), p]));
    const char = await ensureCharacter(req.userId);
    const worth = netWorth(char);
    res.json({
      stories: stories.map((s) => {
        const p = byStory.get(Number(s.id)) || null;
        const reqWorth = Math.max(0, Math.floor(Number(s.net_worth_req) || 0));
        return {
          id: Number(s.id),
          title: s.title,
          synopsis: s.synopsis,
          chaptersCount: Number(s.chapters_count) || 0,
          coverEmoji: s.cover_emoji,
          unread: unreadCount(s, p),
          completed: !!(p && p.completed_at),
          progress: p
            ? { chapterNo: Number(p.chapter_no), sceneNo: Number(p.scene_no) }
            : null,
          // PORT-P1: net-worth lock + completion rewards
          locked: reqWorth > 0 && worth < reqWorth,
          netWorthReq: reqWorth,
          rewardRep: Math.max(0, Math.floor(Number(s.reward_rep) || 0)),
          rewardGems: Math.max(0, Math.floor(Number(s.reward_gems) || 0)),
        };
      }),
    });
  });

  // ---- GET /api/stories/:id — chapters + scenes up to progress ----
  router.get('/:id', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const storyId = storyIdOf(req, res);
    if (!storyId) return;
    const story = await dbGet(
      // PORT-P1: net-worth gate + completion rewards
      'SELECT id, title, synopsis, chapters_count, cover_emoji, net_worth_req, reward_rep, reward_gems FROM stories WHERE id=?',
      'SELECT id, title, synopsis, chapters_count, cover_emoji, net_worth_req, reward_rep, reward_gems FROM stories WHERE id=$1',
      [storyId]);
    if (!story) return res.status(404).json({ error: 'Story not found.' });

    // PORT-P1: net-worth lock enforced on read + advance
    const gateChar = await ensureCharacter(req.userId);
    const gateReq = Math.max(0, Math.floor(Number(story.net_worth_req) || 0));
    const gateLocked = gateReq > 0 && netWorth(gateChar) < gateReq;
    if (gateLocked) {
      return res.status(403).json({
        error: 'This story is for big men only — build your net worth first. 🔒',
        locked: true,
        netWorthReq: gateReq,
        netWorth: netWorth(gateChar),
      });
    }

    const progress = await getProgress(req.userId, storyId);
    const completed = !!(progress && progress.completed_at);
    const currentChapter = progress ? Number(progress.chapter_no) : 1;

    const chapters = await dbAll(
      'SELECT id, chapter_no, title FROM story_chapters WHERE story_id=? ORDER BY chapter_no ASC',
      'SELECT id, chapter_no, title FROM story_chapters WHERE story_id=$1 ORDER BY chapter_no ASC',
      [storyId]);

    const out = [];
    for (const ch of chapters) {
      const chapterNo = Number(ch.chapter_no);
      const locked = !completed && chapterNo > currentChapter;
      const row = {
        id: Number(ch.id),
        chapterNo,
        title: ch.title,
        locked,
        scenes: [],
      };
      if (!locked) {
        const scenes = await dbAll(
          'SELECT id, scene_no, speaker, text, choice_prompt FROM story_scenes WHERE chapter_id=? ORDER BY scene_no ASC',
          'SELECT id, scene_no, speaker, text, choice_prompt FROM story_scenes WHERE chapter_id=$1 ORDER BY scene_no ASC',
          [ch.id]);
        for (const sc of scenes) {
          const choices = await dbAll(
            // PORT-P1: rep + gem rewards on choices
            'SELECT id, label, consequence_hint, reward_coins, reward_xp, reward_rep, reward_gems FROM story_choices WHERE scene_id=? ORDER BY id ASC',
            'SELECT id, label, consequence_hint, reward_coins, reward_xp, reward_rep, reward_gems FROM story_choices WHERE scene_id=$1 ORDER BY id ASC',
            [sc.id]);
          row.scenes.push({
            id: Number(sc.id),
            sceneNo: Number(sc.scene_no),
            speaker: sc.speaker,
            text: sc.text,
            choicePrompt: sc.choice_prompt || null,
            choices: choices.map((c) => ({
              id: Number(c.id),
              label: c.label,
              consequenceHint: c.consequence_hint || null,
              rewardCoins: Number(c.reward_coins) || 0,
              rewardXp: Number(c.reward_xp) || 0,
              rewardRep: Math.max(0, Math.floor(Number(c.reward_rep) || 0)),
              rewardGems: Math.max(0, Math.floor(Number(c.reward_gems) || 0)),
            })),
          });
        }
      }
      out.push(row);
    }

    res.json({
      story: {
        id: Number(story.id),
        title: story.title,
        synopsis: story.synopsis,
        chaptersCount: Number(story.chapters_count) || 0,
        coverEmoji: story.cover_emoji,
        // PORT-P1
        locked: false,
        netWorthReq: gateReq,
        rewardRep: Math.max(0, Math.floor(Number(story.reward_rep) || 0)),
        rewardGems: Math.max(0, Math.floor(Number(story.reward_gems) || 0)),
      },
      completed,
      progress: progress
        ? {
            chapterNo: Number(progress.chapter_no),
            sceneNo: Number(progress.scene_no),
            completedAt: progress.completed_at ? Number(progress.completed_at) : null,
          }
        : null,
      chapters: out,
    });
  });

  // ---- POST /api/stories/:id/advance — tap a reply bubble ----
  router.post('/:id/advance', async (req, res) => {
    const user = await authedUser(req, res);
    if (!user) return;
    const storyId = storyIdOf(req, res);
    if (!storyId) return;
    const story = await dbGet(
      // PORT-P1: net-worth gate + completion rewards
      'SELECT id, title, chapters_count, net_worth_req, reward_rep, reward_gems FROM stories WHERE id=?',
      'SELECT id, title, chapters_count, net_worth_req, reward_rep, reward_gems FROM stories WHERE id=$1',
      [storyId]);
    if (!story) return res.status(404).json({ error: 'Story not found.' });
    // PORT-P1: net-worth lock enforced on advance too
    {
      const gateChar = await ensureCharacter(req.userId);
      const gateReq = Math.max(0, Math.floor(Number(story.net_worth_req) || 0));
      if (gateReq > 0 && netWorth(gateChar) < gateReq) {
        return res.status(403).json({ error: 'This story is for big men only — build your net worth first. 🔒', locked: true });
      }
    }

    const bodyChapter = Math.floor(Number(req.body && req.body.chapter_no));
    const bodyScene = Math.floor(Number(req.body && req.body.scene_no));
    const choiceId = req.body && req.body.choice_id != null ? Math.floor(Number(req.body.choice_id)) : null;

    const progress = await getProgress(req.userId, storyId);
    if (progress && progress.completed_at) {
      return res.status(400).json({ error: 'Story already finished.' });
    }
    const curChapter = progress ? Number(progress.chapter_no) : 1;
    const curScene = progress ? Number(progress.scene_no) : 1;
    if (bodyChapter !== curChapter || bodyScene !== curScene) {
      return res.status(400).json({ error: 'Out of sync — reload the story.' });
    }

    const chapter = await dbGet(
      'SELECT id FROM story_chapters WHERE story_id=? AND chapter_no=?',
      'SELECT id FROM story_chapters WHERE story_id=$1 AND chapter_no=$2',
      [storyId, curChapter]);
    if (!chapter) return res.status(400).json({ error: 'Out of sync — reload the story.' });
    const scene = await dbGet(
      'SELECT id, scene_no FROM story_scenes WHERE chapter_id=? AND scene_no=?',
      'SELECT id, scene_no FROM story_scenes WHERE chapter_id=$1 AND scene_no=$2',
      [chapter.id, curScene]);
    if (!scene) return res.status(400).json({ error: 'Out of sync — reload the story.' });

    const choices = await dbAll(
      // PORT-P1: rep + gem rewards on choices
      'SELECT id, label, next_scene_id, reward_coins, reward_xp, reward_rep, reward_gems FROM story_choices WHERE scene_id=? ORDER BY id ASC',
      'SELECT id, label, next_scene_id, reward_coins, reward_xp, reward_rep, reward_gems FROM story_choices WHERE scene_id=$1 ORDER BY id ASC',
      [scene.id]);

    let picked = null;
    if (choices.length > 0) {
      if (choiceId == null) {
        return res.status(400).json({ error: 'Pick a reply to continue.' });
      }
      picked = choices.find((c) => Number(c.id) === choiceId) || null;
      if (!picked) {
        return res.status(400).json({ error: "That reply doesn't belong here." });
      }
    } else if (choiceId != null) {
      return res.status(400).json({ error: "That reply doesn't belong here." });
    }

    // ---- apply rewards (gameplay coins + music skill XP + rep + gems) ----
    // PORT-P1: negative reward_coins = a choice cost (deducted, must afford).
    const coins = picked ? Math.floor(Number(picked.reward_coins) || 0) : 0;
    const xp = picked ? Math.max(0, Math.floor(Number(picked.reward_xp) || 0)) : 0;
    const repGain = picked ? Math.max(0, Math.floor(Number(picked.reward_rep) || 0)) : 0;
    const gemGain = picked ? Math.max(0, Math.floor(Number(picked.reward_gems) || 0)) : 0;
    let leveledUp = false;
    let skillLevel = 0;
    let repRes = null;
    if (coins !== 0 || xp > 0) {
      const c = await ensureCharacter(req.userId);
      if (coins !== 0) {
        const bal = Math.floor(Number(c.money) || 0);
        if (coins < 0 && bal < -coins) {
          return res.status(400).json({ error: 'You cannot afford that choice.' });
        }
        c.money = Math.max(0, bal + coins);
        await addTransaction(req.userId, coins < 0 ? 'story_cost' : 'story_reward', coins, c.money, {
          story_id: storyId,
          chapter: curChapter,
          scene: curScene,
          choice: picked ? picked.label : null,
        });
      }
      if (xp > 0) {
        const r = addSkillXp(c, STORY_SKILL, xp);
        leveledUp = r.leveledUp;
        skillLevel = r.level;
      }
      await saveCharacter(c);
    }
    if (repGain > 0) repRes = await addRep(req.userId, repGain);
    let gemBalance = null;
    if (gemGain > 0) gemBalance = await grantGems(req.userId, gemGain);

    // ---- advance progress ----
    let next = null; // {chapterNo, sceneNo} or null = story complete
    if (picked && picked.next_scene_id) {
      const target = await dbGet(
        `SELECT s.scene_no AS scene_no, ch.chapter_no AS chapter_no
           FROM story_scenes s JOIN story_chapters ch ON ch.id = s.chapter_id
          WHERE s.id=?`,
        `SELECT s.scene_no AS scene_no, ch.chapter_no AS chapter_no
           FROM story_scenes s JOIN story_chapters ch ON ch.id = s.chapter_id
          WHERE s.id=$1`,
        [picked.next_scene_id]);
      if (target) next = { chapterNo: Number(target.chapter_no), sceneNo: Number(target.scene_no) };
    }
    if (!next) {
      const following = await dbGet(
        'SELECT scene_no FROM story_scenes WHERE chapter_id=? AND scene_no > ? ORDER BY scene_no ASC LIMIT 1',
        'SELECT scene_no FROM story_scenes WHERE chapter_id=$1 AND scene_no > $2 ORDER BY scene_no ASC LIMIT 1',
        [chapter.id, curScene]);
      if (following) {
        next = { chapterNo: curChapter, sceneNo: Number(following.scene_no) };
      } else {
        const nextChapter = await dbGet(
          'SELECT chapter_no FROM story_chapters WHERE story_id=? AND chapter_no > ? ORDER BY chapter_no ASC LIMIT 1',
          'SELECT chapter_no FROM story_chapters WHERE story_id=$1 AND chapter_no=$2 ORDER BY chapter_no ASC LIMIT 1',
          [storyId, curChapter]);
        if (nextChapter) next = { chapterNo: Number(nextChapter.chapter_no), sceneNo: 1 };
      }
    }

    const completed = !next;
    const finalChapter = next ? next.chapterNo : curChapter;
    const finalScene = next ? next.sceneNo : curScene;
    // PORT-P1: story-completion rep + gem bonus (once — progress row is final)
    let completionRep = 0;
    let completionGems = 0;
    if (completed) {
      completionRep = Math.max(0, Math.floor(Number(story.reward_rep) || 0));
      completionGems = Math.max(0, Math.floor(Number(story.reward_gems) || 0));
      if (completionRep > 0) {
        const cr = await addRep(req.userId, completionRep);
        repRes = { rep: cr.rep, level: cr.level, title: cr.title, leveledUp: cr.leveledUp || (repRes && repRes.leveledUp) };
      }
      if (completionGems > 0) gemBalance = await grantGems(req.userId, completionGems);
    }
    await dbRun(
      `INSERT INTO story_progress (user_id, story_id, chapter_no, scene_no, completed_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, story_id) DO UPDATE SET
         chapter_no=excluded.chapter_no, scene_no=excluded.scene_no, completed_at=excluded.completed_at`,
      `INSERT INTO story_progress (user_id, story_id, chapter_no, scene_no, completed_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(user_id, story_id) DO UPDATE SET
         chapter_no=excluded.chapter_no, scene_no=excluded.scene_no, completed_at=excluded.completed_at`,
      [req.userId, storyId, finalChapter, finalScene, completed ? Date.now() : null]);

    res.json({
      ok: true,
      completed,
      progress: { chapterNo: finalChapter, sceneNo: finalScene },
      reward: {
        coins, xp, leveledUp, skill: STORY_SKILL, skillLevel,
        // PORT-P1
        rep: repGain + completionRep,
        repLevel: repRes ? repRes.level : null,
        repTitle: repRes ? repRes.title : null,
        repLeveledUp: !!(repRes && repRes.leveledUp),
        gems: gemGain + completionGems,
        gemBalance,
      },
    });
  });

  return router;
}
