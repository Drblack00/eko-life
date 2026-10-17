import { useCallback, useEffect, useState } from "react";
import { naira } from "../../game/types";
import { Loading } from "../../components/Loading";
import "./World.css";

export { naira };

/** Shared page header for world apps. */
export function WorldHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="world-head">
      <h2>{title}</h2>
      {sub ? <p>{sub}</p> : null}
    </div>
  );
}

export function WorldNotice({
  kind,
  children,
}: {
  kind?: "error" | "ok";
  children: React.ReactNode;
}) {
  if (!children) return null;
  return (
    <div className={`world-notice${kind ? ` world-notice--${kind}` : ""}`} role="status">
      {children}
    </div>
  );
}

/** Tabs bar for multi-section world apps. */
export function WorldTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="world-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === active}
          className={`world-tab${t.id === active ? " world-tab--active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Fetch-and-refresh helper for world apps: loads state with the token,
 * exposes reload + a busy flag for actions.
 */
export function useWorldState<T>(loader: (token: string) => Promise<T>, token: string) {
  const [state, setState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<"error" | "ok" | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await loader(token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load.");
    } finally {
      setLoading(false);
    }
  }, [loader, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<void>, doneMsg?: string) => {
      setBusy(true);
      setNotice(null);
      setNoticeKind(undefined);
      try {
        await fn();
        await load();
        if (doneMsg) {
          setNotice(doneMsg);
          setNoticeKind("ok");
        }
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Something went wrong.");
        setNoticeKind("error");
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  return { state, loading, error, busy, notice, noticeKind, load, run, setState };
}

export function WorldLoading() {
  return <Loading />;
}

/** Countdown like "9d 4h 12m". Exported for tests. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
