import { useCallback, useEffect, useMemo, useState } from "react";
import {
  crewsApi,
  type CrewBoardEntry,
  type CrewDetail,
  type CrewSort,
  type CrewSummary,
} from "../../lib/api";
import "./CrewsApp.css";

/** Compact XP/coin count: 86000 -> "86K", 3400000 -> "3.4M". Exported for tests. */
export function formatCrewXp(n: number): string {
  const v = Math.floor(Number(n) || 0);
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return (m >= 100 ? Math.round(m).toString() : m.toFixed(1).replace(/\.0$/, "")) + "M";
  }
  if (v >= 1000) {
    const k = v / 1000;
    return (k >= 100 ? Math.round(k).toString() : k.toFixed(1).replace(/\.0$/, "")) + "K";
  }
  return String(v);
}

/** Compact naira: 3400000 -> "₦3.4M". Exported for tests. */
export function formatNairaCompact(n: number): string {
  return "₦" + formatCrewXp(n);
}

/** Goal progress line: "₦3.4M / ₦5M · 68% · ends in 4 days". Exported for tests. */
export function formatGoalLine(
  raised: number,
  target: number,
  pct: number,
  endsAt: number,
  now: number = Date.now()
): string {
  const money = `${formatNairaCompact(raised)} / ${formatNairaCompact(target)} · ${pct}%`;
  if (!endsAt) return money;
  const days = Math.ceil((endsAt - now) / 86400000);
  if (days <= 0) return `${money} · ended`;
  if (days === 1) return `${money} · ends today`;
  return `${money} · ends in ${days} days`;
}

/** "founded Oct 2026" line for a founded-at timestamp. Exported for tests. */
export function formatFounded(ts: number): string {
  const d = new Date(Number(ts) || 0);
  const month = d.toLocaleString("en-US", { month: "short" });
  return `founded ${month} ${d.getFullYear()}`;
}

/** Discover row meta: "248 members · #3 ranked". Exported for tests. */
export function formatCrewMeta(memberCount: number, rank: number): string {
  return `${memberCount} member${memberCount === 1 ? "" : "s"} · #${rank} ranked`;
}

/** Crest circle colors — theme tokens only, cycled by crew id. */
const CREST_COLORS = [
  "var(--lagoon-600)",
  "var(--palm-600)",
  "var(--danfo-600)",
  "var(--danger)",
  "var(--primary)",
  "var(--lagoon-500)",
];

export function crestColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CREST_COLORS[h % CREST_COLORS.length];
}

const SORT_LABELS: Record<CrewSort, string> = {
  active: "Most active",
  members: "Most members",
  xp: "Most XP",
};
const SORT_ORDER: CrewSort[] = ["active", "members", "xp"];

const ICON_PRESETS = ["🛡️", "💼", "🎭", "🌊", "🚌", "🌴", "⚽", "🎤", "🛵", "🏆"];

type Tab = "overview" | "members" | "goals" | "board";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "goals", label: "Goals" },
  { id: "board", label: "Board" },
];

const DEFAULT_CONTRIBUTE = 10000;

/**
 * Crews — player clans phone app.
 *
 * Discover: dense rows with a sort control. Detail: tabbed (Overview /
 * Members / Goals / Board) with the league leaderboard and the active
 * shared goal on the Board tab. All writes go through /api/crews
 * (server-validated, gameplay coins only).
 */
