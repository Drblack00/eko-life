import { AvatarEditor } from "./avatar/editor/AvatarEditor";
import "./avatar/AvatarStudio.css";

/**
 * Style — the dedicated Phone app for the avatar studio (M8).
 *
 * Full-screen 3D studio: large live preview, category tabs (Face, Body,
 * Skin, Hair, Extras, Outfit), Save / Cancel / Default, unsaved-changes
 * indicator, 409 conflict handling and toasts — all owned by AvatarEditor.
 * The Phone shell already provides the "Style" title + back navigation.
 */
export function StyleApp({ characterId }: { characterId: string }) {
  return (
    <div className="eko-styleapp">
      <AvatarEditor characterId={characterId} />
    </div>
  );
}
