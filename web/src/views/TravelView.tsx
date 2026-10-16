import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { api, asList, type CityInfo, type GameConfig, type Me } from "../lib/api";
import type { You } from "../game/types";
import { naira } from "../game/types";
import { cityPhotoSrc } from "./CityPicker";
import {
  PLAYABLE_CITIES,
  cityTravelFare,
  findRoad,
  loadNigeriaGeo,
  type NigeriaGeo,
  type TravelMode,
} from "../game/nigeriaGeo";
import "./TravelView.css";

const GlobeMap = lazy(() =>
  import("../game/GlobeMap").then((m) => ({ default: m.GlobeMap }))
);

interface TravelViewProps {
  you: You;
  config: GameConfig | null;
  token: string;
  onClose: () => void;
  /** Called with the fresh server character after a successful trip. */
  onTravelled: (character: Me) => void;
}

function cityName(cities: CityInfo[], id: string): string {
  return cities.find((c) => c.id === id)?.name ?? id;
}

/**
 * Inter-city travel: 3D Earth globe with a seamless dive to Nigeria
 * (real roads, states, rivers) + the approved option-A bottom sheet
 * with full-bleed destination cards.
 */
export function TravelView({ you, config, token, onClose, onTravelled }: TravelViewProps) {
  const currentCityId = you.currentCity || you.homeCity || "lagos";
  const homeCityId = you.homeCity || "lagos";
  const cities = useMemo(() => asList(config?.cities), [config]);
  const dests = useMemo(
    () =>
      (PLAYABLE_CITIES.includes(currentCityId)
        ? PLAYABLE_CITIES.filter((id) => id !== currentCityId)
        : cities.map((c) => c.id).filter((id) => id !== currentCityId)
      )
        .map((id) => cities.find((c) => c.id === id))
        .filter((c): c is CityInfo => Boolean(c)),
    [cities, currentCityId]
  );

  const [geo, setGeo] = useState<NigeriaGeo | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  const [selDest, setSelDest] = useState<string | null>(null);
  const [selMode, setSelMode] = useState<TravelMode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadNigeriaGeo()
      .then((g) => {
        if (alive) setGeo(g);
      })
      .catch(() => {
        if (alive) setGeoFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const selectDest = (id: string) => {
    setSelDest((prev) => (prev === id ? null : id));
    setSelMode(null);
    setError(null);
  };

  const fares = useMemo(() => {
    if (!selDest) return null;
    return {
      bus: cityTravelFare(currentCityId, selDest, "bus"),
      flight: cityTravelFare(currentCityId, selDest, "flight"),
    };
  }, [currentCityId, selDest]);

  const road = geo && selDest ? findRoad(geo.roads, currentCityId, selDest) : null;
  const selCity = selDest ? cities.find((c) => c.id === selDest) : null;
  const fare = selMode && fares ? fares[selMode] : 0;
  const canAfford = you.is_admin || you.money >= fare;

  const confirmTrip = async () => {
    if (!selDest || !selMode || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await api.travelCity(token, selDest, selMode);
      if (res?.ok && res.character) {
        onTravelled(res.character);
        setToast(`Welcome to ${cityName(cities, selDest)} 🎉`);
      } else {
        setError("Trip failed — please try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trip failed — please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="travelview" role="dialog" aria-label="Travel between states">
      <div className="travelview__map">
        {geo && !geoFailed ? (
          <Suspense
            fallback={
              <div className="travelview__loading">Loading 3D globe…</div>
            }
          >
            <GlobeMap
              currentCityId={currentCityId}
              selectedCityId={selDest}
              onSelectCity={(id) => {
                if (dests.some((d) => d.id === id)) selectDest(id);
              }}
              geo={geo}
            />
          </Suspense>
        ) : (
          <div className="travelview__loading">
            {geoFailed ? "3D map unavailable — pick your destination below." : "Loading 3D Nigeria…"}
          </div>
        )}
        <div className="travelview__legend" aria-hidden="true">
          🌲 Rainforest · 🌾 Savanna · 🏜️ Sahel
        </div>
        {road && (
          <div className="travelview__routechip">
            {Math.round(road.km)} km · ~{Math.round(road.hours)} hrs
          </div>
        )}
      </div>

      <button
        type="button"
        className="travelview__close"
        onClick={onClose}
        aria-label="Close travel"
      >
        ✕
      </button>

      <div className="travelview__sheet">
        <div className="travelview__head">
          <span className="travelview__title">🚌 Travel</span>
          <span className="travelview__sub">
            You are in <b>{cityName(cities, currentCityId)}</b> · Home:{" "}
            {cityName(cities, homeCityId)}
          </span>
        </div>

        {dests.map((c) => {
          const selected = selDest === c.id;
          const bus = cityTravelFare(currentCityId, c.id, "bus");
          const flight = cityTravelFare(currentCityId, c.id, "flight");
          const r = geo ? findRoad(geo.roads, currentCityId, c.id) : null;
          return (
            <div
              key={c.id}
              className={`travelview__dest${selected ? " sel" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => selectDest(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") selectDest(c.id);
              }}
            >
              <div
                className="travelview__photo"
                style={{ backgroundImage: `url('${cityPhotoSrc(c.id)}')` }}
              >
                <div className="travelview__nm">{c.name}</div>
                <div className="travelview__tg">{c.tagline}</div>
                <div className="travelview__tick" aria-hidden="true">
                  ✓
                </div>
              </div>
              {selected && (
                <div className="travelview__fares">
                  <button
                    type="button"
                    className={`travelview__fare${selMode === "bus" ? " picked" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelMode("bus");
                      setError(null);
                    }}
                  >
                    <div className="travelview__fare-m">🚌 Bus</div>
                    <div className="travelview__fare-p">{naira(bus)}</div>
                    <div className="travelview__fare-w">
                      ~{r ? Math.round(r.hours) : "–"} hrs · cheap
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`travelview__fare${selMode === "flight" ? " picked" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelMode("flight");
                      setError(null);
                    }}
                  >
                    <div className="travelview__fare-m">✈️ Flight</div>
                    <div className="travelview__fare-p">{naira(flight)}</div>
                    <div className="travelview__fare-w">~1 hr · fast</div>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {error && <div className="travelview__error">{error}</div>}

        {selDest && selMode && selCity && (
          <div className="travelview__confirmbar">
            <div className="travelview__confirmline">
              {selMode === "bus" ? "🚌 Bus" : "✈️ Flight"} to {selCity.name} ·{" "}
              {naira(fare)} · Home stays {cityName(cities, homeCityId)}
            </div>
            <button
              type="button"
              className="travelview__confirmbtn"
              disabled={pending || !canAfford}
              onClick={confirmTrip}
            >
              {pending
                ? "Booking…"
                : !canAfford
                  ? `Need ${naira(fare)}`
                  : "Confirm trip"}
            </button>
          </div>
        )}
      </div>

      {toast && <div className="travelview__toast">{toast}</div>}
    </div>
  );
}
