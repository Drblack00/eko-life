import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState, Loading, useToast } from "../../components";
import {
  ApiError,
  GIST_MAX,
  gistsApi,
  headlinesApi,
  type GistComment,
  type GistEntry,
  type GistTab,
  type HeadlineItem,
} from "../../lib/api";
import type { You } from "../../game/types";
import "./GistApp.css";

/**
 * Phase 3 — Gist: the city's social feed (8th phone app).
 * Original social layer: 280-char posts, Latest/Trending/Following/Me
 * tabs, likes, comments, reports — plus a News tab aggregating real
 * Nigerian headlines (title + source + link + short snippet only).
 * Text is rendered as plain text, never HTML.
 */

/** Human time-ago label. Pure (unit-tested). */
export function formatTimeAgo(ts: number | null | undefined): string {
  if (!ts) return "a while ago";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${m}m ago`;
  }
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return `${h}h ago`;
  }
  if (s < 7 * 86400) {
    const d = Math.floor(s / 86400);
    return `${d}d ago`;
  }
  const dt = new Date(ts);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Badge → CSS modifier. Pure (unit-tested). */
export function badgeClass(badge: string): string {
  const b = badge.toLowerCase().replace(/[^a-z]/g, "");
  return `eko-gist__badge--${b || "newkid"}`;
}

const TABS: Array<{ id: GistTab; label: string; icon: string }> = [
  { id: "latest", label: "Latest", icon: "🆕" },
  { id: "trending", label: "Trending", icon: "🔥" },
  { id: "following", label: "Following", icon: "👥" },
  { id: "me", label: "Me", icon: "🙋" },
  { id: "news", label: "News", icon: "📰" },
];

const EMPTY_COPY: Record<GistTab, { title: string; body: string }> = {
  latest: {
    title: "No gists yet — post the first one.",
    body: "Say what's on your mind. The whole city is listening.",
  },
  trending: {
    title: "Nothing trending yet.",
    body: "Gists with the most likes this week show up here.",
  },
  following: {
    title: "Quiet among your friends.",
    body: "Add friends on the Friends app and their gists will land here.",
  },
  me: {
    title: "You haven't posted yet.",
    body: "Your gists will live here. Post your first one above!",
  },
  news: {
    title: "Couldn't load headlines — check back soon.",
    body: "We're fetching the latest Nigerian headlines for you.",
  },
};

interface NamedItem {
  id: string;
  name: string;
}
interface GistConfig {
  locations?: NamedItem[];
  /** Either an array or the server's keyed record of HousingInfo. */
  housing?: NamedItem[] | Record<string, { name: string }>;
  jobs?: NamedItem[];
}

function findName(list: NamedItem[] | undefined, id: string | undefined): string | null {
  if (!id) return null;
  const hit = (list ?? []).find((x) => x.id === id);
  return hit ? hit.name : null;
}

function housingNameOf(
  housing: GistConfig["housing"],
  id: string | undefined
): string | null {
  if (!id) return null;
  if (Array.isArray(housing)) return findName(housing, id) ?? prettifyId(id);
  const rec = housing as Record<string, { name: string }> | undefined;
  // The character row stores ids like 'face-me' while the catalog keys them
  // 'face_me' — try both spellings before falling back to a prettified id.
  for (const k of [id, id.replace(/-/g, "_"), id.replace(/_/g, "-")]) {
    if (rec && rec[k]) return rec[k].name;
  }
  return prettifyId(id);
}

/** 'face-me' → 'Face Me'. Pure (unit-tested). */
export function prettifyId(id: string): string {
  return id
    .split(/[-_]/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function AvatarDot({ avatar, color, username }: { avatar: string; color: string; username: string }) {
  return (
    <span className="eko-gist__avatar" style={{ backgroundColor: color }} aria-hidden="true">
      {avatar || "🧑"}
      <span className="eko-gist__avatar-letter">{username.slice(0, 1).toUpperCase()}</span>
    </span>
  );
}

function CommentBlock({
  comment,
  onDelete,
  canDelete,
}: {
  comment: GistComment;
  onDelete: () => void;
  canDelete: boolean;
}) {
  return (
    <div className="eko-gist__comment">
      <AvatarDot avatar={comment.avatar} color={comment.color} username={comment.username} />
      <div className="eko-gist__comment-body">
        <div className="eko-gist__comment-head">
          <strong>@{comment.username}</strong>
          <span className={`eko-gist__badge ${badgeClass(comment.badge)}`}>{comment.badge}</span>
          <span className="eko-gist__time">{formatTimeAgo(comment.created_at)}</span>
          {canDelete && (
            <button type="button" className="eko-gist__comment-del" onClick={onDelete} aria-label="Delete comment">
              ✕
            </button>
          )}
        </div>
        <p className="eko-gist__comment-text">{comment.text}</p>
      </div>
    </div>
  );
}

function GistCard({
  gist,
  token,
  isAdmin,
  onLike,
  onDelete,
  onReport,
  onCommentAdded,
  liking,
  acting,
}: {
  gist: GistEntry;
  token: string;
  isAdmin: boolean;
  onLike: (id: number, liked: boolean) => void;
  onDelete: (id: number) => void;
  onReport: (id: number) => void;
  onCommentAdded: (id: number) => void;
  liking: boolean;
  acting: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<GistComment[]>([]);
  const [commentsCursor, setCommentsCursor] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const { toast } = useToast();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadComments = useCallback(
    async (cursor?: string | null) => {
      setCommentsLoading(true);
      try {
        const res = await gistsApi.comments(token, gist.id, cursor ?? undefined);
        if (!mounted.current) return;
        setComments((prev) => (cursor ? [...prev, ...res.comments] : res.comments));
        setCommentsCursor(res.next_cursor);
      } catch (err) {
        if (mounted.current) {
          toast(err instanceof ApiError ? err.message : "Couldn't load comments.", "error");
        }
      } finally {
        if (mounted.current) setCommentsLoading(false);
      }
    },
    [token, gist.id, toast]
  );

  const toggleComments = () => {
    if (!commentsOpen && comments.length === 0) void loadComments(null);
    setCommentsOpen((v) => !v);
  };

  const submitComment = async () => {
    const text = commentText.trim();
    if (!text || postingComment) return;
    setPostingComment(true);
    try {
      const res = await gistsApi.addComment(token, gist.id, text);
      if (mounted.current) {
        setComments((prev) => [...prev, res.comment]);
        setCommentText("");
        onCommentAdded(gist.id);
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't post your comment.", "error");
    } finally {
      if (mounted.current) setPostingComment(false);
    }
  };

  const over = commentText.length > GIST_MAX;

  return (
    <article className="eko-gist__card glass glass--tint-dark" aria-label={`Gist by @${gist.username}`}>
      <div className="eko-gist__card-head">
        <AvatarDot avatar={gist.avatar} color={gist.color} username={gist.username} />
        <div className="eko-gist__who">
          <div className="eko-gist__who-line">
            <strong>@{gist.username}</strong>
            <span className={`eko-gist__badge ${badgeClass(gist.badge)}`}>{gist.badge}</span>
          </div>
          <span className="eko-gist__time">{formatTimeAgo(gist.created_at)}</span>
        </div>
        <div className="eko-gist__menu-wrap">
          <button
            type="button"
            className="eko-gist__menu-btn"
            aria-label="More options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="eko-gist__menu glass glass--tint-dark" role="menu">
              {(gist.mine || isAdmin) && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={acting}
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(gist.id);
                  }}
                >
                  🗑 Delete
                </button>
              )}
              {!gist.mine && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onReport(gist.id);
                  }}
                >
                  🚩 Report
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="eko-gist__text">{gist.text}</p>

      <div className="eko-gist__actions">
        <button
          type="button"
          className={`eko-gist__action${gist.liked ? " eko-gist__action--liked" : ""}`}
          disabled={liking}
          onClick={() => onLike(gist.id, gist.liked)}
          aria-pressed={gist.liked}
          aria-label={gist.liked ? "Unlike this gist" : "Like this gist"}
        >
          <span aria-hidden="true">{gist.liked ? "❤️" : "🤍"}</span>
          <span>{gist.like_count}</span>
        </button>
        <button
          type="button"
          className="eko-gist__action"
          onClick={toggleComments}
          aria-expanded={commentsOpen}
          aria-label={commentsOpen ? "Hide comments" : "Show comments"}
        >
          <span aria-hidden="true">💬</span>
          <span>{gist.comment_count}</span>
        </button>
      </div>

      {commentsOpen && (
        <div className="eko-gist__comments">
          {comments.map((c) => (
            <CommentBlock key={c.id} comment={c} canDelete={false} onDelete={() => undefined} />
          ))}
          {commentsLoading && comments.length === 0 && <Loading message="Loading comments…" />}
          {commentsCursor && (
            <Button size="md" variant="ghost" loading={commentsLoading} onClick={() => loadComments(commentsCursor)}>
              Load more comments
            </Button>
          )}
          <form
            className="eko-gist__comment-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitComment();
            }}
          >
            <input
              className="eko-input"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Write a comment…"
              maxLength={GIST_MAX + 20}
              aria-label="Write a comment"
            />
            <Button type="submit" size="md" variant="accent" loading={postingComment} disabled={!commentText.trim() || over}>
              Reply
            </Button>
          </form>
          {over && <p className="eko-gist__over">Comments are {GIST_MAX} characters max.</p>}
        </div>
      )}
    </article>
  );
}

function NewsCard({ item }: { item: HeadlineItem }) {
  return (
    <article className="eko-gist__card eko-gist__card--news glass glass--tint-dark">
      <a
        className="eko-gist__news-btn"
        href={item.link}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Read: ${item.title} (opens ${item.source} in a new tab)`}
      >
        <span className="eko-gist__source">{item.source}</span>
        <h3 className="eko-gist__headline">{item.title}</h3>
        {item.snippet && <p className="eko-gist__snippet">{item.snippet}</p>}
        <span className="eko-gist__time">{formatTimeAgo(item.published_at ?? item.fetched_at)} · ↗ Read</span>
      </a>
    </article>
  );
}

