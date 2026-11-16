/**
 * Property 18: World caption is accurate.
 * **Validates: Requirements 14.1, 14.4, 14.5, 14.8**
 *
 * Note: the "names category and count" part applies only when NOT truncated.
 * When truncated the caption is fixed text that names neither.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { worldCaption, worldEmptyText } from "./nearby";

const SEP = "\u00b7";
const labelArb = fc.stringMatching(/^[A-Za-z][A-Za-z &]{0,15}[A-Za-z]$/);
const countArb = fc.integer({ min: 0, max: 299 });

describe("Property 18: world caption", () => {
  it("not truncated: names category (or All categories) and the in-view count", () => {
    fc.assert(
      fc.property(fc.option(labelArb, { nil: null }), countArb, (label, n) => {
        const noun = n === 1 ? "posting" : "postings";
        expect(worldCaption(label, n, false)).toBe(
          `Explore the world ${SEP} ${label ?? "All categories"} ${SEP} ${n} ${noun} in view`,
        );
      }),
      { numRuns: 200 },
    );
  });

  it("truncated: fixed text naming neither category nor count", () => {
    fc.assert(
      fc.property(fc.option(labelArb, { nil: null }), fc.integer({ min: 0, max: 100000 }), (label, n) => {
        const text = worldCaption(label, n, true);
        expect(text).toBe("Showing 300 of many postings in this view. Zoom in to see more.");
        expect(text).not.toContain(SEP);
      }),
      { numRuns: 100 },
    );
  });

  it("never states a number other than the in-view count or 300", () => {
    fc.assert(
      fc.property(fc.option(labelArb, { nil: null }), countArb, fc.boolean(), (label, n, truncated) => {
        const nums = (worldCaption(label, n, truncated).match(/\d+/g) ?? []).map(Number);
        const allowed = truncated ? [300] : [n];
        for (const x of nums) expect(allowed).toContain(x);
      }),
      { numRuns: 200 },
    );
  });

  it("uses singular for exactly one posting", () => {
    expect(worldCaption(null, 1, false)).toBe(`Explore the world ${SEP} All categories ${SEP} 1 posting in view`);
    expect(worldCaption("Sports", 0, false)).toContain("0 postings in view");
  });

  it("empty text names the category, or 'matching' when none", () => {
    expect(worldEmptyText("Sports")).toBe("No Sports postings in this view.");
    expect(worldEmptyText(null)).toBe("No matching postings in this view.");
  });
});
