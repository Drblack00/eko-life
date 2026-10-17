import { useCallback, useEffect, useState } from "react";
import {
  hustleApi,
  type HustleGig,
  type HustleMeta,
  type HustlePro,
} from "../../lib/api";
import "./HustleApp.css";

/**
 * P6 — Hustle: gig board with escrow + find-a-pro (game coins only).
 *
 * Rails: Board (open gigs), Find a pro (pro cards with stars, jobs
 * done, services, from-rate, tagline; Book + Chat), My jobs (posted
 * gigs I can hire/close/cancel + gigs I'm working), Post a job.
 *
 * Escrow, in our own words: the fee is held safe the moment a client
 * hires someone and is released only when the client marks the job
 * done. Nothing is paid until someone is hired. Decorator jobs run
 * on a copy of the client's home, even offline. Never share your
 * password — hire through jobs.
 */

type Rail = "board" | "pros" | "myjobs" | "post";

function fmt(n: number): string {
  return `₦${Math.floor(Number(n) || 0).toLocaleString("en-NG")}`;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function Stars({ stars, count }: { stars: number; count?: number }) {
  const full = Math.round(stars);
  return (
    <span className="eko-hs__stars" title={`${stars.toFixed(1)} stars`}>
      {"★".repeat(full)}
      {"☆".repeat(Math.max(0, 5 - full))}
      <span className="eko-hs__muted eko-hs__small">
        {" "}
        {stars.toFixed(1)}
        {count != null && ` (${count})`}
      </span>
    </span>
  );
}

function GigCard({
  gig,
  mine,
  busy,
  onHire,
  onDone,
  onCancel,
  onReport,
}: {
  gig: HustleGig;
  mine?: boolean;
  busy: string | null;
  onHire?: (g: HustleGig) => void;
  onDone?: (g: HustleGig, rating: number) => void;
  onCancel?: (g: HustleGig) => void;
  onReport?: (g: HustleGig) => void;
}) {
  const [rating, setRating] = useState(5);
  const [confirmingDone, setConfirmingDone] = useState(false);
  return (
    <div className="eko-hs__card">
      <div className="eko-hs__row">
        <div>
          <div className="eko-hs__title">
            {gig.category.icon} {gig.title}
          </div>
          <div className="eko-hs__muted eko-hs__small">
            {gig.category.name} · {gig.startOption} · by @{gig.clientUsername}
            {gig.proUsername && <> · pro @{gig.proUsername}</>}
          </div>
        </div>
        <div className="eko-hs__fee">{fmt(gig.fee)}</div>
      </div>
      {gig.details && <p className="eko-hs__muted">{gig.details}</p>}
      {gig.materialsBudget > 0 && (
        <p className="eko-hs__muted eko-hs__small">
          Materials budget: {fmt(gig.materialsBudget)} (paid separately on agreement)
        </p>
      )}
      <div className="eko-hs__statusrow">
        <span
          className={
            gig.status === "open"
              ? "eko-hs__badge"
              : gig.status === "hired"
                ? "eko-hs__badge eko-hs__badge--hold"
                : gig.status === "done"
                  ? "eko-hs__badge eko-hs__badge--done"
                  : "eko-hs__badge eko-hs__badge--muted"
          }
        >
          {gig.status === "open" && "Open"}
          {gig.status === "hired" && "🔒 Fee held in escrow"}
          {gig.status === "done" && `Done${gig.rating ? ` · ★${gig.rating}` : ""}`}
          {gig.status === "cancelled" && "Cancelled"}
        </span>
      </div>
      {mine && gig.status === "open" && onHire && (
        <div className="eko-hs__actions">
          <button className="eko-hs__btn eko-hs__btn--primary" onClick={() => onHire(gig)}>
            🤝 Hire someone
          </button>
          <button
            className="eko-hs__btn"
            disabled={busy === `cancel-${gig.id}`}
            onClick={() => onCancel?.(gig)}
          >
            Cancel
          </button>
        </div>
      )}
      {mine && gig.status === "hired" && onDone && (
        <div className="eko-hs__actions">
          {!confirmingDone ? (
            <>
              <button className="eko-hs__btn eko-hs__btn--go" onClick={() => setConfirmingDone(true)}>
                ✅ Mark done — release {fmt(gig.fee)}
              </button>
              <button
                className="eko-hs__btn"
                disabled={busy === `cancel-${gig.id}`}
                onClick={() => onCancel?.(gig)}
              >
                Cancel (refund)
              </button>
            </>
          ) : (
            <>
              <label className="eko-hs__muted eko-hs__small">
                Rate the work:
                <select
                  className="eko-hs__select"
                  value={rating}
                  onChange={(e) => setRating(Number(e.target.value))}
                >
                  {[5, 4, 3, 2, 1].map((r) => (
                    <option key={r} value={r}>
                      {"★".repeat(r)} ({r})
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="eko-hs__btn eko-hs__btn--go"
                disabled={busy === `done-${gig.id}`}
                onClick={() => onDone(gig, rating)}
              >
                {busy === `done-${gig.id}` ? "…" : `Release ${fmt(gig.fee)}`}
              </button>
              <button className="eko-hs__btn" onClick={() => setConfirmingDone(false)}>
                Back
              </button>
            </>
          )}
        </div>
      )}
      {!mine && onReport && (
        <div className="eko-hs__actions">
          <button className="eko-hs__link" onClick={() => onReport(gig)}>
            🚩 Report
          </button>
        </div>
      )}
    </div>
  );
}

export function HustleApp({ token }: { token: string }) {
  const [rail, setRail] = useState<Rail>("board");
  const [meta, setMeta] = useState<HustleMeta | null>(null);
  const [gigs, setGigs] = useState<HustleGig[]>([]);
  const [pros, setPros] = useState<HustlePro[]>([]);
  const [posted, setPosted] = useState<HustleGig[]>([]);
  const [working, setWorking] = useState<HustleGig[]>([]);
  const [catFilter, setCatFilter] = useState("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Post-a-job form.
  const [pCat, setPCat] = useState("");
  const [pTitle, setPTitle] = useState("");
  const [pDetails, setPDetails] = useState("");
  const [pFee, setPFee] = useState("5000");
  const [pMats, setPMats] = useState("");
  const [pStart, setPStart] = useState("now");

  // Hire-me form.
  const [hireMe, setHireMe] = useState(false);
  const [hCats, setHCats] = useState<string[]>([]);
  const [hRate, setHRate] = useState("2000");
  const [hTag, setHTag] = useState("");
  const [hServices, setHServices] = useState("");

  // Book-a-pro form.
  const [booking, setBooking] = useState<HustlePro | null>(null);
  const [bTitle, setBTitle] = useState("");
  const [bDetails, setBDetails] = useState("");
  const [bFee, setBFee] = useState("");
  const [bCat, setBCat] = useState("");
  const [bStart, setBStart] = useState("now");

  // Hire picker (choose a pro for my open gig).
  const [hiringFor, setHiringFor] = useState<HustleGig | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await hustleApi.meta(token);
      setMeta(m);
      if (!pCat && m.categories.length) setPCat(m.categories[0].key);
      const g = await hustleApi.gigs(token);
      setGigs(g.gigs);
      const p = await hustleApi.pros(token);
      setPros(p.pros);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const loadMyJobs = useCallback(async () => {
    try {
      const mj = await hustleApi.myjobs(token);
      setPosted(mj.posted);
      setWorking(mj.working);
    } catch (e) {
      setToast(errMsg(e));
    }
  }, [token]);

  useEffect(() => {
    if (rail === "myjobs") loadMyJobs();
  }, [rail, loadMyJobs]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function refreshBoard() {
    const g = await hustleApi.gigs(token, catFilter === "all" ? undefined : catFilter, q || undefined);
    setGigs(g.gigs);
  }

  async function refreshPros() {
    const p = await hustleApi.pros(token, catFilter === "all" ? undefined : catFilter, q || undefined);
    setPros(p.pros);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (rail === "board") refreshBoard().catch(() => {});
      if (rail === "pros") refreshPros().catch(() => {});
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, catFilter]);

  async function postJob() {
    setBusy("post");
    try {
      const r = await hustleApi.post(token, {
        category: pCat,
        title: pTitle.trim(),
        details: pDetails.trim(),
        fee: Math.floor(Number(pFee) || 0),
        materialsBudget: Math.floor(Number(pMats) || 0),
        startOption: pStart,
      });
      setPTitle("");
      setPDetails("");
      setToast(r.copy.noPay);
      setRail("myjobs");
      loadMyJobs();
    } catch (e) {
      setToast(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function hireFor(gig: HustleGig, proUserId: number | null) {
    setBusy(`hire-${gig.id}`);
    try {
      const r = await hustleApi.hire(token, gig.id, proUserId);
      setToast(r.copy.escrow);
      setHiringFor(null);
      loadMyJobs();
    } catch (e) {
      setToast(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function markDone(gig: HustleGig, rating: number) {
    setBusy(`done-${gig.id}`);
    try {
      await hustleApi.done(token, gig.id, rating);
      setToast(`Released ${fmt(gig.fee)} to @${gig.proUsername ?? "the pro"}. Nice one. 🤝`);
      loadMyJobs();
    } catch (e) {
      setToast(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancelGig(gig: HustleGig) {
    setBusy(`cancel-${gig.id}`);
    try {
      await hustleApi.cancel(token, gig.id);
      setToast(gig.status === "hired" ? "Cancelled — the held fee is back in your pocket." : "Job cancelled.");
      loadMyJobs();
      refreshBoard().catch(() => {});
    } catch (e) {
      setToast(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function submitHireMe() {
    setBusy("hireme");
    try {
      await hustleApi.listMe(token, {
        categories: hCats,
        rateFrom: Math.floor(Number(hRate) || 1000),
        tagline: hTag.trim(),
        services: hServices.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setHireMe(false);
      setToast("You're listed — clients can find and book you now. 💪");
      refreshPros().catch(() => {});
      const m = await hustleApi.meta(token);
      setMeta(m);
    } catch (e) {
      setToast(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function submitBook() {
    if (!booking) return;
    setBusy("book");
    try {
      const r = await hustleApi.book(token, {
        proUserId: booking.userId,
        category: bCat || booking.categories[0]?.key || "errands",
        title: bTitle.trim() || `${booking.username} booking`,
        details: bDetails.trim(),
        fee: Math.floor(Number(bFee) || booking.rateFrom),
        startOption: bStart,
      });
      setBooking(null);
      setToast(r.copy.escrow);
      setRail("myjobs");
      loadMyJobs();
    } catch (e) {
      setToast(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="eko-hs"><p className="eko-hs__muted">Loading Hustle…</p></div>;
  if (error || !meta)
    return (
      <div className="eko-hs">
        <p className="eko-hs__muted">{error ?? "Could not load Hustle."}</p>
        <button className="eko-hs__btn" onClick={load}>Retry</button>
      </div>
    );

  return (
    <div className="eko-hs">
      <div className="eko-hs__head">
        <div>
          <h2 className="eko-hs__h">🧰 Hustle</h2>
          <p className="eko-hs__muted">{meta.copy.escrow}</p>
        </div>
      </div>

      <div className="eko-hs__chips" role="tablist" aria-label="Hustle">
        {([["board", "📋 Board"], ["pros", "🙋🏾 Find a pro"], ["myjobs", "📁 My jobs"], ["post", "➕ Post a job"]] as [Rail, string][]).map(
          ([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={rail === id}
              className={rail === id ? "eko-hs__chip eko-hs__chip--on" : "eko-hs__chip"}
              onClick={() => setRail(id)}
            >
              {label}
              {id === "myjobs" && meta.me.openGigs + meta.me.workingGigs > 0 && (
                <span className="eko-hs__count">{meta.me.openGigs + meta.me.workingGigs}</span>
              )}
            </button>
          )
        )}
      </div>

      <div className="eko-hs__tools">
        <input
          className="eko-hs__input"
          placeholder="Search gigs or pros…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search"
        />
      </div>
      {(rail === "board" || rail === "pros") && (
        <div className="eko-hs__chips eko-hs__chips--sub" aria-label="Filter by category">
          <button
            className={catFilter === "all" ? "eko-hs__chip eko-hs__chip--on" : "eko-hs__chip"}
            onClick={() => setCatFilter("all")}
          >
            All
          </button>
          {meta.categories.map((c) => (
            <button
              key={c.key}
              className={catFilter === c.key ? "eko-hs__chip eko-hs__chip--on" : "eko-hs__chip"}
              onClick={() => setCatFilter(c.key)}
              title={c.blurb}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>
      )}

      {toast && <p className="eko-hs__toast" role="status">{toast}</p>}

      {rail === "board" && (
        <>
          {gigs.length === 0 && (
            <p className="eko-hs__muted">No open gigs right now — post one and put the city to work. 📋</p>
          )}
          <div className="eko-hs__list">
            {gigs.map((g) => (
              <GigCard
                key={g.id}
                gig={g}
                busy={busy}
                onReport={async (gg) => {
                  try {
                    await hustleApi.reportGig(token, gg.id);
                    setGigs((xs) => xs.filter((x) => x.id !== gg.id));
                  } catch (e) {
                    setToast(errMsg(e));
                  }
                }}
              />
            ))}
          </div>
          <p className="eko-hs__muted eko-hs__small">{meta.copy.safety}</p>
        </>
      )}

      {rail === "pros" && (
        <>
          <div className="eko-hs__actions">
            {!meta.me.isPro ? (
              <button className="eko-hs__btn eko-hs__btn--primary" onClick={() => setHireMe(true)}>
                🙋🏾 Hire me — list my services
              </button>
            ) : (
              <>
                <span className="eko-hs__muted eko-hs__small">
                  You're listed · <Stars stars={meta.me.stars} /> · {meta.me.jobsDone} jobs done
                </span>
                <button
                  className="eko-hs__btn"
                  onClick={async () => {
                    try {
                      await hustleApi.unlist(token);
                      const m = await hustleApi.meta(token);
                      setMeta(m);
                      refreshPros().catch(() => {});
                    } catch (e) {
                      setToast(errMsg(e));
                    }
                  }}
                >
                  Unlist me
                </button>
              </>
            )}
          </div>
          {hireMe && (
            <div className="eko-hs__card">
              <div className="eko-hs__title">List your services</div>
              <label className="eko-hs__label">I do (pick at least one)</label>
              <div className="eko-hs__chips">
                {meta.categories.map((c) => (
                  <button
                    key={c.key}
                    className={hCats.includes(c.key) ? "eko-hs__chip eko-hs__chip--on" : "eko-hs__chip"}
                    onClick={() =>
                      setHCats((xs) => (xs.includes(c.key) ? xs.filter((x) => x !== c.key) : [...xs, c.key]))
                    }
                  >
                    {c.icon} {c.name}
                  </button>
                ))}
              </div>
              <label className="eko-hs__label" htmlFor="eko-hs-rate">From rate (₦)</label>
              <input id="eko-hs-rate" className="eko-hs__input" inputMode="numeric" value={hRate} onChange={(e) => setHRate(e.target.value)} />
              <label className="eko-hs__label" htmlFor="eko-hs-tag">Tagline</label>
              <input id="eko-hs-tag" className="eko-hs__input" placeholder="e.g. I turn rooms around fast." value={hTag} onChange={(e) => setHTag(e.target.value)} />
              <label className="eko-hs__label" htmlFor="eko-hs-svc">Services (comma separated)</label>
              <input id="eko-hs-svc" className="eko-hs__input" placeholder="e.g. Full room refresh, Curtain styling" value={hServices} onChange={(e) => setHServices(e.target.value)} />
              <div className="eko-hs__actions">
                <button className="eko-hs__btn eko-hs__btn--primary" disabled={busy === "hireme"} onClick={submitHireMe}>
                  {busy === "hireme" ? "…" : "List me"}
                </button>
                <button className="eko-hs__btn" onClick={() => setHireMe(false)}>Cancel</button>
              </div>
            </div>
          )}
          {pros.length === 0 && <p className="eko-hs__muted">No pros listed here yet — be the first. 🙋🏾</p>}
          <div className="eko-hs__list">
            {pros.map((p) => (
              <div key={p.userId} className="eko-hs__card">
                <div className="eko-hs__row">
                  <div>
                    <div className="eko-hs__title">@{p.username}</div>
                    <Stars stars={p.stars} count={p.ratingsCount} />
                    <div className="eko-hs__muted eko-hs__small">
                      {p.jobsDone} jobs done · from {fmt(p.rateFrom)}
                    </div>
                  </div>
                </div>
                <p className="eko-hs__muted">“{p.tagline}”</p>
                <div className="eko-hs__chips eko-hs__chips--sub">
                  {p.categories.map((c) => (
                    <span key={c.key} className="eko-hs__tag">{c.icon} {c.name}</span>
                  ))}
                </div>
                {p.services.length > 0 && (
                  <p className="eko-hs__muted eko-hs__small">Offers: {p.services.join(" · ")}</p>
                )}
                <div className="eko-hs__actions">
                  <button
                    className="eko-hs__btn eko-hs__btn--primary"
                    onClick={() => {
                      setBooking(p);
                      setBCat(p.categories[0]?.key ?? "errands");
                      setBFee(String(p.rateFrom));
                      setBTitle("");
                      setBDetails("");
                    }}
                  >
                    🧰 Book
                  </button>
                  <button
                    className="eko-hs__btn"
                    onClick={() => setToast(`Open the Chat app and message @${p.username} to talk details first.`)}
                  >
                    💬 Chat
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {rail === "myjobs" && (
        <>
          <h3 className="eko-hs__sub">Gigs I'm working</h3>
          {working.length === 0 && <p className="eko-hs__muted eko-hs__small">None in progress — find clients on the board or get listed as a pro.</p>}
          <div className="eko-hs__list">
            {working.map((g) => (
              <GigCard key={g.id} gig={g} busy={busy} />
            ))}
          </div>
          <h3 className="eko-hs__sub">Jobs I posted</h3>
          {posted.length === 0 && <p className="eko-hs__muted eko-hs__small">Nothing posted yet.</p>}
          <div className="eko-hs__list">
            {posted.map((g) => (
              <div key={g.id}>
                <GigCard
                  gig={g}
                  mine
                  busy={busy}
                  onHire={(gg) => setHiringFor(gg)}
                  onDone={(gg, rating) => markDone(gg, rating)}
                  onCancel={cancelGig}
                />
              </div>
            ))}
          </div>
          {hiringFor && (
            <div className="eko-hs__scrim" role="dialog" aria-label="Hire for this job">
              <div className="eko-hs__card eko-hs__card--wide">
                <div className="eko-hs__row">
                  <div className="eko-hs__title">Hire for “{hiringFor.title}”</div>
                  <button className="eko-hs__x" onClick={() => setHiringFor(null)} aria-label="Close">✕</button>
                </div>
                <p className="eko-hs__muted eko-hs__small">
                  {fmt(hiringFor.fee)} will be held safe — not paid — until you mark the job done.
                </p>
                {pros.length === 0 && (
                  <p className="eko-hs__muted">No pros listed yet. They'll appear here once someone lists their services.</p>
                )}
                <div className="eko-hs__list">
                  {pros.map((p) => (
                    <div key={p.userId} className="eko-hs__row">
                      <div>
                        <div className="eko-hs__title">@{p.username}</div>
                        <Stars stars={p.stars} count={p.ratingsCount} />
                      </div>
                      <button
                        className="eko-hs__btn eko-hs__btn--primary"
                        disabled={busy === `hire-${hiringFor.id}`}
                        onClick={() => hireFor(hiringFor, p.userId)}
                      >
                        Hire
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="eko-hs__btn"
                  disabled={busy === `hire-${hiringFor.id}`}
                  onClick={() => hireFor(hiringFor, null)}
                >
                  Hire without a listed pro (pay on completion handshake)
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {rail === "post" && (
        <div className="eko-hs__card">
          <div className="eko-hs__title">Post a job</div>
          <label className="eko-hs__label">Category</label>
          <div className="eko-hs__chips">
            {meta.categories.map((c) => (
              <button
                key={c.key}
                className={pCat === c.key ? "eko-hs__chip eko-hs__chip--on" : "eko-hs__chip"}
                onClick={() => setPCat(c.key)}
                title={c.blurb}
              >
                {c.icon} {c.name}
              </button>
            ))}
          </div>
          {pCat === "decorator" && (
            <p className="eko-hs__muted eko-hs__small">🔒 {meta.copy.decorator}</p>
          )}
          <label className="eko-hs__label" htmlFor="eko-hs-title">Title</label>
          <input id="eko-hs-title" className="eko-hs__input" placeholder="e.g. Freshen up my sitting room" value={pTitle} onChange={(e) => setPTitle(e.target.value)} />
          <label className="eko-hs__label" htmlFor="eko-hs-details">Details</label>
          <textarea id="eko-hs-details" className="eko-hs__input eko-hs__area" placeholder="What exactly should they do?" value={pDetails} onChange={(e) => setPDetails(e.target.value)} rows={3} />
          <div className="eko-hs__grid2">
            <div>
              <label className="eko-hs__label" htmlFor="eko-hs-fee">Fee (₦{meta.minFee.toLocaleString("en-NG")}+)</label>
              <input id="eko-hs-fee" className="eko-hs__input" inputMode="numeric" value={pFee} onChange={(e) => setPFee(e.target.value)} />
            </div>
            <div>
              <label className="eko-hs__label" htmlFor="eko-hs-mats">Materials budget (optional)</label>
              <input id="eko-hs-mats" className="eko-hs__input" inputMode="numeric" placeholder="0" value={pMats} onChange={(e) => setPMats(e.target.value)} />
            </div>
          </div>
          <label className="eko-hs__label">Start</label>
          <div className="eko-hs__chips">
            {meta.startOptions.map((s) => (
              <button
                key={s.key}
                className={pStart === s.key ? "eko-hs__chip eko-hs__chip--on" : "eko-hs__chip"}
                onClick={() => setPStart(s.key)}
              >
                {s.name}
              </button>
            ))}
          </div>
          <p className="eko-hs__muted eko-hs__small">{meta.copy.noPay} {meta.copy.safety}</p>
          <button
            className="eko-hs__btn eko-hs__btn--primary eko-hs__btn--big"
            disabled={busy === "post"}
            onClick={postJob}
          >
            {busy === "post" ? "…" : "📋 Post the job"}
          </button>
        </div>
      )}

      {booking && (
        <div className="eko-hs__scrim" role="dialog" aria-label="Book this pro">
          <div className="eko-hs__card eko-hs__card--wide">
            <div className="eko-hs__row">
              <div className="eko-hs__title">Book @{booking.username}</div>
              <button className="eko-hs__x" onClick={() => setBooking(null)} aria-label="Close">✕</button>
            </div>
            <p className="eko-hs__muted eko-hs__small">
              The fee is held safe until you mark the job done — {meta.copy.safety}
            </p>
            <label className="eko-hs__label">Category</label>
            <div className="eko-hs__chips">
              {booking.categories.map((c) => (
                <button
                  key={c.key}
                  className={bCat === c.key ? "eko-hs__chip eko-hs__chip--on" : "eko-hs__chip"}
                  onClick={() => setBCat(c.key)}
                >
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
            <label className="eko-hs__label" htmlFor="eko-hs-btitle">Job title</label>
            <input id="eko-hs-btitle" className="eko-hs__input" value={bTitle} onChange={(e) => setBTitle(e.target.value)} placeholder="What should they do?" />
            <label className="eko-hs__label" htmlFor="eko-hs-bdetails">Details</label>
            <textarea id="eko-hs-bdetails" className="eko-hs__input eko-hs__area" rows={2} value={bDetails} onChange={(e) => setBDetails(e.target.value)} />
            <div className="eko-hs__grid2">
              <div>
                <label className="eko-hs__label" htmlFor="eko-hs-bfee">Fee (₦)</label>
                <input id="eko-hs-bfee" className="eko-hs__input" inputMode="numeric" value={bFee} onChange={(e) => setBFee(e.target.value)} />
              </div>
              <div>
                <label className="eko-hs__label">Start</label>
                <div className="eko-hs__chips">
                  {meta.startOptions.slice(0, 4).map((s) => (
                    <button
                      key={s.key}
                      className={bStart === s.key ? "eko-hs__chip eko-hs__chip--on" : "eko-hs__chip"}
                      onClick={() => setBStart(s.key)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="eko-hs__actions">
              <button className="eko-hs__btn eko-hs__btn--primary" disabled={busy === "book"} onClick={submitBook}>
                {busy === "book" ? "…" : `🤝 Hire @${booking.username} — hold ${fmt(Number(bFee) || booking.rateFrom)}`}
              </button>
              <button className="eko-hs__btn" onClick={() => setBooking(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
