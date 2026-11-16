/**
 * Property tests for the nearby set built by buildBoardView (design.md
 * Properties 2, 3, 4, 5). Includes radius-edge postings from the shared fixtures.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildBoardView, milesBetween, RADIUS_OPTIONS_MILES, type BoardReference } from "./nearby";
import type { Posting } from "./types";
import { CATEGORIES } from "./categories";
import {
  BERKELEY,
  EDGE_PLACEMENTS_BERKELEY,
  EDGE_PLACEMENTS_HIGH_LATITUDE,
  HIGH_LATITUDE,
  edgePlacementArb,
  edgePlacementPosting,
  edgePostingArb,
  makeFixturePosting,
  referencePointArb,
  type EdgePlacement,
} from "./__fixtures__/board";

const ref = (p: { lat: number; lng: number }): BoardReference => ({ lat: p.lat, lng: p.lng, kind: "town", name: "X" });
const ids = (ps: Posting[]) => ps.map((p) => p.id);
const slugs = CATEGORIES.map((c) => c.slug);
const radiusArb = fc.constantFrom(...RADIUS_OPTIONS_MILES);

/** A posting within ~0.5 degrees of the reference, with a random category and promotion flag. */
const nearbyPostingArb = (center: { lat: number; lng: number }) =>
  fc.record({
    dlat: fc.double({ min: -0.4, max: 0.4, noNaN: true }),
    dlng: fc.double({ min: -0.4, max: 0.4, noNaN: true }),
    cat: fc.constantFrom(...slugs),
    promo: fc.boolean(),
  });

const postingSetArb = (center: { lat: number; lng: number }) =>
  fc.array(nearbyPostingArb(center), { maxLength: 40 }).map((rows) =>
    rows.map((r, i) =>
      makeFixturePosting(`p${String(i).padStart(3, "0")}`, {
        categorySlug: r.cat,
        isPromoted: r.promo,
        lat: center.lat + r.dlat,
        lng: center.lng + r.dlng,
      }),
    ),
  );

