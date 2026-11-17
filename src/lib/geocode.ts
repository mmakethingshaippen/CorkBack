// Pure geocoder result handling: normalizes Nominatim-shaped rows into place
// matches and decides whether a result list is ambiguous. No network, no
// browser APIs. The URL builder lives in geocodeQuery.ts.

import { haversineMeters } from "./domain";

export interface LatLng {
  lat: number;
  lng: number;
}

export type MatchLevel = "address" | "area";

export interface PlaceMatch {
  /** "{osm_type}{osm_id}" */
  id: string;
  /** Venue or place name, may be "". */
  name: string;
  /** "{house_number} {road}", may be "". */
  addressLine: string;
  /** Neighbourhood, suburb, town or city, may be "". */
  area: string;
  /** For the result list. */
  displayName: string;
  point: LatLng;
  level: MatchLevel;
}

/** Two or more matches farther apart than this make a result list ambiguous. */
export const AMBIGUOUS_METERS = 250;

const MAX_MATCHES = 5;
const DUPLICATE_METERS = 25;

const VENUE_CATEGORIES: ReadonlySet<string> = new Set([
  "amenity",
  "building",
  "shop",
  "tourism",
  "leisure",
  "office",
  "historic",
  "craft",
  "healthcare",
  "man_made",
]);

/** The subset of a Nominatim jsonv2 row this module reads. Every field is untrusted. */
export interface NominatimRow {
  osm_type?: unknown;
  osm_id?: unknown;
  lat?: unknown;
  lon?: unknown;
  name?: unknown;
  display_name?: unknown;
  category?: unknown;
  class?: unknown;
  address?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** Finite number from a number or a non-empty numeric string, else null. */
function coord(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `address` for a house number or a venue-type category, `area` for everything else. */
export function matchLevel(row: NominatimRow): MatchLevel {
  try {
    if (!isRecord(row)) return "area";
    const address = isRecord(row.address) ? row.address : null;
    if (address && str(address.house_number) !== "") return "address";
    const category = str(row.category !== undefined ? row.category : row.class).toLowerCase();
    return VENUE_CATEGORIES.has(category) ? "address" : "area";
  } catch {
    return "area";
  }
}

function toMatch(raw: unknown, index: number): PlaceMatch | null {
  if (!isRecord(raw)) return null;
  const row = raw as NominatimRow;
  const lat = coord(row.lat);
  const lng = coord(row.lon);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const address = isRecord(row.address) ? row.address : {};
  const houseNumber = str(address.house_number);
  const road = str(address.road);
  const addressLine = [houseNumber, road].filter((p) => p !== "").join(" ");
  const area =
    str(address.neighbourhood) ||
    str(address.suburb) ||
    str(address.town) ||
    str(address.city) ||
    str(address.village) ||
    str(address.hamlet);
  const name = str(row.name);
  const displayName = str(row.display_name) || [name, addressLine, area].filter((p) => p !== "").join(", ");
  const osmType = str(row.osm_type);
  const osmId = str(row.osm_id);
  const id = osmType !== "" && osmId !== "" ? `${osmType}${osmId}` : `match${index}`;

  return { id, name, addressLine, area, displayName, point: { lat, lng }, level: matchLevel(row) };
}

/**
 * Never throws. Drops rows with invalid coordinates, removes rows within 25 m
 * of an earlier kept row with the same display name, keeps at most 5.
 */
export function normalizeNominatim(rows: unknown): PlaceMatch[] {
  try {
    if (!Array.isArray(rows)) return [];
    const out: PlaceMatch[] = [];
    for (let i = 0; i < rows.length && out.length < MAX_MATCHES; i++) {
      const m = toMatch(rows[i], i);
      if (!m) continue;
      const duplicate = out.some(
        (kept) => kept.displayName === m.displayName && haversineMeters(kept.point, m.point) <= DUPLICATE_METERS,
      );
      if (!duplicate) out.push(m);
    }
    return out;
  } catch {
    return [];
  }
}

/** True when some pair of matches lies more than 250 m apart. Order does not matter. */
export function isAmbiguous(matches: readonly PlaceMatch[]): boolean {
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      if (haversineMeters(matches[i].point, matches[j].point) > AMBIGUOUS_METERS) return true;
    }
  }
  return false;
}
