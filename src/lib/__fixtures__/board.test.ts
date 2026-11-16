import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  EDGE_DELTA_MILES,
  EDGE_POSTINGS_BERKELEY,
  EDGE_POSTINGS_HIGH_LATITUDE,
  EDGE_PLACEMENTS_BERKELEY,
  EDGE_PLACEMENTS_HIGH_LATITUDE,
  MANY_POSTINGS_400,
  LISTING_CATEGORY_POSTINGS,
  COMMUNITY_NOTICES,
  edgePlacementArb,
} from "./board";

function checkPlacement(p: { kind: string; radiusMiles: number; distanceMiles: number }) {
  const r = p.radiusMiles;
  if (p.kind === "inside") expect(Math.abs(p.distanceMiles - (r - EDGE_DELTA_MILES))).toBeLessThan(1e-6);
  if (p.kind === "at") {
    expect(p.distanceMiles).toBeLessThanOrEqual(r);
    expect(r - p.distanceMiles).toBeLessThan(1e-6);
  }
  if (p.kind === "outside") expect(p.distanceMiles).toBeGreaterThan(r);
}

describe("board fixtures", () => {
  it("every fixture id starts with fx- and is unique", () => {
    const all = [
      ...EDGE_POSTINGS_BERKELEY,
      ...EDGE_POSTINGS_HIGH_LATITUDE,
      ...MANY_POSTINGS_400,
      ...LISTING_CATEGORY_POSTINGS,
      ...COMMUNITY_NOTICES,
    ];
    expect(all.every((p) => p.id.startsWith("fx-"))).toBe(true);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
  });

  it("fixed edge placements sit just inside, at, and just outside each radius (Berkeley and 60N)", () => {
    expect(EDGE_PLACEMENTS_BERKELEY).toHaveLength(5 * 8 * 3);
    [...EDGE_PLACEMENTS_BERKELEY, ...EDGE_PLACEMENTS_HIGH_LATITUDE].forEach(checkPlacement);
  });

  it("edge arbitrary places points correctly for any reference point", () => {
    fc.assert(
      fc.property(edgePlacementArb, (p) => {
        checkPlacement(p);
        return p.expectedWithin === (p.distanceMiles <= p.radiusMiles);
      }),
      { numRuns: 100 },
    );
  });
});
