import "./StatBar.css";

/** Labeled 0–100 progress bar (energy, health, happiness, hunger). */
export function StatBar({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const tone =
    clamped >= 60 ? "good" : clamped >= 30 ? "warn" : "bad";
  return (
    <div className="eko-statbar">
      <div className="eko-statbar__head">
        <span className="eko-statbar__label">
          {icon && (
            <span aria-hidden="true" className="eko-statbar__icon">
              {icon}
            </span>
          )}
          {label}
        </span>
        <span className="eko-statbar__value" aria-hidden="true">
          {clamped}
        </span>
      </div>
      <div
        className="eko-statbar__track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`eko-statbar__fill eko-statbar__fill--${tone}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
