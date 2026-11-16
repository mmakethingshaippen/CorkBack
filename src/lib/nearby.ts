/**
 * Pure helpers for the board: category filtering now, nearby/radius views and
 * labels in later stages. No server-only imports; client components use this.
 */
import { haversineMeters } from "@/lib/domain";
import { MAP_CAPS } from "@/lib/mapBounds";
import type { Posting } from "@/lib/types";

/**
 * Keep only postings in the given category. A null slug means "all" and
 * returns the input array unchanged. The input is never mutated.
 */
export function filterByCategory(postings: Posting[], slug: string | null): Posting[] {
  if (slug === null) return postings;
  return postings.filter((p) => p.categorySlug === slug);
}

export const RADIUS_OPTIONS_MILES = [1, 3, 5, 10, 25] as const;
export const DEFAULT_RADIUS_MILES = 10;
export const METERS_PER_MILE = 1609.344;

export type ReferenceKind = "town" | "device" | "home" | "saved" | "default";
export interface BoardReference {
  lat: number;
  lng: number;
  kind: ReferenceKind;
  name: string | null;
}

export interface NearbyItem {
  posting: Posting;
  /** Rounded, display-safe label such as "About 2.5 mi away". */
  distanceLabel: string;
}
export interface BoardView {
  nearby: NearbyItem[];
  radiusMiles: number;
  referenceLabel: string;
  truncated: boolean;
}

type LatLng = { lat: number; lng: number };

/** The reference a place search produces. The only way a search sets the centre. */
export function referenceAfterSearch(result: { lat: number; lng: number; name: string }): BoardReference {
  return { lat: result.lat, lng: result.lng, kind: "town", name: result.name };
}

/** Returns the radius if it is exactly one of the options, otherwise the default. */
export function parseRadius(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
  return (RADIUS_OPTIONS_MILES as readonly number[]).includes(n) ? n : DEFAULT_RADIUS_MILES;
}

/** True great-circle distance in miles (uses the app's haversine). */
export function milesBetween(a: LatLng, b: LatLng): number {
  return haversineMeters(a, b) / METERS_PER_MILE;
}

/**
 * Coarse distance for display. 0 means "under 0.5 mi". Midpoints round up;
 * the 1e-9 guards against float error just below a midpoint.
 */
export function roundApproxMiles(miles: number): number {
  if (!(miles >= 0.5)) return 0;
  if (miles < 10) return Math.round(miles * 2 + 1e-9) / 2;
  return Math.round(miles + 1e-9);
}

export function formatApproxDistance(miles: number): string {
  const r = roundApproxMiles(miles);
  if (r === 0) return "Under 0.5 mi away";
  return `About ${Number.isInteger(r) ? r : r.toFixed(1)} mi away`;
}

export function referenceLabel(ref: BoardReference): string {
  const name = ref.name?.trim() || null;
  switch (ref.kind) {
    case "device":
      return "your location";
    case "home":
      return name ?? "your alert home";
    case "saved":
      return "your saved map area";
    case "town":
      return name ?? "your saved map area";
    default:
      return "Berkeley";
  }
}

/** "Within 10 mi of Berkeley" */
export function radiusPhrase(radiusMiles: number, ref: BoardReference): string {
  return `Within ${radiusMiles} mi of ${referenceLabel(ref)}`;
}

/** "3 postings \u00b7 Within 10 mi of Berkeley" ("1 posting" when n is 1). */
export function postingCountHeading(count: number, radiusMiles: number, ref: BoardReference): string {
  return `${count} ${count === 1 ? "posting" : "postings"} \u00b7 ${radiusPhrase(radiusMiles, ref)}`;
}

/** The next larger radius option (1 to 3, 3 to 5, 5 to 10, 10 to 25), or null at the largest. */
export function nextLargerRadius(radiusMiles: number): number | null {
  const next = RADIUS_OPTIONS_MILES.find((m) => m > radiusMiles);
  return next ?? null;
}

/**
 * Nearby view: category AND true distance <= radius. Promoted first, then
 * ascending true distance, then ascending id. Does not mutate the input.
 */
export function buildBoardView(
  postings: Posting[],
  opts: { category: string | null; reference: BoardReference; radiusMiles: number; truncated?: boolean },
): BoardView {
  const { category, reference, radiusMiles } = opts;
  const rows: { posting: Posting; miles: number }[] = [];
  for (const posting of filterByCategory(postings, category)) {
    const miles = milesBetween(reference, posting);
    if (miles <= radiusMiles) rows.push({ posting, miles });
  }
  rows.sort((a, b) => {
    const pa = a.posting.isPromoted ? 0 : 1;
    const pb = b.posting.isPromoted ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.miles !== b.miles) return a.miles - b.miles;
    return a.posting.id < b.posting.id ? -1 : a.posting.id > b.posting.id ? 1 : 0;
  });
  return {
    nearby: rows.map((r) => ({ posting: r.posting, distanceLabel: formatApproxDistance(r.miles) })),
    radiusMiles,
    referenceLabel: referenceLabel(reference),
    truncated: opts.truncated ?? false,
  };
}
/**
 * World map caption. Says "in view" so it never claims a worldwide total.
 * When the server cap was hit, the caption is fixed text with no category or count.
 */
export function worldCaption(categoryLabel: string | null, count: number, truncated: boolean): string {
  if (truncated) {
    return `Showing ${MAP_CAPS.pins} of many postings in this view. Zoom in to see more.`;
  }
  const label = categoryLabel ?? "All categories";
  return `Explore the world \u00b7 ${label} \u00b7 ${count} ${count === 1 ? "posting" : "postings"} in view`;
}

/** Empty-state text for the world map: "No Sports postings in this view." */
export function worldEmptyText(categoryLabel: string | null): string {
  return `No ${categoryLabel ?? "matching"} postings in this view.`;
}
