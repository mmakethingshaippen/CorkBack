// Pure map-bounds helpers shared by the route, the hooks, the pages and tests.
// No server-only imports: client and server both use this module.

export const MAP_CAPS = { pins: 300, cards: 100 } as const;
export const SNAP_DEGREES = 0.1;

export interface LatLng {
  lat: number;
  lng: number;
}
export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}
export interface MapPin {
  id: string;
  title: string;
  lat: number;
  lng: number;
  categorySlug: string;
}
export interface MapQueryResult<T> {
  items: T[];
  truncated: boolean;
  cap: number;
}

// Same Earth radius as haversineMeters in domain.ts, same mile as the app.
const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_MILE = 1609.344;
/** Float-error margin added to every side of a radius box (about 1 cm). */
const MARGIN_DEG = 1e-7;
/** A value this close to a grid line counts as being on it. */
const GRID_EPSILON = 1e-9;

const toDeg = (r: number) => (r * 180) / Math.PI;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** "w,s,e,n" -> Bounds, or null when malformed, inverted, out of range or wrapped. */
export function parseBounds(raw: string | null): Bounds | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!NUMBER_RE.test(t)) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  const [west, south, east, north] = nums;
  if (south < -90 || north > 90 || south > 90 || north < -90) return null;
  if (west < -180 || west > 180 || east < -180 || east > 180) return null;
  if (south >= north) return null;
  // west >= east would be an inverted or antimeridian-wrapping box.
  if (west >= east) return null;
  return { west, south, east, north };
}

/** Round away binary noise so snapped values print and compare as clean grid numbers. */
function cleanGrid(k: number, step: number): number {
  return Math.round(k * step * 1e10) / 1e10;
}

function snapDown(x: number, step: number): number {
  const q = x / step;
  const r = Math.round(q);
  const k = Math.abs(x - r * step) < GRID_EPSILON ? r : Math.floor(q);
  return cleanGrid(k, step);
}

function snapUp(x: number, step: number): number {
  const q = x / step;
  const r = Math.round(q);
  const k = Math.abs(x - r * step) < GRID_EPSILON ? r : Math.ceil(q);
  return cleanGrid(k, step);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Expands each edge outward to the grid (south/west floor, north/east ceil),
 * clamped to the valid range. Never shrinks (beyond the 1e-9 grid epsilon)
 * and is idempotent.
 */
export function snapBoundsOutward(b: Bounds, step: number = SNAP_DEGREES): Bounds {
  return {
    west: clamp(snapDown(b.west, step), -180, 180),
    south: clamp(snapDown(b.south, step), -90, 90),
    east: clamp(snapUp(b.east, step), -180, 180),
    north: clamp(snapUp(b.north, step), -90, 90),
  };
}

/**
 * Box that contains every point within `radiusMiles` (great-circle, same
 * sphere as haversineMeters) of `centre`.
 *
 * Latitude half-width is d/R. The widest longitude extent of the circle is at
 * the tangent latitude, not at the centre: dLng = asin(sin(d/R) / cos(lat0)).
 * If the circle reaches a pole, or the box would cross +-180, the longitude
 * range becomes the full [-180, 180] (never a wrapped box).
 */
export function boundsForRadius(centre: LatLng, radiusMiles: number): Bounds {
  const delta = (radiusMiles * METERS_PER_MILE) / EARTH_RADIUS_M; // radians
  const dLat = toDeg(delta) + MARGIN_DEG;
  const south = Math.max(-90, centre.lat - dLat);
  const north = Math.min(90, centre.lat + dLat);

  const latRad = (Math.abs(centre.lat) * Math.PI) / 180;
  const reachesPole = Math.abs(centre.lat) + toDeg(delta) + MARGIN_DEG >= 90;
  if (reachesPole || Math.sin(delta) >= Math.cos(latRad)) {
    return { west: -180, south, east: 180, north };
  }
  const dLng = toDeg(Math.asin(Math.sin(delta) / Math.cos(latRad))) + MARGIN_DEG;
  const west = centre.lng - dLng;
  const east = centre.lng + dLng;
  if (west < -180 || east > 180) {
    return { west: -180, south, east: 180, north };
  }
  return { west, south, east, north };
}

/** Inclusive on all four edges. */
export function pointInBounds(p: LatLng, b: Bounds): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}

/** Number of items whose position lies inside `view` (inclusive). Null view counts nothing. */
export function countInView(items: LatLng[], view: Bounds | null): number {
  if (!view) return 0;
  let n = 0;
  for (const p of items) if (pointInBounds(p, view)) n++;
  return n;
}

function createdMs(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Pure model of the server query: category filter, inclusive bounds filter,
 * order promoted first, then newest, then id descending, then cap.
 * `truncated` is true only when more rows match than the cap allows.
 */
export function selectForBounds<
  T extends { id: string; lat: number; lng: number; categorySlug: string; isPromoted?: boolean; createdAt: string },
>(all: T[], q: { bounds: Bounds; category: string | null; cap: number }): MapQueryResult<T> {
  const matches = all.filter(
    (p) => (q.category === null || p.categorySlug === q.category) && pointInBounds(p, q.bounds),
  );
  matches.sort((a, b) => {
    const pa = a.isPromoted ? 1 : 0;
    const pb = b.isPromoted ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ta = createdMs(a.createdAt);
    const tb = createdMs(b.createdAt);
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  const cap = Math.max(0, q.cap);
  return { items: matches.slice(0, cap), truncated: matches.length > cap, cap };
}