export function CrewsApp({ token }: { token: string }) {
  const [view, setView] = useState<{ kind: "discover" } | { kind: "detail"; id: string }>({
    kind: "discover",
  });
  const [tab, setTab] = useState<Tab>("board");
  const [sort, setSort] = useState<CrewSort>("active");
  const [crews, setCrews] = useState<CrewSummary[]>([]);
  const [detail, setDetail] = useState<CrewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showContribute, setShowContribute] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTagline, setNewTagline] = useState("");
  const [newIcon, setNewIcon] = useState("🛡️");
  const [contributeAmt, setContributeAmt] = useState(String(DEFAULT_CONTRIBUTE));

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await crewsApi.list(token, sort);
      setCrews(r.crews);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load crews.");
    } finally {
      setLoading(false);
    }
  }, [token, sort]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        setDetail(await crewsApi.detail(token, id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't open the crew.");
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  const openCrew = useCallback(
    (id: string) => {
      setView({ kind: "detail", id });
      setTab("board");
      setDetail(null);
      setNotice(null);
      void loadDetail(id);
    },
    [loadDetail]
  );

  const goDiscover = useCallback(() => {
    setView({ kind: "discover" });
    setDetail(null);
    setNotice(null);
    void loadList();
  }, [loadList]);

  const refreshDetail = useCallback(async () => {
    if (view.kind === "detail") await loadDetail(view.id);
  }, [view, loadDetail]);

  const act = useCallback(
    async (key: string, fn: () => Promise<void>, doneMsg: string | null) => {
      setBusy(key);
      setNotice(null);
      try {
        await fn();
        if (doneMsg) setNotice(doneMsg);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const cycleSort = useCallback(() => {
    setSort((s) => SORT_ORDER[(SORT_ORDER.indexOf(s) + 1) % SORT_ORDER.length]);
  }, []);

  const suggested = useMemo(() => crews.slice(0, 3), [crews]);
  const nearby = useMemo(() => crews.slice(3), [crews]);

  const detailId = view.kind === "detail" ? view.id : null;

  return (
    <div className="eko-crews">
      {view.kind === "discover" ? (
        <>
          <header className="eko-crews__hd">
            <b>Crews</b>
            <button
              type="button"
              className="eko-crews__sort"
              onClick={cycleSort}
              aria-label="Change crew sort order"
            >
              Sort: {SORT_LABELS[sort]} ▾
            </button>
            <button
              type="button"
              className="eko-crews__new"
              onClick={() => setShowCreate(true)}
              aria-label="Start a new crew"
            >
              + New
            </button>
          </header>

          {notice && (
            <p className="eko-crews__notice" role="status">
              {notice}
            </p>
          )}

          {loading && crews.length === 0 ? (
            <p className="eko-crews__loading">Finding crews…</p>
          ) : error && crews.length === 0 ? (
            <div className="eko-crews__error">
              <p>{error}</p>
              <button type="button" onClick={() => void loadList()}>
                Retry
              </button>
            </div>
          ) : crews.length === 0 ? (
            <div className="eko-crews__empty">
              <p>No crews yet — start the first one and run this city. 🛡️</p>
              <button type="button" onClick={() => setShowCreate(true)}>
                Start a crew
              </button>
            </div>
          ) : (
            <>
              <div className="eko-crews__sec">SUGGESTED FOR YOU</div>
              <ul className="eko-crews__rows">
                {suggested.map((c) => (
                  <CrewRow
                    key={c.id}
                    crew={c}
                    busy={busy != null}
                    onOpen={() => openCrew(c.id)}
                    onJoin={() =>
                      void act(`join:${c.id}`, async () => {
                        const r = await crewsApi.join(token, c.id);
                        if (r.notice) setNotice(r.notice);
                        await loadList();
                      }, null)
                    }
                  />
                ))}
              </ul>
              {nearby.length > 0 && (
                <>
                  <div className="eko-crews__sec">NEAR YOU · YABA</div>
                  <ul className="eko-crews__rows">
                    {nearby.map((c) => (
                      <CrewRow
                        key={c.id}
                        crew={c}
                        busy={busy != null}
                        onOpen={() => openCrew(c.id)}
                        onJoin={() =>
                          void act(`join:${c.id}`, async () => {
                            const r = await crewsApi.join(token, c.id);
                            if (r.notice) setNotice(r.notice);
                            await loadList();
                          }, null)
                        }
                      />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <header className="eko-crews__hd">
            <button
              type="button"
              className="eko-crews__back"
              onClick={goDiscover}
              aria-label="Back to crews"
            >
              ‹
            </button>
            <b>Crews</b>
          </header>

          {notice && (
            <p className="eko-crews__notice" role="status">
              {notice}
            </p>
          )}

          {loading && !detail ? (
            <p className="eko-crews__loading">Opening the crew…</p>
          ) : error && !detail ? (
            <div className="eko-crews__error">
              <p>{error}</p>
              <button type="button" onClick={() => detailId && void loadDetail(detailId)}>
                Retry
              </button>
            </div>
          ) : detail ? (
            <>
              <div className="eko-crews__dhead">
                <span
                  className="eko-crews__crest"
                  style={{ background: crestColor(detail.crew.id) }}
                  aria-hidden="true"
                >
                  {detail.crew.icon}
                </span>
                <div>
                  <h3>{detail.crew.name}</h3>
                  <p className="eko-crews__meta">
                    {formatCrewMeta(detail.crew.memberCount, detail.crew.rank)}
                    {detail.my.role ? ` · ${detail.my.role}` : ""}
                    {" · "}
                    {formatFounded(detail.crew.foundedAt)}
                  </p>
                </div>
              </div>

              <nav className="eko-crews__tabs" aria-label="Crew sections">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={tab === t.id ? "on" : ""}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>

              {tab === "board" && (
                <BoardTab
                  detail={detail}
                  onContribute={
                    detail.my.role
                      ? () => {
                          setContributeAmt(String(DEFAULT_CONTRIBUTE));
                          setShowContribute(true);
                        }
                      : null
                  }
                />
              )}

              {tab === "members" && (
                <>
                  <div className="eko-crews__sec">
                    MEMBERS · {detail.members.length}
                  </div>
                  <ul className="eko-crews__rows">
                    {detail.members.map((m) => (
                      <li key={m.userId} className="eko-crews__row">
                        <span className="eko-crews__main">
                          <span className="eko-crews__name">@{m.username}</span>
                          <span className="eko-crews__meta">{m.role}</span>
                        </span>
                        <span className="eko-crews__xp">
                          {formatCrewXp(m.xp)} xp
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {tab === "overview" && (
                <div className="eko-crews__overview">
                  {detail.crew.tagline && (
                    <p className="eko-crews__tagline">“{detail.crew.tagline}”</p>
                  )}
                  <dl className="eko-crews__stats">
                    <div>
                      <dt>Members</dt>
                      <dd>{detail.crew.memberCount}</dd>
                    </div>
                    <div>
                      <dt>League rank</dt>
                      <dd>#{detail.crew.rank}</dd>
                    </div>
                    <div>
                      <dt>Total XP</dt>
                      <dd>{formatCrewXp(detail.crew.totalXp)}</dd>
                    </div>
                    <div>
                      <dt>XP this week</dt>
                      <dd>{formatCrewXp(detail.crew.weeklyXp)}</dd>
                    </div>
                  </dl>
                  {detail.my.role && (
                    <button
                      type="button"
                      className="eko-crews__leave"
                      disabled={busy != null}
                      onClick={() => setConfirmLeave(true)}
                    >
                      Leave crew
                    </button>
                  )}
                </div>
              )}

              {tab === "goals" && (
                <>
                  <div className="eko-crews__sec">SHARED GOAL</div>
                  {detail.goal ? (
                    <>
                      <GoalCard goal={detail.goal} />
                      {detail.my.role && (
                        <div className="eko-crews__cta">
                          <button
                            type="button"
                            className="eko-crews__contribute"
                            disabled={busy != null}
                            onClick={() => {
                              setContributeAmt(String(DEFAULT_CONTRIBUTE));
                              setShowContribute(true);
                            }}
                          >
                            Contribute {formatNairaCompact(DEFAULT_CONTRIBUTE)}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="eko-crews__empty">No active goal right now.</p>
                  )}
                </>
              )}

              {/* ---- contribute dialog ---- */}
              {showContribute && detail.goal && detailId && (
                <div
                  className="eko-crews__dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Contribute to the crew goal"
                >
                  <div className="eko-crews__dialog-box">
                    <h3>Chip in for the goal</h3>
                    <p>
                      <strong>{detail.goal.title}</strong> — gameplay coins
                      only, straight from your wallet.
                    </p>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={100}
                      value={contributeAmt}
                      onChange={(e) => setContributeAmt(e.target.value)}
                      aria-label="Contribution amount"
                    />
                    <div className="eko-crews__dialog-actions">
                      <button type="button" onClick={() => setShowContribute(false)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => {
                          const amt = Math.floor(Number(contributeAmt));
                          setShowContribute(false);
                          void act(
                            "contribute",
                            async () => {
                              const r = await crewsApi.contribute(token, detailId, amt);
                              if (r.notice) setNotice(r.notice);
                              await refreshDetail();
                              await loadList();
                            },
                            null
                          );
                        }}
                      >
                        Contribute {formatNairaCompact(Number(contributeAmt) || 0)}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ---- leave confirm ---- */}
              {confirmLeave && detailId && (
                <div
                  className="eko-crews__dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Leave crew"
                >
                  <div className="eko-crews__dialog-box">
                    <h3>Leave {detail.crew.name}?</h3>
                    <p>
                      Your xp stays with the crew. If you're the last one out,
                      the crew disbands.
                    </p>
                    <div className="eko-crews__dialog-actions">
                      <button type="button" onClick={() => setConfirmLeave(false)}>
                        Stay
                      </button>
                      <button
                        type="button"
                        disabled={busy != null}
                        onClick={() => {
                          setConfirmLeave(false);
                          void act(
                            "leave",
                            async () => {
                              const r = await crewsApi.leave(token, detailId);
                              if (r.disbanded) {
                                setNotice(r.notice ?? "The crew disbanded.");
                                goDiscover();
                              } else {
                                if (r.notice) setNotice(r.notice);
                                goDiscover();
                              }
                            },
                            null
                          );
                        }}
                      >
                        Leave crew
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </>
      )}

      {/* ---- create crew dialog ---- */}
      {showCreate && (
        <div
          className="eko-crews__dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Start a new crew"
        >
          <div className="eko-crews__dialog-box">
            <h3>Start a crew</h3>
            <p>Gather your people, climb the league, fund a shared goal.</p>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Crew name (3–24 characters)"
              maxLength={24}
              aria-label="Crew name"
            />
            <input
              value={newTagline}
              onChange={(e) => setNewTagline(e.target.value)}
              placeholder="Tagline (optional)"
              maxLength={80}
              aria-label="Crew tagline"
            />
            <div className="eko-crews__icons" role="group" aria-label="Crew icon">
              {ICON_PRESETS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  className={newIcon === ic ? "on" : ""}
                  onClick={() => setNewIcon(ic)}
                  aria-pressed={newIcon === ic}
                >
                  {ic}
                </button>
              ))}
            </div>
            <div className="eko-crews__dialog-actions">
              <button type="button" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy != null || newName.trim().length < 3}
                onClick={() => {
                  setShowCreate(false);
                  const name = newName.trim();
                  setNewName("");
                  setNewTagline("");
                  void act(
                    "create",
                    async () => {
                      const r = await crewsApi.create(token, {
                        name,
                        tagline: newTagline.trim(),
                        icon: newIcon,
                      });
                      setNotice(`🛡️ ${r.crew.name} is live — you're the founder.`);
                      await loadList();
                      openCrew(r.crew.id);
                    },
                    null
                  );
                }}
              >
                Start crew
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** One dense discover row: crest, name/meta, weekly xp, Join pill. */
function CrewRow({
  crew,
  busy,
  onOpen,
  onJoin,
}: {
  crew: CrewSummary;
  busy: boolean;
  onOpen: () => void;
  onJoin: () => void;
}) {
  return (
    <li className="eko-crews__row">
      <button
        type="button"
        className="eko-crews__crest"
        style={{ background: crestColor(crew.id) }}
        onClick={onOpen}
        aria-label={`Open ${crew.name}`}
      >
        {crew.icon}
      </button>
      <button type="button" className="eko-crews__main" onClick={onOpen}>
        <span className="eko-crews__name">{crew.name}</span>
        <span className="eko-crews__meta">
          {formatCrewMeta(crew.memberCount, crew.rank)}
          {crew.myRole ? " · you" : ""}
        </span>
      </button>
      <span className="eko-crews__xp">{formatCrewXp(crew.weeklyXp)} xp</span>
      {crew.myRole ? (
        <span className="eko-crews__member-badge">{crew.myRole}</span>
      ) : (
        <button
          type="button"
          className="eko-crews__join"
          disabled={busy}
          onClick={onJoin}
        >
          Join
        </button>
      )}
    </li>
  );
}

/** Board tab: weekly league leaderboard + the active shared goal card. */
function BoardTab({
  detail,
  onContribute,
}: {
  detail: CrewDetail;
  onContribute: (() => void) | null;
}) {
  return (
    <>
      <div className="eko-crews__sec">LEAGUE LEADERBOARD · THIS WEEK</div>
      <ul className="eko-crews__rows">
        {detail.board.map((b) => (
          <BoardRow key={b.id} entry={b} />
        ))}
      </ul>
      <div className="eko-crews__sec">ACTIVE SHARED GOAL</div>
      {detail.goal ? (
        <>
          <GoalCard goal={detail.goal} />
          {onContribute && (
            <div className="eko-crews__cta">
              <button
                type="button"
                className="eko-crews__contribute"
                onClick={onContribute}
              >
                Contribute {formatNairaCompact(DEFAULT_CONTRIBUTE)}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="eko-crews__empty">No active goal right now.</p>
      )}
    </>
  );
}

/** One leaderboard row: rank, name/meta, movement arrow, weekly xp. */
function BoardRow({ entry: b }: { entry: CrewBoardEntry }) {
  return (
    <li className={`eko-crews__row${b.isMine ? " eko-crews__row--mine" : ""}`}>
      <span className="eko-crews__rank">{b.rank}</span>
      <span className="eko-crews__main">
        <span className="eko-crews__name">{b.name}</span>
        <span className="eko-crews__meta">
          {b.memberCount} member{b.memberCount === 1 ? "" : "s"}
          {b.isMine ? " · you" : ""}
        </span>
      </span>
      {b.movement > 0 && <span className="eko-crews__up">▲{b.movement}</span>}
      {b.movement < 0 && <span className="eko-crews__down">▼{Math.abs(b.movement)}</span>}
      <span className="eko-crews__xp">{formatCrewXp(b.weeklyXp)}</span>
    </li>
  );
}

/** Shared goal progress card. */
function GoalCard({
  goal,
}: {
  goal: { title: string; target: number; raised: number; pct: number; endsAt: number };
}) {
  return (
    <div className="eko-crews__goalbox">
      <div className="eko-crews__name">{goal.title}</div>
      <div className="eko-crews__bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, Math.max(0, goal.pct))}%` }} />
      </div>
      <div className="eko-crews__meta eko-crews__goalmeta">
        {formatGoalLine(goal.raised, goal.target, goal.pct, goal.endsAt)}
      </div>
    </div>
  );
}
