import type { ApiLocation, VenueActivity } from "../lib/api";

/**
 * Phase 5 — venue activities ("things to do"). Pure helpers (unit-tested).
 * The server owns the activity catalog; these only filter/shape it.
 */

/** Activities offered at a location: tag match, deduped by id (first tag wins). */
export function activitiesForLocation(
  activities: VenueActivity[] | undefined,
  loc: ApiLocation | null | undefined
): VenueActivity[] {
  if (!activities || !loc) return [];
  const wanted = new Set(loc.tags ?? []);
  const seen = new Set<string>();
  const out: VenueActivity[] = [];
  for (const a of activities) {
    if (seen.has(a.id)) continue;
    if (!a.tags.some((t) => wanted.has(t))) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** One-line teaser for a location: its first activity's teaser, or null. */
export function venueTeaser(
  activities: VenueActivity[] | undefined,
  loc: ApiLocation | null | undefined
): string | null {
  const first = activitiesForLocation(activities, loc)[0];
  return first ? first.teaser : null;
}

/** Shareable deep link to a venue: same origin + #venue=<locationId>. */
export function venueShareLink(locationId: string): string {
  return `${window.location.origin}${window.location.pathname}#venue=${encodeURIComponent(locationId)}`;
}

/** Parse a #venue=<locationId> hash; returns the location id or null. */
export function parseVenueHash(hash: string): string | null {
  const m = /^#venue=(.+)$/.exec(hash);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Human label for an activity's cost. */
export function activityCostLabel(cost: number): string {
  return cost > 0 ? `₦${cost.toLocaleString("en-NG")}` : "Free";
}
