import { useCallback, useState } from "react";
import "./Walkthrough.css";

/* ------------------------------------------------------------------ */
/* Walkthrough — skippable first-launch coach-mark overlay. 5 steps,    */
/* glass card, progress dots. The seen-flag lives in localStorage      */
/* (`eko-walkthrough-seen-v1`); replayable from Me → Settings.         */
/* ------------------------------------------------------------------ */

export const WALKTHROUGH_KEY = "eko-walkthrough-seen-v1";

const STEPS: Array<{ icon: string; title: string; body: string }> = [
  {
    icon: "🏠",
    title: "Your room, your rules",
    body: "This is your corner of the city. Drag the room to look around, and tap any furniture to move, store or sell it.",
  },
  {
    icon: "🛒",
    title: "Buy tab — furnish it",
    body: "Beds, sofas, lights, decor. The Buy tab is the full catalogue — style the room until it feels like you.",
  },
  {
    icon: "🗺️",
    title: "Map tab — explore",
    body: "Tap any pin on the city map to travel there. Work shifts, food spots and fun are all out in the city.",
  },
  {
    icon: "📱",
    title: "Phone — everything lives here",
    body: "Jobs, Daily hustle, Market, Chat, Friends and your profile all moved into the phone. Tap the Phone tab to open it.",
  },
  {
    icon: "💚",
    title: "Needs bar — stay sharp",
    body: "The mini bars on your room track hunger, energy, fun and more. Tap them anytime to eat, rest or take care of yourself.",
  },
];

export function Walkthrough({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;

  const skip = useCallback(() => {
    try {
      localStorage.setItem(WALKTHROUGH_KEY, "1");
    } catch {
      /* private mode — the overlay just closes */
    }
    onDone();
  }, [onDone]);

  if (!open) return null;
  const s = STEPS[step];

  return (
    <div className="eko-walk" role="dialog" aria-modal="true" aria-label="Quick tour">
      <div className="eko-walk__scrim" />
      <div className="eko-walk__card glass">
        <div className="eko-walk__icon" aria-hidden="true">
          {s.icon}
        </div>
        <p className="eko-walk__kicker">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 className="eko-walk__title">{s.title}</h2>
        <p className="eko-walk__body">{s.body}</p>
        <div className="eko-walk__dots" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`eko-walk__dot ${i === step ? "is-on" : ""}`}
            />
          ))}
        </div>
        <div className="eko-walk__row">
          {step > 0 ? (
            <button
              type="button"
              className="eko-walk__btn eko-walk__btn--ghost"
              onClick={() => setStep((n) => n - 1)}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="eko-walk__btn eko-walk__btn--primary"
            onClick={() => (last ? skip() : setStep((n) => n + 1))}
          >
            {last ? "Start playing" : "Next"}
          </button>
        </div>
        <button
          type="button"
          className="eko-walk__skip"
          onClick={skip}
        >
          Skip tour
        </button>
      </div>
    </div>
  );
}
