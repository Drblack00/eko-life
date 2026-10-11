import { useEffect, useRef, useState } from "react";
import { buildAvatarLook } from "./avatarModel";
import type { AvatarLook, AvatarLookOptions } from "../../game/types";
import { StudioPreview, type StudioPreviewApi } from "./editor/StudioPreview";
import { AvatarEditor } from "./editor/AvatarEditor";
import { PillRow, SwatchRow } from "./editor/controls";
import "./AvatarStudio.css";

/**
 * Avatar studio entry point.
 *
 * Props contract (unchanged, plus one optional field):
 * - characterId?: when present, the rebuilt M5 editor is used — three
 *   states (saved/draft/rendered) over fetchAppearance/saveAppearance with
 *   revision-guarded saves, category tabs, and instant local preview via
 *   AvatarLoader.diffUpdate. `initial`/`options`/`onSave` are ignored in
 *   this mode.
 * - otherwise the legacy M20 studio: flat AvatarLook, staged save, nothing
 *   leaves the client until onSave(current) is called.
 */

interface StudioProps {
  initial: AvatarLook;
  options: AvatarLookOptions;
  onSave: (look: AvatarLook) => void;
  saving?: boolean;
  compact?: boolean;
  /** Opt into the rebuilt M5 editor (REST persistence, revision guards). */
  characterId?: string;
}

export function AvatarStudio({
  initial,
  options,
  onSave,
  saving,
  compact,
  characterId,
}: StudioProps) {
  if (characterId) {
    return <AvatarEditor characterId={characterId} compact={compact} />;
  }
  return (
    <LegacyStudio
      initial={initial}
      options={options}
      onSave={onSave}
      saving={saving}
      compact={compact}
    />
  );
}

const key = (l: AvatarLook) => JSON.stringify(l);

/**
 * M20 avatar studio (workstream 3), unchanged behaviour: studio-grade
 * Three.js preview — 3-point lighting, soft shadows, drag-to-spin,
 * pinch/wheel zoom, and Face / Full-body camera presets — above the
 * option sections. Staged save — nothing leaves the client until
 * onSave(current) is called.
 *
 * M5: the Three.js shell moved to editor/StudioPreview (shared with the
 * rebuilt editor); this component keeps the legacy controls + save flow.
 */
function LegacyStudio({
  initial,
  options,
  onSave,
  saving,
  compact,
}: Omit<StudioProps, "characterId">) {
  const [look, setLook] = useState<AvatarLook>(initial);
  // Re-base when the parent hands us a new initial (e.g. after a save).
  const [baseKey, setBaseKey] = useState(key(initial));
  const ik = key(initial);
  if (ik !== baseKey) {
    setBaseKey(ik);
    setLook(initial);
  }
  const dirty = key(look) !== baseKey;

  const apiRef = useRef<StudioPreviewApi | null>(null);
  // Bumps when the preview (re)mounts so the figure is re-set even if
  // `look` didn't change (e.g. StrictMode remount of the preview alone).
  const [apiReady, setApiReady] = useState(0);

  // Rebuild the figure whenever the look changes (cheap: a few dozen meshes).
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const built = buildAvatarLook(look);
    api.setFigure({ group: built.group, update: built.update });
  }, [look, apiReady]);

  const pick = <K extends keyof AvatarLook>(field: K, value: AvatarLook[K]) =>
    setLook((prev) => (prev[field] === value ? prev : { ...prev, [field]: value }));

  return (
    <div className={`eko-studio${compact ? " eko-studio--compact" : ""}`}>
      <StudioPreview
        onApi={(api) => {
          apiRef.current = api;
          setApiReady((n) => n + 1);
        }}
      />

      <PillRow
        label="Body"
        items={options.bodies}
        value={look.body}
        onPick={(id) => pick("body", id as AvatarLook["body"])}
      />
      <PillRow
        label="Hairstyle"
        items={options.hairs}
        value={look.hair}
        onPick={(id) => pick("hair", id)}
      />
      <PillRow
        label="Outfit"
        items={options.outfits}
        value={look.outfit}
        onPick={(id) => pick("outfit", id)}
      />
      <PillRow
        label="Fabric"
        items={options.fabrics}
        value={look.fabric}
        onPick={(id) => pick("fabric", id)}
      />

      <SwatchRow
        label="Skin tone"
        colors={options.skins.map((s) => ({ id: s.id, hex: s.hex, name: s.name }))}
        value={look.skin}
        onPick={(id) => pick("skin", id)}
      />
      <SwatchRow
        label="Top colour"
        colors={options.topColors.map((c) => ({ id: c, hex: c, name: c }))}
        value={look.topColor}
        onPick={(id) => pick("topColor", id)}
      />
      <SwatchRow
        label="Bottom colour"
        colors={options.bottomColors.map((c) => ({ id: c, hex: c, name: c }))}
        value={look.bottomColor}
        onPick={(id) => pick("bottomColor", id)}
      />

      <div className="eko-studio__footer">
        <button
          type="button"
          className="eko-studio__reset"
          onClick={() => setLook(JSON.parse(baseKey) as AvatarLook)}
          disabled={!dirty || saving}
        >
          Reset
        </button>
        <button
          type="button"
          className="eko-studio__save glass"
          disabled={!dirty || saving}
          onClick={() => onSave(look)}
        >
          {saving ? "Saving…" : dirty ? "Save look" : "No changes yet"}
        </button>
      </div>
    </div>
  );
}
