import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Loading,
  useToast,
} from "../../../components";
import {
  drawBillboardCreative,
  type BillboardCreative,
} from "../../../game/billboardCanvas";
import "./m13.css";

export interface AdminBillboard extends BillboardCreative {
  id: number;
  headline: string;
  x: number;
  y: number;
  scale: number;
  active: boolean;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

async function adminFetch<T>(
  token: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

const listBillboards = (token: string) =>
  adminFetch<{ billboards: AdminBillboard[] }>(
    token,
    "/api/admin/billboards"
  ).then((b) => (Array.isArray(b?.billboards) ? b.billboards : []));

/** Live canvas preview of a creative (same renderer as the 3D map). */
function CreativePreview({
  creative,
  label,
}: {
  creative: BillboardCreative;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    drawBillboardCreative(g, creative, c.width, c.height);
  }, [creative.bg, creative.fg, creative.accent, creative.headline, creative.subtext]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <canvas
      ref={ref}
      width={512}
      height={256}
      className="eko-m13__preview"
      role="img"
      aria-label={label}
    />
  );
}

interface FormState {
  headline: string;
  subtext: string;
  bg: string;
  fg: string;
  accent: string;
  x: number;
  y: number;
  scale: number;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  headline: "",
  subtext: "",
  bg: "#0f172a",
  fg: "#ffffff",
  accent: "#22d3ee",
  x: 50,
  y: 50,
  scale: 1,
  active: true,
};

function toForm(b: AdminBillboard): FormState {
  return {
    headline: b.headline,
    subtext: b.subtext || "",
    bg: HEX_RE.test(b.bg || "") ? b.bg! : "#0f172a",
    fg: HEX_RE.test(b.fg || "") ? b.fg! : "#ffffff",
    accent: HEX_RE.test(b.accent || "") ? b.accent! : "#22d3ee",
    x: Number(b.x) || 0,
    y: Number(b.y) || 0,
    scale: Number(b.scale) || 1,
    active: b.active !== false,
  };
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="eko-m13__slider">
      <span className="eko-m13__slider-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="eko-m13__color">
      <span>{label}</span>
      <span className="eko-m13__color-row">
        <input
          type="color"
          value={HEX_RE.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} picker`}
        />
        <input
          className="eko-input eko-m13__hex"
          value={value}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} hex`}
        />
      </span>
    </label>
  );
}

