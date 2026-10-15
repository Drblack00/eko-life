import { useCallback, useEffect, useRef, useState } from "react";
import { storyApi, type StoryDetail, type StoryListItem, type StoryScene } from "../../lib/api";
import "./StoryApp.css";

/** Format coins as ₦ with thousands separators. */
function formatNaira(n: number): string {
  return "₦" + Math.floor(Number(n) || 0).toLocaleString("en-NG");
}

type ChatMsg =
  | { key: string; kind: "them"; scene: StoryScene; chapterNo: number }
  | { key: string; kind: "me"; text: string }
  | { key: string; kind: "divider"; text: string }
  | { key: string; kind: "notice"; text: string };

type Cursor = { chapterNo: number; sceneNo: number };

/**
 * Story Questlines — stories as phone chat threads (mockup story-option-c).
 *
 * The list reads like messaging threads (cover-emoji avatar, synopsis
 * snippet, unread badge). Tapping a thread opens the "chat": scenes play
 * out as live message bubbles (speaker name above each bubble) and the
 * player replies by tapping reply bubbles at the bottom.
 */
export function StoryApp({ token }: { token: string }) {
  const [stories, setStories] = useState<StoryListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  // Stories whose unread badge was cleared by opening the thread.
  const [readIds, setReadIds] = useState<Set<number>>(new Set());

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await storyApi.list(token);
      setStories(r.stories);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load stories.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const newCount = (stories || []).filter(
    (s) => s.unread > 0 && !readIds.has(s.id)
  ).length;

  const openStory = (id: number) => {
    setReadIds((prev) => new Set(prev).add(id));
    setOpenId(id);
  };

  const closeChat = () => {
    setOpenId(null);
    void loadList();
  };

  if (openId != null) {
    const meta = (stories || []).find((s) => s.id === openId);
    return (
      <StoryChat
        token={token}
        storyId={openId}
        title={meta ? meta.title : "Story"}
        coverEmoji={meta ? meta.coverEmoji : "📖"}
        onBack={closeChat}
        onNewContent={() =>
          setReadIds((prev) => {
            if (!prev.has(openId)) return prev;
            const next = new Set(prev);
            next.delete(openId);
            return next;
          })
        }
      />
    );
  }

  return (
    <div className="story-app">
      <div className="story-hd">
        <b>Stories 💬</b>
        {newCount > 0 && <span className="story-unread-pill">{newCount} new</span>}
      </div>
      {loading && <p className="story-tip">Loading stories…</p>}
      {error && <p className="story-tip story-err">{error}</p>}
      {!loading && !error && (stories || []).length === 0 && (
        <p className="story-tip">No stories yet. Check back soon 📖</p>
      )}
      {(stories || []).map((s) => {
        const unread = !readIds.has(s.id) ? s.unread : 0;
        const status = s.completed ? "Done ✓" : s.progress ? `Ch. ${s.progress.chapterNo}` : "New";
        return (
          <button key={s.id} className="story-thread" onClick={() => openStory(s.id)}>
            <span className="story-ava">{s.coverEmoji}</span>
            <span className="story-inf">
              <b>{s.title}</b>
              <p>{s.synopsis}</p>
            </span>
            <span className="story-rt">
              <span className="story-lbl">{status}</span>
              <br />
              {unread > 0 && <span className="story-badge">{unread}</span>}
            </span>
          </button>
        );
      })}
      {/* Locked teaser — more threads unlock as stories finish. */}
      <div className="story-thread story-locked">
        <span className="story-ava">🔒</span>
        <span className="story-inf">
          <b>More stories</b>
          <p className="story-locked-txt">🔒 Finish a story to unlock</p>
        </span>
        <span className="story-rt">
          <span className="story-lbl">—</span>
        </span>
      </div>
      <div className="story-foot">
        Stories continue when characters message you.
        <br />
        Keep your phone close 📱
      </div>
    </div>
  );
}

