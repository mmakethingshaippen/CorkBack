/**
 * Test-only fixtures for the board usability work (Requirement 20.5, 20.6).
 *
 * Only `*.test.ts` files may import this module (enforced by
 * src/lib/fixtureGuard.test.ts). Never insert these into Supabase and never
 * add them to src/lib/seed.ts. Every id starts with `fx-`.
 */
import fc from "fast-check";
import { CATEGORIES } from "../categories";
import { distanceMiles, type AlertRule } from "../alerts";
import type { Posting } from "../types";

export const FIXTURE_ID_PREFIX = "fx-";

export interface LatLng {
  lat: number;
  lng: number;
}

export const BERKELEY: LatLng = { lat: 37.8715, lng: -122.273 };
export const RICHMOND: LatLng = { lat: 37.9358, lng: -122.3477 };
/** A high-latitude reference where longitude degrees are short. */
export const HIGH_LATITUDE: LatLng = { lat: 60, lng: 10.75 };

export const RADIUS_OPTIONS_MILES = [1, 3, 5, 10, 25] as const;

/** Listing categories (non-community) and the Community notices category. */
export const LISTING_CATEGORY_SLUGS: string[] = CATEGORIES.filter((c) => c.slug !== "community").map(
  (c) => c.slug,
);
export const COMMUNITY_SLUG = "community";

const NOW_ISO = "2030-01-01T00:00:00.000Z";
const FAR_FUTURE_ISO = "2030-02-01T00:00:00.000Z";

/** Build one fixture posting. The id is forced to start with `fx-`. */
export function makeFixturePosting(id: string, overrides: Partial<Posting> = {}): Posting {
  const fxId = id.startsWith(FIXTURE_ID_PREFIX) ? id : `${FIXTURE_ID_PREFIX}${id}`;
  return {
    title: `Fixture ${fxId}`,
    body: "Fixture posting for tests only.",
    categorySlug: "music",
    flyerUrl: null,
    rsvpUrl: null,
    eventDate: null,
    eventTime: null,
    endDate: null,
    endTime: null,
    timeZone: "America/Los_Angeles",
    placeLabel: "Fixture place",
    lat: BERKELEY.lat,
    lng: BERKELEY.lng,
    expiry: "1m",
    expiresAt: FAR_FUTURE_ISO,
    isPromoted: false,
    authorUsername: "fx_author",
    authorAvatarPath: null,
    likeCount: 0,
    goingCount: 0,
    interestedCount: 0,
    createdAt: NOW_ISO,
    ...overrides,
    id: fxId,
  };
}

// ---------------------------------------------------------------------------
// Fixed fixtures
// ---------------------------------------------------------------------------

export const BERKELEY_POSTINGS: Posting[] = [
  makeFixturePosting("berkeley-music", { categorySlug: "music", lat: 37.8719, lng: -122.2585, placeLabel: "Berkeley" }),
  makeFixturePosting("berkeley-housing", { categorySlug: "housing", lat: 37.8688, lng: -122.2678, placeLabel: "Berkeley" }),
  makeFixturePosting("berkeley-notice", { categorySlug: COMMUNITY_SLUG, lat: 37.8765, lng: -122.2691, placeLabel: "Berkeley" }),
];

export const RICHMOND_POSTINGS: Posting[] = [
  makeFixturePosting("richmond-jobs", { categorySlug: "jobs", lat: 37.9358, lng: -122.3477, placeLabel: "Richmond" }),
  makeFixturePosting("richmond-sale", { categorySlug: "sale", lat: 37.9301, lng: -122.3412, placeLabel: "Richmond" }),
  makeFixturePosting("richmond-notice", { categorySlug: COMMUNITY_SLUG, lat: 37.9402, lng: -122.3551, placeLabel: "Richmond" }),
];

/** One listing posting per listing category, around Berkeley. */
export const LISTING_CATEGORY_POSTINGS: Posting[] = LISTING_CATEGORY_SLUGS.map((slug, i) =>
  makeFixturePosting(`listing-${slug}`, {
    categorySlug: slug,
    lat: BERKELEY.lat + i * 0.001,
    lng: BERKELEY.lng + i * 0.001,
  }),
);

/** Community notices around Berkeley. */
export const COMMUNITY_NOTICES: Posting[] = Array.from({ length: 4 }, (_, i) =>
  makeFixturePosting(`community-${i + 1}`, {
    categorySlug: COMMUNITY_SLUG,
    lat: BERKELEY.lat + i * 0.002,
    lng: BERKELEY.lng - i * 0.002,
    createdAt: new Date(Date.parse(NOW_ISO) + i * 60_000).toISOString(),
  }),
);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Deterministic set of `count` postings spread over a grid around `center`.
 * Categories rotate through every category, newest last.
 */
export function generatePostings(
  count: number,
  center: LatLng = BERKELEY,
  idPrefix = "gen",
): Posting[] {
  const side = Math.max(1, Math.ceil(Math.sqrt(count)));
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / side) - side / 2;
    const col = (i % side) - side / 2;
    return makeFixturePosting(`${idPrefix}-${String(i).padStart(5, "0")}`, {
      categorySlug: CATEGORIES[i % CATEGORIES.length].slug,
      lat: center.lat + row * 0.002,
      lng: center.lng + col * 0.002,
      isPromoted: i % 25 === 0,
      createdAt: new Date(Date.parse(NOW_ISO) + i * 1000).toISOString(),
    });
  });
}

/** Many-posting sets used for cap and truncation tests. */
export const MANY_POSTINGS_150 = generatePostings(150, BERKELEY, "many150");
export const MANY_POSTINGS_400 = generatePostings(400, BERKELEY, "many400");

