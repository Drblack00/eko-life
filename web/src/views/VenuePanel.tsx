import { useEffect, useMemo, useState } from "react";
import { Button, Sheet } from "../components";
import { asList, type ApiLocation, type GameConfig, type VenueActivity } from "../lib/api";
import {
  activitiesForLocation,
  activityCostLabel,
  venueShareLink,
  venueTeaser,
} from "../game/venues";
import { naira, type ActName, type You } from "../game/types";

/**
 * Phase 5 — venue extras rendered inside the map pin sheet:
 * players-here row (real /api/venues/presence count, omitted when
 * unavailable), share-link row, and the activities section.
 */
export function VenueExtras({
  locationId,
  you,
  config,
  sendAct,
}: {
  locationId: string;
  you: You;
  config: GameConfig;
  sendAct: (a: ActName, params?: Record<string, unknown>) => void;
}) {
  const loc = useMemo(
    () => asList(config.locations).find((l) => l.id === locationId) ?? null,
    [config, locationId]
  );
  const activities = useMemo(
    () => activitiesForLocation(config.venueActivities, loc),
    [config, loc]
  );
  const here = you.locationId === locationId;

  // ---- players here (real count; omitted when the endpoint fails) ----
  const [playersHere, setPlayersHere] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setPlayersHere(null);
    fetch("/api/venues/presence")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j || typeof j.presence !== "object") return;
        const n = Number((j.presence as Record<string, number>)[locationId]);
        setPlayersHere(Number.isFinite(n) && n > 0 ? n : 0);
      })
      .catch(() => {
        /* omit the row — never fake a number */
      });
    return () => {
      alive = false;
    };
  }, [locationId]);

  // ---- share link (copy + native share, Friends.tsx pattern) ----
  const [copied, setCopied] = useState(false);
  const shareVenue = async () => {
    const link = venueShareLink(locationId);
    const data = {
      title: "Èkó Life",
      text: `Meet me at ${loc?.name ?? "this spot"} on Èkó Life — it's free.`,
      url: link,
    };
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(data);
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* last resort: the link stays visible for manual copy */
      }
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (!loc) return null;

  return (
    <div className="eko-venue">
      <div className="eko-venue__rows">
        {playersHere !== null && (
          <div
            className="eko-venue__row"
            aria-label={`${playersHere} player${playersHere === 1 ? "" : "s"} here now`}
          >
            <span aria-hidden="true">🟢</span>
            <span>
              {playersHere === 0
                ? "Nobody here right now"
                : `${playersHere} here now`}
            </span>
          </div>
        )}
        <button
          type="button"
          className="eko-venue__row eko-venue__share"
          onClick={shareVenue}
        >
          <span aria-hidden="true">🔗</span>
          <span>{copied ? "Link copied ✓" : "Share this place"}</span>
        </button>
      </div>

      {activities.length > 0 && (
        <section aria-label="Things to do here">
          <h3 className="eko-venue__title">Things to do</h3>
          <ul className="eko-venue__acts">
            {activities.map((a) => {
              const afford = you.is_admin || you.money >= a.cost;
              const disabled = !here || !afford;
              return (
                <li key={a.id}>
                  <Button
                    size="lg"
                    variant="accent"
                    className="eko-venue__act"
                    disabled={disabled}
                    onClick={() =>
                      sendAct("venue_activity", {
                        locationId,
                        activityId: a.id,
                      })
                    }
                    aria-label={
                      !here
                        ? `${a.name} — travel here first`
                        : !afford
                          ? `${a.name} — costs ${naira(a.cost)}`
                          : `${a.name} — ${activityCostLabel(a.cost)}`
                    }
                  >
                    <span className="eko-venue__act-main">
                      <span className="eko-venue__act-name">
                        {a.icon} {a.name}
                      </span>
                      <span className="eko-venue__act-blurb">{a.blurb}</span>
                    </span>
                    <span className="eko-venue__act-cost">
                      {!here
                        ? "travel first"
                        : !afford
                          ? `need ${naira(a.cost)}`
                          : activityCostLabel(a.cost)}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Phase 5 — "Things to do" (T): every venue with its first-activity
 * teaser. Tapping a venue opens that venue's pin sheet dialog.
 */
export function ThingsToDoDialog({
  open,
  onClose,
  config,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  config: GameConfig | null;
  onSelect: (loc: ApiLocation) => void;
}) {
  const rows = useMemo(() => {
    const list = asList(config?.locations);
    return list.map((l) => ({
      loc: l,
      teaser: venueTeaser(config?.venueActivities, l),
    }));
  }, [config]);

  return (
    <Sheet open={open} onClose={onClose} label="Things to do">
      <div className="eko-things">
        <p className="eko-things__sub">
          Every spot in the city has something going on. Tap one to see.
        </p>
        <ul className="eko-things__list">
          {rows.map(({ loc, teaser }) => (
            <li key={loc.id}>
              <button
                type="button"
                className="eko-things__row"
                onClick={() => onSelect(loc)}
              >
                <span className="eko-things__emoji" aria-hidden="true">
                  {loc.icon ?? loc.emoji ?? "📍"}
                </span>
                <span className="eko-things__text">
                  <span className="eko-things__name">{loc.name}</span>
                  {teaser && (
                    <span className="eko-things__teaser">{teaser}</span>
                  )}
                </span>
                <span className="eko-things__go" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

export type { VenueActivity };
