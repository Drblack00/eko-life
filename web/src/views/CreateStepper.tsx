import "./CreateStepper.css";

/**
 * CreateStepper — labeled creation stepper for the 3-page character flow.
 *
 * Approved design: ~/workspace/eko-life-mockups/city-flow-b-stepper.html
 * (reproduce exactly). "✓ Style → ② City → ③ Avatar": green checks for
 * completed steps, glowing amber for the current step. Back arrow on
 * pages 2–3 (ghost placeholder on page 1 keeps the stepper centered).
 */

export type CreateStep = 1 | 2 | 3;

const STEPS: Array<{ n: CreateStep; label: string }> = [
  { n: 1, label: "Style" },
  { n: 2, label: "City" },
  { n: 3, label: "Avatar" },
];

export function CreateStepper({
  step,
  onBack,
}: {
  step: CreateStep;
  /** Back handler. Omitted on page 1 (renders a ghost spacer instead). */
  onBack?: () => void;
}) {
  return (
    <div className="cc-topbar">
      {onBack ? (
        <button
          type="button"
          className="cc-back"
          onClick={onBack}
          aria-label="Back"
        >
          ‹
        </button>
      ) : (
        <span className="cc-back cc-back--ghost" aria-hidden="true" />
      )}
      <nav className="cc-stepper" aria-label="Character creation progress">
        {STEPS.map((s, i) => {
          const done = s.n < step;
          const now = s.n === step;
          return (
            <span key={s.n} style={{ display: "contents" }}>
              {i > 0 && (
                <span
                  className={`cc-sep${s.n <= step ? " cc-sep--done" : ""}`}
                  aria-hidden="true"
                />
              )}
              <span
                className={`cc-stp${done ? " cc-stp--done" : ""}${now ? " cc-stp--now" : ""}`}
                aria-current={now ? "step" : undefined}
              >
                <i aria-hidden="true">{done ? "✓" : s.n}</i>
                {s.label}
              </span>
            </span>
          );
        })}
      </nav>
    </div>
  );
}
