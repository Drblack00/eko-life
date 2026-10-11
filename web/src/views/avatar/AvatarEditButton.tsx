import { useState } from "react";
import { Sheet, useToast } from "../../components";
import { AvatarStudio } from "./AvatarStudio";
import {
  AVATAR_LOOK_FALLBACK_OPTIONS,
  sanitizeAvatarLook,
  type ActName,
  type AvatarLook,
  type AvatarLookOptions,
} from "../../game/types";
import "./AvatarStudio.css";

/**
 * M15 "Edit look" entry for the Me tab profile header.
 *
 * Self-contained: renders the button and the modal sheet with the full
 * AvatarStudio. On save it fires `sendAct("save_avatar", { avatar: look })`
 * (WS is fire-and-forget; the server pushes the updated `you` afterwards),
 * closes the sheet and toasts on success.
 *
 * Integration (Game.tsx MeTab — one line in the profile header card):
 *
 *   <AvatarEditButton
 *     look={you.avatar_look}
 *     options={config?.avatarLook ?? AVATAR_LOOK_FALLBACK_OPTIONS}
 *     sendAct={sendAct}   // or sock.sendAct from the Game root
 *   />
 */
export function AvatarEditButton({
  look,
  options,
  sendAct,
  characterId,
}: {
  /** Raw character.avatar_look (sanitized internally against options). */
  look: unknown;
  options?: AvatarLookOptions;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
  /** Character id — when present, the rebuilt v1 editor is used. */
  characterId?: string | number;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const opts = options ?? AVATAR_LOOK_FALLBACK_OPTIONS;
  // Snapshot the look when the sheet opens so a mid-edit server push
  // can't wipe in-progress changes.
  const [draftInitial, setDraftInitial] = useState<AvatarLook | null>(null);

  const openSheet = () => {
    setDraftInitial(sanitizeAvatarLook(look ?? opts.defaults, opts));
    setOpen(true);
  };
  const closeSheet = () => {
    setOpen(false);
    setDraftInitial(null);
  };

  const handleSave = (next: AvatarLook) => {
    setSaving(true);
    try {
      // Exact payload shape the server contract expects.
      sendAct("save_avatar", { avatar: next });
      closeSheet();
      toast("Look saved!", "success");
    } catch {
      toast("Couldn't save your look. Try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="eko-avatar-edit"
        onClick={openSheet}
      >
        🎨 Edit look
      </button>
      <Sheet open={open} onClose={closeSheet} label="Edit your look">
        <div className="eko-avatar-edit__sheet">
          <h2>Edit your 3D look</h2>
          <p>Drag the preview to spin it. Changes apply when you save.</p>
          {draftInitial && (
            <AvatarStudio
              initial={draftInitial}
              options={opts}
              onSave={handleSave}
              saving={saving}
              characterId={characterId != null ? String(characterId) : undefined}
            />
          )}
        </div>
      </Sheet>
    </>
  );
}
