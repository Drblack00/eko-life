import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  contestsApi,
  type ContestDesign,
  type ContestDetail,
  type ContestEntry,
  type ContestSummary,
  type DuelPair,
} from "../../lib/api";
import "./ContestsApp.css";

/**
 * UGC Design Contests — the Contests phone app (Duel style, per the
 * contests-option-b mockup: no deviations).
 *
 * Three views: a live ranked leaderboard with vote bars, head-to-head
 * duel voting (tap the winner, streaks), and a snap-first 2-tap entry
 * submit. Entry "designs" are emoji + color-pair + blurb cards, with an
 * optional player-snapped photo (camera/gallery, downscaled client-side).
 * All state comes from /api/contests.
 */

type View = "board" | "duel" | "submit";

/** Emoji choices for the 2-tap submit, per contest category. */
const EMOJI_SETS: Record<string, string[]> = {
  outfit: ["👗", "🤴", "👔", "💃", "🧥", "👠", "🕶️", "👒", "🧣", "👞", "👜", "💍"],
  apartment: ["🛋️", "🛏️", "🪴", "🖼️", "💡", "🧸", "🪞", "🕯️", "🧺", "🪑", "📺", "🚪"],
};

/**
 * Gradient color pairs players can dress their design in. These are
 * design content (stored in the entry's design_json, like avatar colors),
 * not theme styling — the CSS below uses only theme tokens.
 */
const COLOR_PAIRS: [string, string][] = [
  ["#3b0764", "#a855f7"],
  ["#7c2d12", "#c96a1e"],
  ["#0e3a5c", "#0ea5e9"],
  ["#123a2e", "#35d49a"],
  ["#3a2404", "#f5a623"],
  ["#4a0e2e", "#ff8fb3"],
];

function fmt(n: number): string {
  return Math.floor(Number(n) || 0).toLocaleString("en-NG");
}

function weekdayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-NG", { weekday: "long" });
}

/** Entry art: the player's photo when present, else the emoji swatch. */
function Swatch({ entry, big }: { entry: ContestEntry; big?: boolean }) {
  if (entry.photo) {
    return (
      <img
        src={entry.photo}
        alt=""
        aria-hidden
        className={big ? "eko-ct__art eko-ct__art--img" : "eko-ct__sw eko-ct__sw--img"}
      />
    );
  }
  const [c1, c2] = entry.design.colors;
  return (
    <span
      className={big ? "eko-ct__art" : "eko-ct__sw"}
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
      aria-hidden
    >
      {entry.design.emoji}
    </span>
  );
}

/** Longest edge (px) for client-side photo downscale. */
const PHOTO_MAX_EDGE = 1024;
/** JPEG quality for the downscaled entry photo. */
const PHOTO_QUALITY = 0.75;

/**
 * Downscale an image file client-side via canvas: max 1024px on the
 * longest edge, JPEG 0.75. Returns a data URL, typically well under the
 * server's 512KB cap.
 */
function downscalePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const longest = Math.max(width, height);
      if (longest > PHOTO_MAX_EDGE) {
        const s = PHOTO_MAX_EDGE / longest;
        width = Math.round(width * s);
        height = Math.round(height * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("This device can't process photos."));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", PHOTO_QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image — try another."));
    };
    img.src = url;
  });
}

