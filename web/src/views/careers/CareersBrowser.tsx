import { useEffect, useMemo, useState } from "react";
import { Button, Card, Dialog, EmptyState } from "../../components";
import { careersApi, naira, type CareerListing } from "./api";
import "./careers.css";

export interface CareersBrowserProps {
token: string;
  /** the viewer's skill levels, for lock display: { coding: 2 } */
  skills?: Record<string, number> | null;
  hasCert?: boolean;
  currentCareerId?: string | null;
  onApplied?: () => void;
}

function skillLevel(skills: Record<string, number> | null | undefined, skill: string): number {
  const v = Number(skills?.[skill]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

const PATH_LABEL: Record<string, string> = {
  tech: "Tech", product: "Product", medicine: "Medicine", banking: "Banking",
  refining: "Energy", media: "Media", corporate: "Corporate", campus: "Education",
  service: "Service", transport: "Transport", market: "Market", creative: "Creative",
  construction: "Construction",
};

export function CareersBrowser({ token, skills, hasCert, currentCareerId, onApplied }: CareersBrowserProps) {
  const [list, setList] = useState<CareerListing[] | null>(null);
  const [query, setQuery] = useState("");
  const [pathFilter, setPathFilter] = useState<string>("all");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const j = await careersApi.list();
        if (alive) setList(j.careers);
      } catch {
        /* empty state covers it */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const iv = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(iv);
  }, [toast]);

  const paths = useMemo(() => {
    const s = new Set((list ?? []).map((c) => c.path));
    return ["all", ...[...s].sort()];
  }, [list]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? []).filter(
      (c) =>
        (pathFilter === "all" || c.path === pathFilter) &&
        (!q || c.name.toLowerCase().includes(q) || c.blurb.toLowerCase().includes(q)),
    );
  }, [list, query, pathFilter]);

  if (!list) {
    return (
      <div className="p3-wrap">
        <EmptyState emoji="💼" title="Loading careers…" />
      </div>
    );
  }

  const gateReason = (c: CareerListing): string | null => {
    if (c.certRequired && !hasCert) return "🎓 Certificate needed";
    if (c.skillLock && skillLevel(skills, c.skillLock.skill) < c.skillLock.level)
      return `${c.skillLock.skill} Lv ${c.skillLock.level} needed`;
    return null;
  };

  const doApply = async (careerId: string) => {
    setBusy(true);
    try {
      const r = await careersApi.apply(token, careerId);
      setToast(
        r.switching
          ? `Switched to ${r.status.careerName} — starting again at rank 1.`
          : `Hired as ${r.status.rankTitle}!`,
      );
      setConfirmId(null);
      onApplied?.();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Application failed.");
    } finally {
      setBusy(false);
    }
  };

  const confirmCareer = confirmId ? list.find((c) => c.id === confirmId) : null;

  return (
    <div className="p3-wrap">
      {toast && <div className="p3-toast" role="status">{toast}</div>}
      <p className="p3-note">
        27 careers, 5 ranks each. Apply in one tap — switching careers restarts you at rank 1.
      </p>
      <div className="p3-filters">
        <input
          className="p3-search"
          type="search"
          placeholder="Search careers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search careers"
        />
        <div className="p3-chips" role="tablist" aria-label="Filter by field">
          {paths.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={pathFilter === p}
              className={`p3-chip${pathFilter === p ? " p3-chip--on" : ""}`}
              onClick={() => setPathFilter(p)}
            >
              {p === "all" ? "All" : PATH_LABEL[p] ?? p}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && <EmptyState emoji="🔍" title="No careers match" />}

      {filtered.map((c) => {
        const gate = gateReason(c);
        const isCurrent = currentCareerId === c.id;
        return (
          <Card key={c.id} className="p3-career">
            <div className="p3-career__head">
              <span className="p3-career__icon" aria-hidden="true">{c.icon}</span>
              <div>
                <div className="p3-career__name">{c.name}</div>
                <div className="p3-note">{c.blurb}</div>
              </div>
            </div>
            <div className="p3-career__meta">
              <span className="p3-career__pay">
                {naira(c.payBand[0])}–{naira(c.payBand[1])}/shift
              </span>
              <span className="p3-chip">{c.schedule}</span>
              {c.certRequired && <span className="p3-chip">🎓 cert</span>}
              {c.skillLock && (
                <span className="p3-chip">
                  {c.skillLock.skill} Lv {c.skillLock.level}
                  {skillLevel(skills, c.skillLock.skill) >= c.skillLock.level ? " ✓" : ""}
                </span>
              )}
            </div>
            <div className="p3-career__ranks">
              {c.ranks.map((r, i) => (
                <span key={r.title} className="p3-career__rank" title={`${r.title} — ${naira(r.payPerShift)}/shift`}>
                  {i + 1}. {r.title}
                </span>
              ))}
            </div>
            <Button
              variant={isCurrent ? "ghost" : gate ? "ghost" : "primary"}
              disabled={isCurrent || !!gate || busy}
              onClick={() => setConfirmId(c.id)}
              title={gate ?? undefined}
            >
              {isCurrent ? "Current career" : gate ? `🔒 ${gate}` : "Apply"}
            </Button>
          </Card>
        );
      })}

      <Dialog open={!!confirmCareer} onClose={() => setConfirmId(null)} title="Confirm application">
        {confirmCareer && (
          <>
            <p className="p3-dialog__text">
              Join <strong>{confirmCareer.name}</strong> as {confirmCareer.ranks[0].title} (
              {naira(confirmCareer.ranks[0].payPerShift)}/shift)?
              {currentCareerId && (
                <>
                  <br />
                  Switching careers <strong>restarts you at rank 1</strong> — your current
                  rank progress is wiped.
                </>
              )}
            </p>
            <div className="p3-dialog__actions">
              <Button variant="ghost" onClick={() => setConfirmId(null)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void doApply(confirmCareer.id)}>
                {busy ? "Applying…" : "Apply"}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}
