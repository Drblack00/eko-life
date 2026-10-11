/**
 * Avatar studio — shared option-row controls (Milestone 5).
 *
 * PillRow (named options) and SwatchRow (colour swatches), extracted from
 * the legacy AvatarStudio so the rebuilt editor reuses the exact same
 * controls and CSS. No behaviour change.
 */

export interface NamedItem {
  id: string;
  name: string;
}

export function PillRow({
  label,
  items,
  value,
  onPick,
}: {
  label: string;
  items: readonly NamedItem[];
  value: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="eko-studio__row glass">
      <span className="eko-studio__label">{label}</span>
      <div className="eko-studio__pills" role="radiogroup" aria-label={label}>
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={value === it.id}
            className={`eko-studio__pill glass${value === it.id ? " eko-studio__pill--active" : ""}`}
            onClick={() => onPick(it.id)}
          >
            {it.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface SwatchItem extends NamedItem {
  hex: string;
}

export function SwatchRow({
  label,
  colors,
  value,
  onPick,
}: {
  label: string;
  colors: readonly SwatchItem[];
  value: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="eko-studio__row glass">
      <span className="eko-studio__label">{label}</span>
      <div className="eko-studio__swatches" role="radiogroup" aria-label={label}>
        {colors.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === c.id.toLowerCase()}
            aria-label={c.name}
            title={c.name}
            className={`eko-studio__swatch${value.toLowerCase() === c.id.toLowerCase() ? " eko-studio__swatch--active" : ""}`}
            style={{ backgroundColor: c.hex }}
            onClick={() => onPick(c.id)}
          />
        ))}
      </div>
    </div>
  );
}
