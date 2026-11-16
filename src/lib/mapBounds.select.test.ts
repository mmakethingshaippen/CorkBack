import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAP_CAPS, selectForBounds, type Bounds } from "./mapBounds";
import { CATEGORIES } from "./categories";
import {
  BERKELEY,
  MANY_POSTINGS_150,
  MANY_POSTINGS_400,
  makeFixturePosting,
} from "./__fixtures__/board";
import type { Posting } from "./types";

const SETS = [MANY_POSTINGS_150, MANY_POSTINGS_400];
const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

const inside = (p: Posting, b: Bounds) =>
  p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;

/** Independent reference order: promoted, newest createdAt, id descending. */
function expectedOrder(list: Posting[]): Posting[] {
  return [...list].sort((a, b) => {
    if (a.isPromoted !== b.isPromoted) return a.isPromoted ? -1 : 1;
    const d = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (d !== 0) return d;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

// Bounds around the fixture grid; edges snap to real posting coordinates half the time.
const boundsArb = (set: Posting[]): fc.Arbitrary<Bounds> => {
  const lats = set.map((p) => p.lat);
  const lngs = set.map((p) => p.lng);
  const coord = (vals: number[], fallbackCenter: number) =>
    fc.oneof(
      fc.constantFrom(...vals),
      fc.double({ min: fallbackCenter - 0.03, max: fallbackCenter + 0.03, noNaN: true }),
    );
  return fc
    .tuple(coord(lngs, BERKELEY.lng), coord(lngs, BERKELEY.lng), coord(lats, BERKELEY.lat), coord(lats, BERKELEY.lat))
    .filter(([a, b, c, d]) => a !== b && c !== d)
    .map(([a, b, c, d]) => ({
      west: Math.min(a, b),
      east: Math.max(a, b),
      south: Math.min(c, d),
      north: Math.max(c, d),
    }));
};

const queryArb = (set: Posting[]) =>
  fc.record({
    bounds: boundsArb(set),
    category: fc.option(fc.constantFrom(...CATEGORY_SLUGS), { nil: null }),
    mode: fc.constantFrom<"pins" | "cards">("pins", "cards"),
  });

describe("selectForBounds properties", () => {
  /** **Validates: Requirements 13.5, 13.6, 13.7** (Property 31) */
  it("Property 31: every returned posting lies inside the bounds (edges inclusive) and the category", () => {
    for (const set of SETS) {
      fc.assert(
        fc.property(queryArb(set), ({ bounds, category, mode }) => {
          const r = selectForBounds(set, { bounds, category, cap: MAP_CAPS[mode] });
          return r.items.every((p) => inside(p, bounds) && (category === null || p.categorySlug === category));
        }),
        { numRuns: 200 },
      );
    }
  });

  /** **Validates: Requirements 13.4** (Property 17, selectForBounds part) */
  it("Property 17: items.length <= cap, truncated iff matches > cap, not truncated returns all matches", () => {
    for (const set of SETS) {
      fc.assert(
        fc.property(queryArb(set), ({ bounds, category, mode }) => {
          const cap = MAP_CAPS[mode];
          const r = selectForBounds(set, { bounds, category, cap });
          const matches = set.filter((p) => inside(p, bounds) && (category === null || p.categorySlug === category));
          expect(r.cap).toBe(cap);
          expect(r.items.length).toBeLessThanOrEqual(cap);
          expect(r.truncated).toBe(matches.length > cap);
          if (!r.truncated) {
            expect(r.items.map((p) => p.id).sort()).toEqual(matches.map((p) => p.id).sort());
          }
          return true;
        }),
        { numRuns: 200 },
      );
    }
  });

  /** **Validates: Requirements 13.5, 13.6, 13.7** (Property 31, ordering and truncation) */
  it("orders promoted, newest, id descending; truncated result is the first cap of that order", () => {
    const postingArb = fc.record({
      n: fc.integer({ min: 0, max: 999 }),
      promoted: fc.boolean(),
      t: fc.integer({ min: 0, max: 5 }), // few distinct times forces ties
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(postingArb, { selector: (x) => x.n, minLength: 0, maxLength: 60 }),
        fc.integer({ min: 0, max: 30 }),
        (rows, cap) => {
          const list = rows.map((x) =>
            makeFixturePosting(`ord-${String(x.n).padStart(4, "0")}`, {
              isPromoted: x.promoted,
              createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, x.t)).toISOString(),
            }),
          );
          const bounds: Bounds = { west: -123, east: -122, south: 37, north: 38 };
          const r = selectForBounds(list, { bounds, category: null, cap });
          const want = expectedOrder(list);
          expect(r.items.map((p) => p.id)).toEqual(want.slice(0, cap).map((p) => p.id));
          expect(r.truncated).toBe(list.length > cap);
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("fixture sets: 150 fills cards cap (truncated) but not pins cap; 400 truncates both", () => {
    const all: Bounds = { west: -123, east: -122, south: 37, north: 38 };
    const a = selectForBounds(MANY_POSTINGS_150, { bounds: all, category: null, cap: MAP_CAPS.cards });
    expect(a.items).toHaveLength(100);
    expect(a.truncated).toBe(true);
    const b = selectForBounds(MANY_POSTINGS_150, { bounds: all, category: null, cap: MAP_CAPS.pins });
    expect(b.items).toHaveLength(150);
    expect(b.truncated).toBe(false);
    const c = selectForBounds(MANY_POSTINGS_400, { bounds: all, category: null, cap: MAP_CAPS.pins });
    expect(c.items).toHaveLength(300);
    expect(c.truncated).toBe(true);
    expect(c.items.map((p) => p.id)).toEqual(
      expectedOrder(MANY_POSTINGS_400)
        .slice(0, 300)
        .map((p) => p.id),
    );
  });

  it("a posting exactly on a box edge or corner is included", () => {
    const p = makeFixturePosting("edge-corner", { lat: 37.9, lng: -122.3 });
    const bounds: Bounds = { west: -122.3, east: -122.2, south: 37.8, north: 37.9 };
    expect(selectForBounds([p], { bounds, category: null, cap: 10 }).items).toHaveLength(1);
    const outside = makeFixturePosting("edge-out", { lat: 37.9000001, lng: -122.3 });
    expect(selectForBounds([outside], { bounds, category: null, cap: 10 }).items).toHaveLength(0);
  });
});