// ---------------------------------------------------------------------------
// Radius-edge placement
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_MILE = 1609.344;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** 8 compass directions as bearings in degrees, including diagonals. */
export const COMPASS_BEARINGS = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
} as const;
export type CompassDirection = keyof typeof COMPASS_BEARINGS;
export const COMPASS_DIRECTIONS = Object.keys(COMPASS_BEARINGS) as CompassDirection[];

/** Spherical offset used only to choose a candidate point; distance is never computed here. */
function offsetPoint(start: LatLng, meters: number, bearingDeg: number): LatLng {
  const ang = meters / EARTH_RADIUS_M;
  const b = toRad(bearingDeg);
  const lat1 = toRad(start.lat);
  const lng1 = toRad(start.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(b));
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(b) * Math.sin(ang) * Math.cos(lat1), Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

/** The app's distance in miles (haversine via alerts.distanceMiles) from a center to a point. */
export function appDistanceMiles(center: LatLng, point: LatLng): number {
  const rule: AlertRule = {
    id: "fx-distance-probe",
    ownerId: "fx-owner",
    categorySlug: "music",
    centerLat: center.lat,
    centerLng: center.lng,
    radiusMiles: null,
  };
  return distanceMiles(rule, point);
}

/**
 * Point along `bearingDeg` whose app distance from `center` is as close as
 * possible to `miles` without going over it (distance <= miles, within ~1e-9 mi).
 * Found by bisection against the app's own distance function.
 */
export function pointAtMiles(center: LatLng, miles: number, bearingDeg: number): LatLng {
  let lo = 0;
  let hi = miles * METERS_PER_MILE * 2 + 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (appDistanceMiles(center, offsetPoint(center, mid, bearingDeg)) <= miles) lo = mid;
    else hi = mid;
  }
  return offsetPoint(center, lo, bearingDeg);
}

export type EdgeKind = "inside" | "at" | "outside";
export const EDGE_DELTA_MILES = 0.01;

export interface EdgePlacement {
  center: LatLng;
  radiusMiles: number;
  direction: CompassDirection;
  kind: EdgeKind;
  point: LatLng;
  /** App distance in miles from center to point. */
  distanceMiles: number;
  /** True when the point should match a radius alert (distance <= radius). */
  expectedWithin: boolean;
}

export function placeAtEdge(
  center: LatLng,
  radiusMiles: number,
  direction: CompassDirection,
  kind: EdgeKind,
): EdgePlacement {
  const bearing = COMPASS_BEARINGS[direction];
  let point: LatLng;
  if (kind === "inside") {
    point = pointAtMiles(center, radiusMiles - EDGE_DELTA_MILES, bearing);
  } else if (kind === "at") {
    point = pointAtMiles(center, radiusMiles, bearing);
  } else {
    // Smallest step past the radius: take the "at" point's meters and push out by delta.
    point = pointAtMiles(center, radiusMiles + EDGE_DELTA_MILES, bearing);
  }
  const d = appDistanceMiles(center, point);
  return { center, radiusMiles, direction, kind, point, distanceMiles: d, expectedWithin: kind !== "outside" };
}

/** All radius x direction x kind placements for one reference point. */
export function allEdgePlacements(center: LatLng): EdgePlacement[] {
  const out: EdgePlacement[] = [];
  for (const r of RADIUS_OPTIONS_MILES)
    for (const dir of COMPASS_DIRECTIONS)
      for (const kind of ["inside", "at", "outside"] as const) out.push(placeAtEdge(center, r, dir, kind));
  return out;
}

/** Turn an edge placement into a fixture posting. */
export function edgePlacementPosting(p: EdgePlacement, categorySlug = "music"): Posting {
  return makeFixturePosting(
    `edge-${p.center.lat.toFixed(2)}-${p.radiusMiles}mi-${p.direction}-${p.kind}`,
    { categorySlug, lat: p.point.lat, lng: p.point.lng },
  );
}

/** Fixed edge fixtures around Berkeley and around 60 N. */
export const EDGE_PLACEMENTS_BERKELEY = allEdgePlacements(BERKELEY);
export const EDGE_PLACEMENTS_HIGH_LATITUDE = allEdgePlacements(HIGH_LATITUDE);
export const EDGE_POSTINGS_BERKELEY = EDGE_PLACEMENTS_BERKELEY.map((p) => edgePlacementPosting(p));
export const EDGE_POSTINGS_HIGH_LATITUDE = EDGE_PLACEMENTS_HIGH_LATITUDE.map((p) => edgePlacementPosting(p));

/** fast-check arbitrary: reference points from -70..70 latitude (includes high latitudes). */
export const referencePointArb: fc.Arbitrary<LatLng> = fc.oneof(
  fc.constantFrom(BERKELEY, RICHMOND, HIGH_LATITUDE),
  fc.record({
    lat: fc.double({ min: -70, max: 70, noNaN: true, noDefaultInfinity: true }),
    lng: fc.double({ min: -170, max: 170, noNaN: true, noDefaultInfinity: true }),
  }),
);

/** fast-check arbitrary: a posting at the inside / exact / outside edge of any radius option, any direction. */
export const edgePlacementArb: fc.Arbitrary<EdgePlacement> = fc
  .tuple(
    referencePointArb,
    fc.constantFrom(...RADIUS_OPTIONS_MILES),
    fc.constantFrom(...COMPASS_DIRECTIONS),
    fc.constantFrom<EdgeKind>("inside", "at", "outside"),
  )
  .map(([center, radius, dir, kind]) => placeAtEdge(center, radius, dir, kind));

export const edgePostingArb: fc.Arbitrary<Posting> = edgePlacementArb.map((p) => edgePlacementPosting(p));
