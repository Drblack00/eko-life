import type { CityInfo } from "../lib/api";

/**
 * CityPicker — Home City V1 city picker for character creation.
 *
 * Approved design: ~/workspace/eko-life-mockups/city-picker-a1-fullbleed.html
 * (reproduce exactly — full-bleed landmark photo cards, dark gradient scrim,
 * white overlaid text, amber ring + filled check on selection).
 *
 * All city content (name, tagline, state, starting cash) comes from the
 * server via GameConfig.cities — nothing is hardcoded here except the
 * landmark photo filename per city id (web/public/cities/).
 */

/** Landmark photo per city id — files live in web/public/cities/. */
const CITY_PHOTOS: Record<string, string> = {
  lagos: "lagos",
  benin: "benin",
  ph: "ph",
  abuja: "abuja",
};

export function cityPhotoSrc(cityId: string): string {
  const file = CITY_PHOTOS[cityId] ?? cityId;
  return `/cities/${file}.jpg`;
}

function formatCash(n: number | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return `₦${v.toLocaleString("en-NG")} starting cash`;
}

/**
 * Economy flavor line derived from the server's pay/cost multipliers
 * (data-driven, not hardcoded): e.g. lagos → "higher pay, higher costs".
 */
export function cityEconomyFlavor(c: CityInfo): string {
  const pay = typeof c.pay_mult === "number" ? c.pay_mult : 1;
  const cost = typeof c.cost_mult === "number" ? c.cost_mult : 1;
  const payTxt =
    pay >= 1.2 ? "top pay" : pay > 1 ? "higher pay" : pay < 1 ? "lower pay" : "steady pay";
  const costTxt =
    cost >= 1.15
      ? "higher costs"
      : cost > 1
        ? "high costs"
        : cost < 1
          ? "lower costs"
          : "steady costs";
  return `${payTxt}, ${costTxt}`;
}

export function CityPicker({
  cities,
  selectedId,
  onSelect,
}: {
  cities: CityInfo[];
  /** Null = nothing selected yet (page 2 starts unselected). */
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="citypick" role="radiogroup" aria-label="Home city">
      {cities.map((c) => {
        const sel = c.id === selectedId;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={sel}
            aria-label={`${c.name} — ${c.tagline}`}
            className={`citypick-card${sel ? " citypick-card--sel" : ""}`}
            onClick={() => onSelect(c.id)}
          >
            <img
              className="citypick-card__bg"
              src={cityPhotoSrc(c.id)}
              alt={`${c.name} landmark`}
              loading="lazy"
            />
            <span className="citypick-card__scrim" aria-hidden="true" />
            <span className="citypick-card__txt">
              <span className="citypick-card__nm">{c.name}</span>
              <span className="citypick-card__tag">{c.tagline}</span>
              <span className="citypick-card__meta">
                {c.state} · {cityEconomyFlavor(c)}
              </span>
              <span className="citypick-card__cash">
                {formatCash(c.starting_cash)}
              </span>
            </span>
            <span className="citypick-card__tick" aria-hidden="true">
              ✓
            </span>
          </button>
        );
      })}
    </div>
  );
}