export function BillboardsManager({ token }: { token: string }) {
  const { toast } = useToast();
  const [boards, setBoards] = useState<AdminBillboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editing, setEditing] = useState<AdminBillboard | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<AdminBillboard | null>(null);
  const [busy, setBusy] = useState(false);
  const liveRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listBillboards(token);
      if (!liveRef.current) return;
      setBoards(list);
    } catch (err) {
      if (!liveRef.current) return;
      setError(err instanceof Error ? err.message : "Couldn't load billboards.");
      setBoards([]);
    } finally {
      if (liveRef.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    liveRef.current = true;
    void load();
    return () => {
      liveRef.current = false;
    };
  }, [load]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const startEdit = (b: AdminBillboard) => {
    setEditing(b);
    setForm(toForm(b));
  };

  const save = async () => {
    if (saving) return;
    const headline = form.headline.trim();
    if (!headline) {
      toast("Give the billboard a headline first.", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        headline,
        subtext: form.subtext.trim(),
        bg: form.bg,
        fg: form.fg,
        accent: form.accent,
        x: form.x,
        y: form.y,
        scale: form.scale,
        ...(editing ? { active: form.active } : {}),
      };
      if (editing) {
        await adminFetch(token, `/api/admin/billboards/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast("Billboard updated.", "success");
      } else {
        await adminFetch(token, "/api/admin/billboards", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast("Billboard placed on the map.", "success");
      }
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the billboard.", "error");
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await adminFetch(token, `/api/admin/billboards/${deleting.id}`, {
        method: "DELETE",
      });
      toast("Billboard removed.", "success");
      setDeleting(null);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't delete the billboard.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="eko-m13" elevated>
      <h2 className="eko-m13__title">🪧 Map billboards</h2>
      <p className="eko-m13__note">
        In-world ad boards rendered on the 3D city map. Coords are map units
        0–100 (the lagoon runs down the middle, roughly x 42–58). New boards
        appear on the map on the next page load.
      </p>

      <div className="eko-m13__editor">
        <CreativePreview
          creative={form}
          label={`Preview of “${form.headline || "untitled"}” billboard`}
        />
        <div className="eko-m13__fields">
          <label className="eko-m13__field">
            <span>Headline (max 60)</span>
            <input
              className="eko-input"
              value={form.headline}
              maxLength={60}
              onChange={(e) => set("headline", e.target.value)}
              placeholder="MAMA PUT 2.0"
            />
          </label>
          <label className="eko-m13__field">
            <span>Subtext (max 120)</span>
            <input
              className="eko-input"
              value={form.subtext}
              maxLength={120}
              onChange={(e) => set("subtext", e.target.value)}
              placeholder="Now with extra pepper!"
            />
          </label>
          <div className="eko-m13__colors">
            <ColorField label="Background" value={form.bg} onChange={(v) => set("bg", v)} />
            <ColorField label="Text" value={form.fg} onChange={(v) => set("fg", v)} />
            <ColorField label="Accent" value={form.accent} onChange={(v) => set("accent", v)} />
          </div>
          <Slider label="X (west → east)" value={form.x} min={0} max={100} step={1} onChange={(v) => set("x", v)} />
          <Slider label="Y (north → south)" value={form.y} min={0} max={100} step={1} onChange={(v) => set("y", v)} />
          <Slider label="Scale" value={form.scale} min={0.5} max={3} step={0.1} onChange={(v) => set("scale", v)} />
          {editing && (
            <label className="eko-m13__check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set("active", e.target.checked)}
              />
              <span>Active (visible on the map)</span>
            </label>
          )}
          <div className="eko-m13__actions">
            <Button size="md" variant="accent" onClick={() => void save()} loading={saving}>
              {editing ? "Save changes" : "Place billboard"}
            </Button>
            {editing && (
              <Button size="md" variant="ghost" onClick={startCreate} disabled={saving}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>

      <h3 className="eko-m13__list-title">
        On the map ({boards.length})
      </h3>
      {loading ? (
        <Loading message="Loading billboards…" />
      ) : error ? (
        <EmptyState emoji="🔒" title="Can't load billboards" body={error} />
      ) : boards.length === 0 ? (
        <EmptyState
          emoji="🪧"
          title="No billboards yet"
          body="Place the first one with the form above."
        />
      ) : (
        <ul className="eko-m13__list">
          {boards.map((b) => (
            <li key={b.id} className={`eko-m13__row ${b.active ? "" : "eko-m13__row--off"}`}>
              <CreativePreview creative={b} label={`“${b.headline}” billboard`} />
              <div className="eko-m13__row-meta">
                <strong>{b.headline}</strong>
                <span className="eko-m13__row-sub">
                  {b.subtext || "—"} · ({Math.round(b.x)}, {Math.round(b.y)}) · ×{b.scale}
                </span>
                {!b.active && <span className="eko-m13__badge">Hidden</span>}
              </div>
              <div className="eko-m13__row-actions">
                <Button size="md" variant="ghost" onClick={() => startEdit(b)}>
                  Edit
                </Button>
                <Button size="md" variant="danger" onClick={() => setDeleting(b)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={deleting !== null}
        onClose={() => (busy ? undefined : setDeleting(null))}
        title="Remove billboard?"
      >
        {deleting && (
          <div className="eko-m13__confirm">
            <p>
              Remove <strong>“{deleting.headline}”</strong> from the map? This
              can't be undone.
            </p>
            <div className="eko-m13__confirm-actions">
              <Button variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void doDelete()} loading={busy}>
                Remove
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
