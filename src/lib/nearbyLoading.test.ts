/**
 * Property 34: Nearby loading never loses a point inside the radius.
 * Property 36: Map request carries only snapped bounds.
 *
 * Feature: board-usability-improvements
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { buildMapRequest } from "./mapRequestModel";
import {
  MAP_CAPS,
  boundsForRadius,
  parseBounds,
  selectForBounds,
  snapBoundsOutward,
  type Bounds,
} from "./mapBounds";
import { buildBoardView, formatApproxDistance, milesBetween, type BoardReference } from "./nearby";
import {
  BERKELEY,
  COMPASS_DIRECTIONS,
  RADIUS_OPTIONS_MILES,
  RICHMOND_POSTINGS,
  edgePlacementPosting,
  makeFixturePosting,
  placeAtEdge,
  type CompassDirection,
  type EdgeKind,
  type LatLng,
} from "./__fixtures__/board";
import type { Posting } from "./types";

/** Runs the whole pipeline the page runs: request -> route parse -> snap -> select. */
function loadBox(
  reference: LatLng,
  radius: number,
  category: string | null,
  all: Posting[],
  cap: number,
) {
  const req = buildMapRequest({
    bounds: boundsForRadius(reference, radius),
    category,
    mode: "pins",
  });
  const params = new URL(req.url, "http://localhost").searchParams;
  const parsed = parseBounds(params.get("bounds"));
  expect(parsed).not.toBeNull();
  const snapped = snapBoundsOutward(parsed as Bounds);
  return { req, result: selectForBounds(all, { bounds: snapped, category, cap }) };
}

const ref = (c: LatLng): BoardReference => ({ lat: c.lat, lng: c.lng, kind: "town", name: "Test" });

const centreArb: fc.Arbitrary<LatLng> = fc.oneof(
  fc.constantFrom<LatLng>(BERKELEY, { lat: 60, lng: 10.75 }, { lat: -60, lng: 170 }, { lat: 85, lng: 0 }),
  fc.record({
    lat: fc.double({ min: -85, max: 85, noNaN: true, noDefaultInfinity: true }),
    lng: fc.double({ min: -179.9, max: 179.9, noNaN: true, noDefaultInfinity: true }),
  }),
);