describe("Property 2: Nearby equals category and radius", () => {
  /** **Validates: Requirements 3.1** */
  it("nearby is exactly the postings in category with distance <= radius", () => {
    fc.assert(
      fc.property(
        referencePointArb,
        postingSetArb(BERKELEY),
        fc.option(fc.constantFrom(...slugs), { nil: null }),
        radiusArb,
        (center, postings, category, radiusMiles) => {
          const moved = postings.map((p) => ({ ...p, lat: center.lat + (p.lat - BERKELEY.lat), lng: center.lng + (p.lng - BERKELEY.lng) }));
          const view = buildBoardView(moved, { category, reference: ref(center), radiusMiles });
          const expected = moved.filter(
            (p) => (category === null || p.categorySlug === category) && milesBetween(center, p) <= radiusMiles,
          );
          expect(new Set(ids(view.nearby.map((n) => n.posting)))).toEqual(new Set(ids(expected)));
          expect(view.nearby.length).toBe(expected.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  /** **Validates: Requirements 3.1** */
  it.each([
    ["Berkeley", BERKELEY, EDGE_PLACEMENTS_BERKELEY],
    ["60N", HIGH_LATITUDE, EDGE_PLACEMENTS_HIGH_LATITUDE],
  ])("fixed edge placements around %s: inside and at are members, outside are not", (_n, center, placements) => {
    expect(placements.length).toBe(RADIUS_OPTIONS_MILES.length * 8 * 3);
    for (const radiusMiles of RADIUS_OPTIONS_MILES) {
      const rows = placements.filter((p) => p.radiusMiles === radiusMiles);
      const postings = rows.map((p) => edgePlacementPosting(p));
      const view = buildBoardView(postings, { category: null, reference: ref(center), radiusMiles });
      const member = new Set(ids(view.nearby.map((n) => n.posting)));
      for (const p of rows) {
        const id = edgePlacementPosting(p).id;
        expect(member.has(id), `${p.kind} ${p.direction} ${radiusMiles}mi`).toBe(p.expectedWithin);
      }
    }
  });

  /** **Validates: Requirements 3.1** */
  it("generated edge postings (any reference, radius, direction) are members iff inside or exactly at", () => {
    fc.assert(
      fc.property(edgePlacementArb, (p: EdgePlacement) => {
        const posting = edgePlacementPosting(p);
        const view = buildBoardView([posting], { category: null, reference: ref(p.center), radiusMiles: p.radiusMiles });
        expect(view.nearby.length === 1).toBe(p.expectedWithin);
      }),
      { numRuns: 400 },
    );
  });

  /** **Validates: Requirements 3.1** */
  it("edgePostingArb postings relative to Berkeley match the true-distance oracle", () => {
    fc.assert(
      fc.property(edgePostingArb, radiusArb, (posting, radiusMiles) => {
        const view = buildBoardView([posting], { category: null, reference: ref(BERKELEY), radiusMiles });
        expect(view.nearby.length === 1).toBe(milesBetween(BERKELEY, posting) <= radiusMiles);
      }),
      { numRuns: 300 },
    );
  });
});

describe("Property 3: Radius is monotone", () => {
  /** **Validates: Requirements 3.2** */
  it("nearby ids at r1 are a subset of ids at r2 for r1 <= r2", () => {
    fc.assert(
      fc.property(
        postingSetArb(BERKELEY),
        fc.array(edgePostingArb, { maxLength: 30 }),
        fc.option(fc.constantFrom(...slugs), { nil: null }),
        radiusArb,
        radiusArb,
        (postings, edges, category, a, b) => {
          const all = [...postings, ...edges.map((e, i) => ({ ...e, id: `${e.id}-${i}` }))];
          const [r1, r2] = a <= b ? [a, b] : [b, a];
          const small = buildBoardView(all, { category, reference: ref(BERKELEY), radiusMiles: r1 });
          const large = buildBoardView(all, { category, reference: ref(BERKELEY), radiusMiles: r2 });
          const largeIds = new Set(ids(large.nearby.map((n) => n.posting)));
          for (const n of small.nearby) expect(largeIds.has(n.posting.id)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("Property 4: Pins and cards come from one set", () => {
  /** **Validates: Requirements 3.4** */
  it("every nearby posting passes the category filter and both pins and cards read nearby", () => {
    fc.assert(
      fc.property(
        postingSetArb(BERKELEY),
        fc.option(fc.constantFrom(...slugs), { nil: null }),
        radiusArb,
        (postings, category, radiusMiles) => {
          const view = buildBoardView(postings, { category, reference: ref(BERKELEY), radiusMiles });
          // HomeMap draws pins and the rail from view.nearby; both derive the same id list.
          const pinIds = view.nearby.map((n) => n.posting.id);
          const cardIds = view.nearby.map((n) => n.posting.id);
          expect(pinIds).toEqual(cardIds);
          for (const n of view.nearby) {
            if (category !== null) expect(n.posting.categorySlug).toBe(category);
            expect(milesBetween(BERKELEY, n.posting)).toBeLessThanOrEqual(radiusMiles);
          }
          expect(new Set(pinIds).size).toBe(pinIds.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("Property 5: Nearest-first ordering within groups", () => {
  /** **Validates: Requirements 3.3** */
  it("promoted first, distance non-decreasing within each group, stable under permutation", () => {
    fc.assert(
      fc.property(
        postingSetArb(BERKELEY),
        fc.array(edgePostingArb, { maxLength: 20 }),
        fc.infiniteStream(fc.nat()),
        (postings, edges, rnd) => {
          const all = [...postings, ...edges.map((e, i) => ({ ...e, id: `${e.id}-${i}`, isPromoted: i % 3 === 0 }))];
          const opts = { category: null, reference: ref(BERKELEY), radiusMiles: 25 };
          const view = buildBoardView(all, opts);
          const list = view.nearby.map((n) => n.posting);

          const firstPlain = list.findIndex((p) => !p.isPromoted);
          if (firstPlain >= 0) expect(list.slice(firstPlain).some((p) => p.isPromoted)).toBe(false);
          for (const group of [list.filter((p) => p.isPromoted), list.filter((p) => !p.isPromoted)]) {
            for (let i = 1; i < group.length; i++) {
              expect(milesBetween(BERKELEY, group[i - 1])).toBeLessThanOrEqual(milesBetween(BERKELEY, group[i]));
            }
          }

          // Permute the input (Fisher-Yates with the generated stream) and compare.
          const shuffled = [...all];
          const it = rnd[Symbol.iterator]();
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = it.next().value % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          const again = buildBoardView(shuffled, opts);
          expect(ids(again.nearby.map((n) => n.posting))).toEqual(ids(list));
        },
      ),
      { numRuns: 200 },
    );
  });
});
