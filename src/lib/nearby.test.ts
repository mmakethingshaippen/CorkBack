import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { filterByCategory } from "./nearby";
import { CATEGORIES } from "./categories";
import { makeFixturePosting } from "./__fixtures__/board";
import type { Posting } from "./types";

const slugArb = fc.constantFrom(...CATEGORIES.map((c) => c.slug));

const postingsArb: fc.Arbitrary<Posting[]> = fc
  .array(slugArb, { maxLength: 40 })
  .map((slugs) => slugs.map((s, i) => makeFixturePosting(`p${i}`, { categorySlug: s })));

describe("filterByCategory", () => {
  // Feature: board-usability-improvements, Property 1: Category filter is a pure subset
  /** **Validates: Requirements 1.6** */
  it("Property 1: category filter is a pure subset", () => {
    fc.assert(
      fc.property(postingsArb, slugArb, (ps, c) => {
        const snapshot = ps.map((p) => p.id);

        // null means all, unchanged
        expect(filterByCategory(ps, null)).toEqual(ps);

        const out = filterByCategory(ps, c);
        // only matching postings
        expect(out.every((p) => p.categorySlug === c)).toBe(true);
        // every matching posting is kept
        expect(out.map((p) => p.id)).toEqual(ps.filter((p) => p.categorySlug === c).map((p) => p.id));
        // idempotent
        expect(filterByCategory(out, c)).toEqual(out);
        // input not mutated
        expect(ps.map((p) => p.id)).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });
});