const REVEAL_MS = 650;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function StoryChat({
  token,
  storyId,
  title,
  coverEmoji,
  onBack,
  onNewContent,
}: {
  token: string;
  storyId: number;
  title: string;
  coverEmoji: string;
  onBack: () => void;
  onNewContent: () => void;
}) {
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [pending, setPending] = useState<StoryScene | null>(null);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [pos, setPos] = useState<Cursor | null>(null);

  const runId = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastDivChapter = useRef(0);

  const alive = (gen: number) => runId.current === gen;

  const scrollDown = () => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useEffect(scrollDown, [msgs, typing, pending]);

  const findScene = useCallback((d: StoryDetail, c: Cursor) => {
    const ch = d.chapters.find((x) => x.chapterNo === c.chapterNo && !x.locked);
    const sc = ch ? ch.scenes.find((s) => s.sceneNo === c.sceneNo) : undefined;
    return { ch, sc };
  }, []);

  const pushDivider = useCallback((chapterNo: number, chapterTitle: string) => {
    if (lastDivChapter.current === chapterNo) return;
    lastDivChapter.current = chapterNo;
    setMsgs((m) => [
      ...m,
      { key: `div-${chapterNo}`, kind: "divider", text: `Chapter ${chapterNo} — ${chapterTitle}` },
    ]);
  }, []);

  const markFinished = useCallback(() => {
    setFinished(true);
    setPending(null);
    setTyping(false);
    setMsgs((m) => [...m, { key: `end-${Date.now()}`, kind: "notice", text: "🎬 THE END — thanks for playing!" }]);
  }, []);

  /**
   * Reveal scenes from the cursor as a live chat. Narrative (choiceless)
   * scenes auto-advance on the server; decision scenes stop the loop and
   * surface reply bubbles via `pending`.
   */
  const runLoop = useCallback(
    async (d: StoryDetail, cursor: Cursor, gen: number) => {
      let cur = { ...cursor };
      let live = d;
      for (;;) {
        if (!alive(gen)) return;
        const { ch, sc } = findScene(live, cur);
        if (!ch || !sc) return;
        pushDivider(ch.chapterNo, ch.title);
        setTyping(true);
        await delay(REVEAL_MS);
        if (!alive(gen)) return;
        setTyping(false);
        setMsgs((m) => [
          ...m,
          { key: `s-${ch.chapterNo}-${sc.sceneNo}-${Date.now()}`, kind: "them", scene: sc, chapterNo: ch.chapterNo },
        ]);
        if (sc.choices.length > 0) {
          setPending(sc);
          return;
        }
        const r = await storyApi.advance(token, storyId, cur.chapterNo, cur.sceneNo, null);
        if (!alive(gen)) return;
        const next = { chapterNo: r.progress.chapterNo, sceneNo: r.progress.sceneNo };
        setPos(next);
        if (next.chapterNo !== cur.chapterNo) onNewContent();
        if (r.completed) {
          markFinished();
          return;
        }
        if (next.chapterNo !== cur.chapterNo) {
          const d2 = await storyApi.detail(token, storyId);
          if (!alive(gen)) return;
          live = d2;
          setDetail(d2);
        }
        cur = next;
      }
    },
    [token, storyId, findScene, pushDivider, markFinished, onNewContent]
  );

  // Open: load detail, show history instantly, then play the live chat.
  useEffect(() => {
    const gen = ++runId.current;
    lastDivChapter.current = 0;
    let cancelled = false;
    (async () => {
      try {
        const d = await storyApi.detail(token, storyId);
        if (cancelled || !alive(gen)) return;
        setDetail(d);
        if (d.completed) {
          setFinished(true);
          const all: ChatMsg[] = [];
          for (const ch of d.chapters) {
            if (ch.locked || ch.scenes.length === 0) continue;
            all.push({ key: `div-${ch.chapterNo}`, kind: "divider", text: `Chapter ${ch.chapterNo} — ${ch.title}` });
            for (const sc of ch.scenes) {
              all.push({ key: `h-${ch.chapterNo}-${sc.sceneNo}`, kind: "them", scene: sc, chapterNo: ch.chapterNo });
            }
          }
          all.push({ key: "done", kind: "notice", text: "🎬 THE END — thanks for playing!" });
          setMsgs(all);
          setPos(d.progress ? { chapterNo: d.progress.chapterNo, sceneNo: d.progress.sceneNo } : null);
          return;
        }
        const start: Cursor = d.progress
          ? { chapterNo: d.progress.chapterNo, sceneNo: d.progress.sceneNo }
          : { chapterNo: 1, sceneNo: 1 };
        setPos(start);
        // History: everything before the cursor, rendered instantly.
        const hist: ChatMsg[] = [];
        for (const ch of d.chapters) {
          if (ch.locked) continue;
          let added = false;
          for (const sc of ch.scenes) {
            const past =
              ch.chapterNo < start.chapterNo ||
              (ch.chapterNo === start.chapterNo && sc.sceneNo < start.sceneNo);
            if (!past) continue;
            if (!added) {
              hist.push({
                key: `div-${ch.chapterNo}`,
                kind: "divider",
                text: `Chapter ${ch.chapterNo} — ${ch.title}`,
              });
              added = true;
              lastDivChapter.current = ch.chapterNo;
            }
            hist.push({ key: `h-${ch.chapterNo}-${sc.sceneNo}`, kind: "them", scene: sc, chapterNo: ch.chapterNo });
          }
        }
        setMsgs(hist);
        await runLoop(d, start, gen);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't open the story.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, storyId]);

  /** Player taps a reply bubble. */
  const choose = async (scene: StoryScene, choiceId: number) => {
    if (busy || !detail || !pos) return;
    const gen = runId.current;
    const choice = scene.choices.find((c) => c.id === choiceId);
    if (!choice) return;
    setBusy(true);
    setPending(null);
    setNotice(null);
    setError(null);
    setMsgs((m) => [...m, { key: `me-${Date.now()}`, kind: "me", text: choice.label }]);
    try {
      const r = await storyApi.advance(token, storyId, pos.chapterNo, pos.sceneNo, choiceId);
      if (!alive(gen)) return;
      const rewards: string[] = [];
      if (r.reward.coins > 0) rewards.push(`+${formatNaira(r.reward.coins)}`);
      if (r.reward.xp > 0)
        rewards.push(`+${r.reward.xp} music XP${r.reward.leveledUp ? ` ⬆️ Lv ${r.reward.skillLevel}` : ""}`);
      if (rewards.length > 0) setNotice(rewards.join(" · "));
      const next = { chapterNo: r.progress.chapterNo, sceneNo: r.progress.sceneNo };
      setPos(next);
      if (next.chapterNo !== pos.chapterNo) onNewContent();
      if (r.completed) {
        markFinished();
        return;
      }
      let live = detail;
      if (next.chapterNo !== pos.chapterNo) {
        const d2 = await storyApi.detail(token, storyId);
        if (!alive(gen)) return;
        live = d2;
        setDetail(d2);
      }
      await runLoop(live, next, gen);
    } catch (e) {
      setPending(scene);
      setError(e instanceof Error ? e.message : "That reply didn't send.");
    } finally {
      setBusy(false);
    }
  };

  const sub =
    pos && !finished
      ? `● online — Ch. ${pos.chapterNo} · Scene ${pos.sceneNo}`
      : finished
        ? "✓ finished"
        : "● online";

  return (
    <div className="story-app">
      <div className="story-chtop">
        <button className="story-back" onClick={onBack} aria-label="Back to stories">
          ‹
        </button>
        <span className="story-ava story-ava-sm">{coverEmoji}</span>
        <div className="story-chtitle">
          <b>{title}</b>
          <span className="story-lbl story-online">{sub}</span>
        </div>
      </div>
      {error && <p className="story-tip story-err">{error}</p>}
      <div className="story-chbody" ref={bodyRef}>
        {msgs.map((m) => {
          if (m.kind === "divider") return <div key={m.key} className="story-divider">{m.text}</div>;
          if (m.kind === "notice") return <div key={m.key} className="story-notice">{m.text}</div>;
          if (m.kind === "me")
            return (
              <div key={m.key} className="story-bub story-me">
                {m.text}
                <span className="story-tm">✓✓</span>
              </div>
            );
          return (
            <div key={m.key} className="story-bub story-them">
              <span className="story-who">{m.scene.speaker}</span>
              {m.scene.text}
            </div>
          );
        })}
        {typing && <div className="story-typing">●●●</div>}
      </div>
      {notice && <div className="story-reward">{notice}</div>}
      <div className="story-replies">
        {pending &&
          pending.choices.map((c) => (
            <button key={c.id} className="story-reply" disabled={busy} onClick={() => choose(pending, c.id)}>
              <span className="story-reply-label">{c.label}</span>
              {c.consequenceHint && <span className="story-reply-hint">{c.consequenceHint}</span>}
            </button>
          ))}
        {!pending && !finished && detail && <p className="story-tip">The story continues…</p>}
        {finished && <p className="story-tip">Replay anytime from the thread list 📖</p>}
      </div>
    </div>
  );
}
