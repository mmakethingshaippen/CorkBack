/**
 * Property 32: Category filter is respected by both maps.
 * **Validates: Requirements 13.5, 14.1, 14.2, 14.3**
 * Feature: board-usability-improvements
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { CATEGORIES } from "./categories";
import { parseBounds, selectForBounds, snapBoundsOutward } from "./mapBounds";
import { buildMapRequest, createMapRequestModel, type MapRequestMode } from "./mapRequestModel";
import {
  BERKELEY_POSTINGS,
  COMMUNITY_NOTICES,
  LISTING_CATEGORY_POSTINGS,
  MANY_POSTINGS_150,
  makeFixturePosting,
} from "./__fixtures__/board";

const BOUNDS = { west: -122.6, south: 37.7, east: -122.0, north: 38.1 };

const MIXED = [
  ...BERKELEY_POSTINGS,
  ...LISTING_CATEGORY_POSTINGS,
  ...COMMUNITY_NOTICES,
  ...MANY_POSTINGS_150,
  makeFixturePosting("sports-a", { categorySlug: "sports", lat: 37.87, lng: -122.27 }),
  makeFixturePosting("sports-b", { categorySlug: "sports", lat: 37.88, lng: -122.26 }),
  makeFixturePosting("community-x", { categorySlug: "community", lat: 37.87, lng: -122.28 }),
];

const categoryArb = fc.option(fc.constantFrom(...CATEGORIES.map((c) => c.slug)), { nil: null });

/** Route-equivalent pipeline: parse the request's bounds param, snap, select. */
function run(url: string, category: string | null) {
  const params = new URL(url, "http://x").searchParams;
  const bounds = parseBounds(params.get("bounds"));
  expect(bounds).not.toBeNull();
  expect(params.get("category")).toBe(category);
  return selectForBounds(MIXED, { bounds: snapBoundsOutward(bounds!), category, cap: 1000 });
}

describe("Property 32: category filter on both maps", () => {
  it("cards and pins requests carry the same category, omitted for null", () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        const [cards, pins] = (["cards", "pins"] as MapRequestMode[]).map((mode) =>
          buildMapRequest({ bounds: BOUNDS, category, mode }),
        );
        expect(cards.category).toBe(category);
        expect(pins.category).toBe(category);
        for (const r of [cards, pins]) {
          expect(new URL(r.url, "http://x").searchParams.has("category")).toBe(category !== null);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("both maps return only the selected category through the route pipeline", () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        const results = (["cards", "pins"] as MapRequestMode[]).map((mode) =>
          run(buildMapRequest({ bounds: BOUNDS, category, mode }).url, category),
        );
        for (const r of results) {
          if (category !== null) expect(r.items.every((p) => p.categorySlug === category)).toBe(true);
        }
        expect(results[0].items.map((p) => p.id)).toEqual(results[1].items.map((p) => p.id));
      }),
      { numRuns: 100 },
    );
  });

  it("mixed Sports and Community: each filter excludes the other", () => {
    const sports = run(buildMapRequest({ bounds: BOUNDS, category: "sports", mode: "pins" }).url, "sports");
    const community = run(buildMapRequest({ bounds: BOUNDS, category: "community", mode: "cards" }).url, "community");
    expect(sports.items.length).toBeGreaterThan(0);
    expect(community.items.length).toBeGreaterThan(0);
    expect(sports.items.every((p) => p.categorySlug === "sports")).toBe(true);
    expect(community.items.every((p) => p.categorySlug === "community")).toBe(true);
  });

  it("switching category discards responses for the old category on both maps", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CATEGORIES.map((c) => c.slug)),
        fc.constantFrom(...CATEGORIES.map((c) => c.slug)),
        (oldCat, newCat) => {
          fc.pre(oldCat !== newCat);
          for (const mode of ["cards", "pins"] as MapRequestMode[]) {
            const model = createMapRequestModel<{ id: string }>();
            const oldReq = buildMapRequest({ bounds: BOUNDS, category: oldCat, mode });
            const oldSeq = model.begin(oldReq);
            const newReq = buildMapRequest({ bounds: BOUNDS, category: newCat, mode });
            const newSeq = model.begin(newReq);
            expect(model.succeed(oldSeq, oldCat, { items: [{ id: "old" }], truncated: false })).toBe(false);
            expect(model.getState().items).toEqual([]);
            expect(model.succeed(newSeq, newCat, { items: [{ id: "new" }], truncated: false })).toBe(true);
            expect(model.getState().items).toEqual([{ id: "new" }]);
            // Even with the right sequence, a response for the old category is dropped.
            expect(model.succeed(newSeq, oldCat, { items: [{ id: "old" }], truncated: false })).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