export function ContestsApp({ token }: { token: string }) {
  const [contests, setContests] = useState<ContestSummary[]>([]);
  const [contestId, setContestId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ContestDetail | null>(null);
  const [view, setView] = useState<View>("board");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // duel state
  const [duel, setDuel] = useState<DuelPair | null>(null);
  const [duelLoading, setDuelLoading] = useState(false);
  const [votedFor, setVotedFor] = useState<ContestEntry | null>(null);
  const [voting, setVoting] = useState<number | null>(null);

  // submit state (2 taps: 1 = snap your design, 2 = confirm)
  const [step, setStep] = useState<1 | 2>(1);
  const [emoji, setEmoji] = useState(EMOJI_SETS.outfit[0]);
  const [colors, setColors] = useState<[string, string]>(COLOR_PAIRS[0]);
  const [title, setTitle] = useState("");
  const [blurb, setBlurb] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // optional player-snapped photo (downscaled data URL, null = emoji design)
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const onPhotoFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow picking the same file again
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setNotice("That file isn't an image — try another.");
        return;
      }
      setPhotoBusy(true);
      setNotice(null);
      try {
        setPhoto(await downscalePhoto(file));
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Couldn't read that image.");
      } finally {
        setPhotoBusy(false);
      }
    },
    []
  );

  const resetSubmit = useCallback(() => {
    setStep(1);
    setTitle("");
    setBlurb("");
    setPhoto(null);
  }, []);

  const loadDetail = useCallback(
    async (id: number) => {
      setLoading(true);
      setError(null);
      try {
        setDetail(await contestsApi.detail(token, id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load the contest.");
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    (async () => {
      try {
        const list = await contestsApi.list(token);
        setContests(list);
        const active = list.find((c) => c.status === "active") ?? list[0] ?? null;
        if (active) {
          setContestId(active.id);
          setEmoji((EMOJI_SETS[active.category] ?? EMOJI_SETS.outfit)[0]);
          await loadDetail(active.id);
        } else {
          setLoading(false);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load contests.");
        setLoading(false);
      }
    })();
  }, [token, loadDetail]);

  const pickContest = useCallback(
    (id: number) => {
      setContestId(id);
      setView("board");
      setVotedFor(null);
      const c = contests.find((x) => x.id === id);
      if (c) setEmoji((EMOJI_SETS[c.category] ?? EMOJI_SETS.outfit)[0]);
      void loadDetail(id);
    },
    [contests, loadDetail]
  );

  const loadDuel = useCallback(async () => {
    if (contestId == null) return;
    setDuelLoading(true);
    setVotedFor(null);
    try {
      setDuel(await contestsApi.duel(token, contestId));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't deal a duel.");
    } finally {
      setDuelLoading(false);
    }
  }, [token, contestId]);

  const startDuels = useCallback(() => {
    setView("duel");
    setNotice(null);
    void loadDuel();
  }, [loadDuel]);

  const castVote = useCallback(
    async (entry: ContestEntry) => {
      if (contestId == null || voting != null) return;
      setVoting(entry.id);
      setNotice(null);
      try {
        const r = await contestsApi.vote(token, contestId, entry.id);
        setVotedFor(entry);
        setDuel((d) =>
          d ? { ...d, votesLeft: r.votesLeft, streak: r.streak } : d
        );
        // refresh the board numbers quietly for when they go back
        contestsApi
          .detail(token, contestId)
          .then(setDetail)
          .catch(() => {});
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Vote didn't land.");
      } finally {
        setVoting(null);
      }
    },
    [token, contestId, voting]
  );

  const submitEntry = useCallback(async () => {
    if (contestId == null || submitting) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setNotice("Give your design a title first.");
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const design: ContestDesign = {
        emoji,
        colors,
        blurb: blurb.trim(),
      };
      await contestsApi.enter(token, contestId, cleanTitle, design, photo);
      setNotice("🚀 You're in! Your design is live on the leaderboard.");
      resetSubmit();
      setView("board");
      await loadDetail(contestId);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Entry didn't go through.");
    } finally {
      setSubmitting(false);
    }
  }, [token, contestId, submitting, title, emoji, colors, blurb, photo, resetSubmit, loadDetail]);

  if (loading && !detail) {
    return <div className="eko-ct"><p className="eko-ct__muted">Loading contests…</p></div>;
  }
  if (error && !detail) {
    return (
      <div className="eko-ct">
        <p className="eko-ct__muted">{error}</p>
        <button className="eko-ct__btn" onClick={() => contestId != null && loadDetail(contestId)}>
          Try again
        </button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="eko-ct">
        <p className="eko-ct__muted">No contests running right now — check back soon! 🎨</p>
      </div>
    );
  }

  const c = detail.contest;
  const live = c.status === "active";
  const endsLabel = weekdayOf(c.endsAt);

  return (
    <div className="eko-ct">
      {contests.length > 1 && (
        <div className="eko-ct__chips" role="tablist" aria-label="Contests">
          {contests.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={x.id === contestId}
              className={"eko-ct__chip" + (x.id === contestId ? " eko-ct__chip--on" : "")}
              onClick={() => pickContest(x.id)}
            >
              {x.title}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <p className="eko-ct__notice" role="status">
          {notice}
        </p>
      )}

      {view === "board" && (
        <section aria-label="Leaderboard">
          <div className="eko-ct__head">
            <b>
              {c.title} · {live ? "Live 🏆" : "Ended"}
            </b>
            <div className="eko-ct__sub">
              Ends {endsLabel} · {fmt(c.totalVotes)} votes cast
            </div>
          </div>
          <div className="eko-ct__pills">
            <span className="eko-ct__pill">🔥 streak x{detail.streak}</span>
            <span className="eko-ct__pill">{detail.votesLeft} votes left today</span>
          </div>

          {detail.entries.length === 0 ? (
            <div className="eko-ct__empty">
              <div className="eko-ct__empty-emoji">🎨</div>
              <p>No entries yet — be the first!</p>
            </div>
          ) : (
            <ol className="eko-ct__ranks">
              {detail.entries.map((e, i) => (
                <li key={e.id} className="eko-ct__card eko-ct__rk">
                  <span
                    className={
                      "eko-ct__pos" + (i === 0 ? " eko-ct__pos--top" : "")
                    }
                  >
                    {i + 1}
                  </span>
                  <Swatch entry={e} />
                  <span className="eko-ct__inf">
                    <b>
                      {e.title}
                      {e.isMine && <span className="eko-ct__mine"> · you</span>}
                    </b>
                    <span className="eko-ct__vbar" aria-hidden>
                      <i style={{ width: `${Math.round(e.share * 100)}%` }} />
                    </span>
                    <span className="eko-ct__lbl">{fmt(e.votes)} votes</span>
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="eko-ct__cta">
            {live && (
              <button className="eko-ct__btn" onClick={startDuels}>
                ⚔️ Start voting duels
              </button>
            )}
            {live && (
              <button
                className="eko-ct__btn eko-ct__btn--ghost"
                onClick={() => {
                  setStep(1);
                  setNotice(null);
                  setView("submit");
                }}
              >
                ＋ Enter your design
              </button>
            )}
          </div>
        </section>
      )}

      {view === "duel" && (
        <section aria-label="Duel voting">
          <div className="eko-ct__duel-hd">
            <b>⚔️ Duel #{duel?.duelNo ?? "…"}</b>
            <div className="eko-ct__sub">
              Tap the fit that wins · streak x{duel?.streak ?? detail.streak} 🔥
            </div>
          </div>

          {duelLoading && <p className="eko-ct__muted">Dealing a duel…</p>}

          {!duelLoading && duel?.pair && (
            <>
              <div className="eko-ct__vs">
                {[duel.pair[0], duel.pair[1]].map((e, i) => (
                  <Fragment key={e.id}>
                    {i === 1 && <span className="eko-ct__vsbadge">VS</span>}
                    <button
                      className={
                        "eko-ct__fighter" +
                        (votedFor?.id === e.id ? " eko-ct__fighter--win" : "")
                      }
                      onClick={() => castVote(e)}
                      disabled={voting != null || votedFor != null || duel.votesLeft <= 0}
                      aria-label={`Vote for ${e.title}`}
                    >
                      <Swatch entry={e} big />
                      <span className="eko-ct__finf">
                        <b>{e.title}</b>
                        <span className="eko-ct__lbl">by {e.username}</span>
                      </span>
                    </button>
                  </Fragment>
                ))}
              </div>
              {votedFor && (
                <p className="eko-ct__ok">✓ Vote counted for {votedFor.title}</p>
              )}
              {voting != null && <p className="eko-ct__muted">Counting your vote…</p>}
              <div className="eko-ct__duel-cta">
                <button
                  className="eko-ct__btn"
                  onClick={loadDuel}
                  disabled={duelLoading}
                >
                  Next duel →
                </button>
                <button className="eko-ct__skip" onClick={loadDuel}>
                  Skip this pair
                </button>
              </div>
              <p className="eko-ct__lbl eko-ct__center">
                {duel.votesLeft} votes left today
              </p>
            </>
          )}

          {!duelLoading && !duel?.pair && (
            <div className="eko-ct__empty">
              <div className="eko-ct__empty-emoji">⚔️</div>
              <p>{duel?.reason ?? "No duel available right now."}</p>
              {live && (
                <button
                  className="eko-ct__btn eko-ct__btn--ghost"
                  onClick={() => {
                    setStep(1);
                    setView("submit");
                  }}
                >
                  ＋ Enter your design
                </button>
              )}
            </div>
          )}

          <div className="eko-ct__cta">
            <button
              className="eko-ct__btn eko-ct__btn--ghost"
              onClick={() => {
                setView("board");
                if (contestId != null) void loadDetail(contestId);
              }}
            >
              ← Leaderboard
            </button>
          </div>
        </section>
      )}

      {view === "submit" && (
        <section aria-label="Enter the contest">
          <div className="eko-ct__head">
            <b>Enter in 2 taps ⚡</b>
            <div className="eko-ct__sub">{c.title}</div>
          </div>

          {step === 1 && (
            <>
              <p className="eko-ct__lbl">Tap 1 · snap your design</p>
              <div
                className="eko-ct__egrid"
                role="radiogroup"
                aria-label="Design emoji"
              >
                {(EMOJI_SETS[c.category] ?? EMOJI_SETS.outfit).map((em) => (
                  <button
                    key={em}
                    role="radio"
                    aria-checked={emoji === em}
                    className={
                      "eko-ct__emoji" + (emoji === em ? " eko-ct__emoji--on" : "")
                    }
                    onClick={() => setEmoji(em)}
                  >
                    {em}
                  </button>
                ))}
              </div>
              <p className="eko-ct__lbl">Colors</p>
              <div className="eko-ct__cgrid" role="radiogroup" aria-label="Colors">
                {COLOR_PAIRS.map((pair, i) => (
                  <button
                    key={i}
                    role="radio"
                    aria-checked={colors[0] === pair[0] && colors[1] === pair[1]}
                    className={
                      "eko-ct__swbtn" + (colors[0] === pair[0] && colors[1] === pair[1] ? " eko-ct__swbtn--on" : "")
                    }
                    style={{
                      background: `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`,
                    }}
                    onClick={() => setColors(pair)}
                    aria-label={`Color pair ${i + 1}`}
                  />
                ))}
              </div>
              <input
                className="eko-ct__input"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 60))}
                placeholder="Title your design…"
                maxLength={60}
                aria-label="Design title"
              />
              <input
                className="eko-ct__input"
                value={blurb}
                onChange={(e) => setBlurb(e.target.value.slice(0, 140))}
                placeholder="Caption it ✏️ (optional)"
                maxLength={140}
                aria-label="Design caption"
              />
              <p className="eko-ct__lbl">Real photo 📷 (optional — shows instead of the emoji art)</p>
              <div className="eko-ct__photobtns">
                <button
                  type="button"
                  className="eko-ct__btn eko-ct__btn--ghost"
                  onClick={() => cameraRef.current?.click()}
                  disabled={photoBusy}
                >
                  {photoBusy ? "Processing…" : "📷 Take photo"}
                </button>
                <button
                  type="button"
                  className="eko-ct__btn eko-ct__btn--ghost"
                  onClick={() => galleryRef.current?.click()}
                  disabled={photoBusy}
                >
                  🖼️ Gallery
                </button>
              </div>
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={onPhotoFile}
                aria-label="Take a photo with the camera"
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onPhotoFile}
                aria-label="Choose a photo from the gallery"
              />
              {photo && (
                <div className="eko-ct__photoprev">
                  <img src={photo} alt="Your entry photo" />
                  <button
                    type="button"
                    className="eko-ct__photorm"
                    onClick={() => setPhoto(null)}
                  >
                    ✕ Remove
                  </button>
                </div>
              )}
              <div className="eko-ct__cta">
                <button
                  className="eko-ct__btn"
                  onClick={() => {
                    if (!title.trim()) {
                      setNotice("Give your design a title first.");
                      return;
                    }
                    setNotice(null);
                    setStep(2);
                  }}
                >
                  📸 Snap it
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="eko-ct__lbl">Tap 2 · confirm your entry</p>
              <div className="eko-ct__snap">
                {photo ? (
                  <img src={photo} className="eko-ct__bigphoto" alt="Your entry photo" />
                ) : (
                  <span
                    className="eko-ct__big"
                    style={{
                      background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`,
                    }}
                    aria-hidden
                  >
                    {emoji}
                  </span>
                )}
                <div className="eko-ct__cap">
                  ✏️ “{title.trim()}
                  {blurb.trim() ? ` — ${blurb.trim()}` : ""}”
                </div>
              </div>
              <div className="eko-ct__snapbtns">
                <button
                  className="eko-ct__btn eko-ct__btn--ghost"
                  onClick={() => setStep(1)}
                >
                  📸 Retake
                </button>
                <button
                  className="eko-ct__btn"
                  onClick={submitEntry}
                  disabled={submitting}
                >
                  {submitting ? "Entering…" : "🚀 Enter"}
                </button>
              </div>
            </>
          )}

          <p className="eko-ct__lbl eko-ct__center eko-ct__foot">
            Entries close {endsLabel} · winner gets {c.prizeText}
          </p>
          <div className="eko-ct__cta">
            <button
              className="eko-ct__btn eko-ct__btn--ghost"
              onClick={() => setView("board")}
            >
              ← Leaderboard
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