describe("Property 34: Nearby loading never loses a point inside the radius", () => {
  // **Validates: Requirements 6.3, 6.4**
  it("keeps every posting within the radius through request, snap, select and the browser filter", () => {
    fc.assert(
      fc.property(
        centreArb,
        fc.constantFrom(...RADIUS_OPTIONS_MILES),
        fc.uniqueArray(
          fc.tuple(
            fc.constantFrom<CompassDirection>(...COMPASS_DIRECTIONS),
            fc.constantFrom<EdgeKind>("inside", "at", "outside"),
          ),
          { minLength: 1, maxLength: 24, selector: ([d, k]) => `${d}-${k}` },
        ),
        fc.constantFrom<string | null>(null, "music", "housing"),
        (centre, radius, edges, category) => {
          const placements = edges.map(([d, k]) => placeAtEdge(centre, radius, d, k));
          const all = placements.map((p, i) =>
            edgePlacementPosting(p, i % 2 === 0 ? "music" : "housing"),
          );
          // Same placement keys are unique, so ids are unique.
          const { result } = loadBox(centre, radius, category, all, MAP_CAPS.pins);
          expect(result.truncated).toBe(false);

          const rows = result.items;
          const ids = new Set(rows.map((r) => r.id));
          const view = buildBoardView(rows, {
            category,
            reference: ref(centre),
            radiusMiles: radius,
            truncated: result.truncated,
          });
          const nearbyIds = new Set(view.nearby.map((n) => n.posting.id));

          for (const p of all) {
            if (category !== null && p.categorySlug !== category) continue;
            const miles = milesBetween(centre, p);
            if (miles <= radius) {
              // Not lost by the coarse box or by toFixed(1) formatting.
              expect(ids.has(p.id)).toBe(true);
              expect(nearbyIds.has(p.id)).toBe(true);
            } else {
              expect(nearbyIds.has(p.id)).toBe(false);
            }
          }
          // Postings the fixture marks inside / at the radius are in by the app distance as well.
          placements.forEach((pl, i) => {
            if (pl.expectedWithin && (category === null || all[i].categorySlug === category)) {
              expect(ids.has(all[i].id)).toBe(true);
            }
          });

          // Req 6.4: not truncated => same as the view over all postings.
          const full = buildBoardView(all, {
            category,
            reference: ref(centre),
            radiusMiles: radius,
          });
          expect(view.nearby).toEqual(full.nearby);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("when the cap truncates, anything not truncated still equals the full view", () => {
    fc.assert(
      fc.property(
        centreArb,
        fc.constantFrom(...RADIUS_OPTIONS_MILES),
        fc.integer({ min: 1, max: 30 }),
        (centre, radius, cap) => {
          const all = COMPASS_DIRECTIONS.flatMap((d) =>
            (["inside", "at", "outside"] as const).map((k) =>
              edgePlacementPosting(placeAtEdge(centre, radius, d, k)),
            ),
          );
          const { result } = loadBox(centre, radius, null, all, cap);
          if (!result.truncated) {
            const a = buildBoardView(result.items, { category: null, reference: ref(centre), radiusMiles: radius });
            const b = buildBoardView(all, { category: null, reference: ref(centre), radiusMiles: radius });
            expect(a.nearby).toEqual(b.nearby);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("example: Berkeley, 10 mi includes Richmond with its label and an exactly-10-mi NE posting", () => {
    const ne = edgePlacementPosting(placeAtEdge(BERKELEY, 10, "NE", "at"));
    const richmond = RICHMOND_POSTINGS[0];
    const all = [richmond, ne, makeFixturePosting("far", { lat: 38.5, lng: -122.0 })];
    const { result } = loadBox(BERKELEY, 10, null, all, MAP_CAPS.pins);
    const view = buildBoardView(result.items, { category: null, reference: ref(BERKELEY), radiusMiles: 10 });
    const byId = new Map(view.nearby.map((n) => [n.posting.id, n.distanceLabel]));
    expect(milesBetween(BERKELEY, richmond)).toBeGreaterThan(5);
    expect(byId.get(richmond.id)).toBe(formatApproxDistance(milesBetween(BERKELEY, richmond)));
    expect(byId.has(ne.id)).toBe(true);
    expect(byId.has("fx-far")).toBe(false);
  });
});

describe("Property 36: Map request carries only snapped bounds", () => {
  // **Validates: Requirements 6.2, 20.2**
  const onGrid = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-6;

  it("contains only grid-aligned one-decimal bounds, category and mode", () => {
    fc.assert(
      fc.property(
        centreArb,
        fc.constantFrom(...RADIUS_OPTIONS_MILES),
        fc.constantFrom<string | null>(null, "", "music", "housing"),
        fc.constantFrom<"pins" | "cards">("pins", "cards"),
        (centre, radius, category, mode) => {
          const req = buildMapRequest({ bounds: boundsForRadius(centre, radius), category, mode });
          const url = new URL(req.url, "http://localhost");
          expect(url.pathname).toBe("/api/postings/map");
          const keys = [...url.searchParams.keys()].sort();
          const expected = category ? ["bounds", "category", "mode"] : ["bounds", "mode"];
          expect(keys).toEqual(expected);
          expect(url.searchParams.get("mode")).toBe(mode);

          const raw = url.searchParams.get("bounds") as string;
          const parts = raw.split(",");
          expect(parts).toHaveLength(4);
          for (const s of parts) {
            expect(s).toMatch(/^-?\d+\.\d$/);
            expect(onGrid(Number(s))).toBe(true);
          }
          expect(parseBounds(raw)).not.toBeNull();

          // Reference digits never leak beyond what the grid implies.
          for (const v of [centre.lat, centre.lng]) {
            if (!onGrid(v)) {
              expect(req.url).not.toContain(String(v));
              expect(parts.map(Number)).not.toContain(v);
            }
          }
          expect(req.url).not.toMatch(/radius|limit|lat=|lng=|user|email|ref/i);
        },
      ),
      { numRuns: 300 },
    );
  });
});