export function GistApp({
  token,
  you,
  config,
}: {
  token: string;
  you: You;
  config: GistConfig | null;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<GistTab>("latest");

  // per-tab feed state
  const [gists, setGists] = useState<Record<string, GistEntry[]>>({});
  const [cursors, setCursors] = useState<Record<string, string | null>>({});
  const [loadedTabs, setLoadedTabs] = useState<Record<string, boolean>>({});
  const [feedLoading, setFeedLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // news state
  const [headlines, setHeadlines] = useState<HeadlineItem[]>([]);
  const [newsCursor, setNewsCursor] = useState<string | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsLoadingMore, setNewsLoadingMore] = useState(false);
  const [newsMeta, setNewsMeta] = useState<{ stale: boolean; updated: number | null }>({
    stale: false,
    updated: null,
  });
  const [newsError, setNewsError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // composer
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  // per-gist action guards
  const [liking, setLiking] = useState<number | null>(null);
  const [acting, setActing] = useState<number | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const errMsg = (err: unknown, fallback: string) =>
    err instanceof ApiError ? err.message : fallback;

  /* ---------------- feed loading ---------------- */

  const loadFeed = useCallback(
    async (t: GistTab, cursor?: string | null, append = false) => {
      if (t === "news") return;
      if (append) setLoadingMore(true);
      else setFeedLoading(true);
      try {
        const res = await gistsApi.list(token, t, cursor ?? undefined);
        if (!mounted.current) return;
        setGists((prev) => ({
          ...prev,
          [t]: append ? [...(prev[t] ?? []), ...res.gists] : res.gists,
        }));
        setCursors((prev) => ({ ...prev, [t]: res.next_cursor }));
        setLoadedTabs((prev) => ({ ...prev, [t]: true }));
      } catch (err) {
        if (mounted.current) toast(errMsg(err, "Couldn't load gists."), "error");
      } finally {
        if (mounted.current) {
          setFeedLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [token, toast]
  );

  const loadNews = useCallback(
    async (cursor?: string | null, append = false) => {
      if (append) setNewsLoadingMore(true);
      else {
        setNewsLoading(true);
        setNewsError(false);
      }
      try {
        const res = await headlinesApi.list(token, cursor ?? undefined);
        if (!mounted.current) return;
        setHeadlines((prev) => (append ? [...prev, ...res.items] : res.items));
        setNewsCursor(res.next_cursor);
        setNewsMeta({ stale: res.stale, updated: res.updated_minutes_ago });
      } catch (err) {
        if (mounted.current) {
          if (!append) setNewsError(true);
          else toast(errMsg(err, "Couldn't load more headlines."), "error");
        }
      } finally {
        if (mounted.current) {
          setNewsLoading(false);
          setNewsLoadingMore(false);
        }
      }
    },
    [token, toast]
  );

  useEffect(() => {
    if (tab === "news") {
      if (headlines.length === 0 && !newsLoading) void loadNews(null);
    } else if (!loadedTabs[tab]) {
      void loadFeed(tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const switchTab = (t: GistTab) => setTab(t);

  const refreshNews = async () => {
    setRefreshing(true);
    try {
      const res = await headlinesApi.refresh(token);
      if (!mounted.current) return;
      if (res.refreshed) {
        toast("Fetching fresh headlines — they'll appear in a moment.", "info");
        window.setTimeout(() => mounted.current && loadNews(null), 8000);
      } else {
        toast("Headlines are already fresh.", "info");
        await loadNews(null);
      }
    } catch (err) {
      if (mounted.current) toast(errMsg(err, "Couldn't refresh headlines."), "error");
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  };

  /* ---------------- composer ---------------- */

  const submitGist = async () => {
    const text = draft.trim();
    if (!text || text.length > GIST_MAX || posting) return;
    setPosting(true);
    try {
      const res = await gistsApi.create(token, text);
      if (!mounted.current) return;
      const g = res.gist;
      setGists((prev) => ({
        ...prev,
        latest: [g, ...(prev.latest ?? [])],
        me: [g, ...(prev.me ?? [])],
      }));
      setDraft("");
      setTab("latest");
      toast("Gist posted! 📣", "success");
    } catch (err) {
      toast(errMsg(err, "Couldn't post your gist."), "error");
    } finally {
      if (mounted.current) setPosting(false);
    }
  };

  /* ---------------- gist actions ---------------- */

  const toggleLike = async (id: number, liked: boolean) => {
    setLiking(id);
    try {
      const res = liked ? await gistsApi.unlike(token, id) : await gistsApi.like(token, id);
      if (!mounted.current) return;
      setGists((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          next[k] = next[k].map((g) =>
            g.id === id ? { ...g, liked: res.liked, like_count: res.like_count } : g
          );
        }
        return next;
      });
    } catch (err) {
      toast(errMsg(err, "Couldn't update the like."), "error");
    } finally {
      if (mounted.current) setLiking(null);
    }
  };

  const deleteGist = async (id: number) => {
    if (!window.confirm("Delete this gist? This can't be undone.")) return;
    setActing(id);
    try {
      await gistsApi.remove(token, id);
      if (!mounted.current) return;
      setGists((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) next[k] = next[k].filter((g) => g.id !== id);
        return next;
      });
      toast("Gist deleted.", "info");
    } catch (err) {
      toast(errMsg(err, "Couldn't delete this gist."), "error");
    } finally {
      if (mounted.current) setActing(null);
    }
  };

  const bumpCommentCount = useCallback((id: number) => {
    setGists((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        next[k] = next[k].map((g) =>
          g.id === id ? { ...g, comment_count: g.comment_count + 1 } : g
        );
      }
      return next;
    });
  }, []);

  const reportGist = async (id: number) => {
    const reason = window.prompt("Why are you reporting this gist?");
    if (reason == null) return;
    const clean = reason.trim();
    if (!clean) {
      toast("Tell us why you're reporting this.", "error");
      return;
    }
    try {
      await gistsApi.report(token, id, clean);
      toast("Thanks — our team will take a look.", "success");
    } catch (err) {
      toast(errMsg(err, "Couldn't record your report."), "error");
    }
  };

  /* ---------------- context chips ---------------- */

  const shiftJobId =
    (you as unknown as { shift_job?: string | null }).shift_job ?? you.shift?.job ?? null;
  const locationName = findName(config?.locations, you.locationId) ?? "Lagos";
  const housingName = housingNameOf(config?.housing, you.housing) ?? prettifyId(you.housing);
  const jobName =
    you.shift?.name ?? findName(config?.jobs, shiftJobId ?? undefined) ?? "Between hustles";

  const draftLen = draft.length;
  const draftOver = draftLen > GIST_MAX;
  const canPost = draft.trim().length > 0 && !draftOver && !posting;

  const isNews = tab === "news";
  const feed = gists[tab] ?? [];
  const cursor = cursors[tab] ?? null;

  return (
    <div className="eko-gist">
      <header className="eko-gist__head">
        <h2 className="eko-gist__title">📣 Gist</h2>
        <p className="eko-gist__sub">What's happening in the city</p>
      </header>

      {/* ---- composer ---- */}
      <section className="eko-gist__composer glass glass--tint-dark" aria-label="Post a gist">
        <div className="eko-gist__chips" aria-label="Your current status">
          <span className="eko-gist__chip" title="Current location">
            📍 {locationName}
          </span>
          <span className="eko-gist__chip" title="Housing">
            🏠 {housingName}
          </span>
          <span className="eko-gist__chip" title="Work">
            💼 {jobName}
          </span>
        </div>
        <textarea
          className="eko-gist__draft eko-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What's the gist? (280 chars)"
          rows={3}
          maxLength={GIST_MAX + 40}
          aria-label="Write a gist"
        />
        <div className="eko-gist__composer-foot">
          <span
            className={`eko-gist__counter${draftOver ? " eko-gist__counter--over" : ""}`}
            aria-live="polite"
          >
            {draftLen}/{GIST_MAX}
          </span>
          <Button type="button" size="md" variant="accent" loading={posting} disabled={!canPost} onClick={submitGist}>
            Post
          </Button>
        </div>
        {draftOver && (
          <p className="eko-gist__over">Too long — keep it to {GIST_MAX} characters.</p>
        )}
      </section>

      {/* ---- tabs ---- */}
      <nav className="eko-gist__tabs" aria-label="Gist feed tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`eko-gist__tab${tab === t.id ? " eko-gist__tab--active" : ""}`}
            onClick={() => switchTab(t.id)}
            aria-pressed={tab === t.id}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </nav>

      {/* ---- news tab ---- */}
      {isNews ? (
        <section aria-label="Nigerian headlines">
          <div className="eko-gist__news-bar">
            <span className="eko-gist__news-meta">
              {newsMeta.updated == null
                ? "Fresh headlines"
                : newsMeta.updated < 1
                  ? "Updated just now"
                  : `Updated ${newsMeta.updated} min ago`}
              {newsMeta.stale ? " · refreshing…" : ""}
            </span>
            <Button size="md" variant="ghost" loading={refreshing} onClick={refreshNews}>
              ↻ Refresh
            </Button>
          </div>
          {newsLoading && headlines.length === 0 ? (
            <Loading message="Fetching headlines…" />
          ) : newsError && headlines.length === 0 ? (
            <EmptyState
              emoji="📰"
              title={EMPTY_COPY.news.title}
              body={EMPTY_COPY.news.body}
            />
          ) : headlines.length === 0 ? (
            <EmptyState emoji="📰" title={EMPTY_COPY.news.title} body={EMPTY_COPY.news.body} />
          ) : (
            <>
              {headlines.map((h) => (
                <NewsCard key={h.id} item={h} />
              ))}
              {newsCursor && (
                <div className="eko-gist__more">
                  <Button size="md" variant="ghost" loading={newsLoadingMore} onClick={() => loadNews(newsCursor, true)}>
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
          {newsError && headlines.length === 0 && (
            <div className="eko-gist__more">
              <Button size="md" variant="accent" onClick={() => loadNews(null)}>
                Retry
              </Button>
            </div>
          )}
        </section>
      ) : (
        /* ---- gist feed tabs ---- */
        <section aria-label={`${tab} gists`}>
          {feedLoading && feed.length === 0 ? (
            <Loading message="Loading gists…" />
          ) : feed.length === 0 ? (
            <EmptyState
              emoji="📣"
              title={EMPTY_COPY[tab as Exclude<GistTab, "news">].title}
              body={EMPTY_COPY[tab as Exclude<GistTab, "news">].body}
            />
          ) : (
            <>
              {feed.map((g) => (
                <GistCard
                  key={g.id}
                  gist={g}
                  token={token}
                  isAdmin={you.is_admin}
                  onLike={toggleLike}
                  onDelete={deleteGist}
                  onReport={reportGist}
                  onCommentAdded={bumpCommentCount}
                  liking={liking === g.id}
                  acting={acting === g.id}
                />
              ))}
              {cursor && (
                <div className="eko-gist__more">
                  <Button size="md" variant="ghost" loading={loadingMore} onClick={() => loadFeed(tab, cursor, true)}>
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
