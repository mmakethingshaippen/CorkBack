import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  RADIUS_OPTIONS_MILES,
  buildBoardView,
  formatApproxDistance,
  roundApproxMiles,
  type BoardReference,
} from "./nearby";
import {
  BERKELEY,
  EDGE_PLACEMENTS_BERKELEY,
  EDGE_PLACEMENTS_HIGH_LATITUDE,
  edgePlacementPosting,
  makeFixturePosting,
  referencePointArb,
  pointAtMiles,
  COMPASS_DIRECTIONS,
} from "./__fixtures__/board";

const LABEL_RE = /^(Under 0\.5 mi away|About (\d+|\d+\.5) mi away)$/;
const labelValue = (label: string): number | null => {
  const m = /^About (\d+(?:\.5)?) mi away$/.exec(label);
  return m ? Number(m[1]) : null;
};
const ref = (p: { lat: number; lng: number }): BoardReference => ({ ...p, kind: "device", name: null });
const radiusArb = fc.constantFrom(...RADIUS_OPTIONS_MILES);

describe("distance rounding examples (Req 4)", () => {
  it("formats the documented examples", () => {
    expect(formatApproxDistance(0.49)).toBe("Under 0.5 mi away");
    expect(formatApproxDistance(0)).toBe("Under 0.5 mi away");
    expect(formatApproxDistance(0.5)).toBe("About 0.5 mi away");
    expect(roundApproxMiles(2.25)).toBe(2.5);
    expect(formatApproxDistance(9.75)).toBe("About 10 mi away");
    expect(roundApproxMiles(12.5)).toBe(13);
    expect(formatApproxDistance(3)).toBe("About 3 mi away");
    expect(formatApproxDistance(25)).toBe("About 25 mi away");
    expect(formatApproxDistance(2.5)).toBe("About 2.5 mi away");
  });
});

describe("Property 6: distance rounding is bounded and consistent with the radius", () => {
  /** **Validates: Requirements 4.2, 4.3, 4.4, 4.5** */
  it("rounds within half a step, onto the grid", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: 100, noNaN: true }), (m) => {
        const r = roundApproxMiles(m);
        if (m < 10) {
          expect(Math.abs(r - m)).toBeLessThanOrEqual(0.25 + 1e-6);
          expect((r * 2) % 1).toBe(0);
        } else {
          expect(Math.abs(r - m)).toBeLessThanOrEqual(0.5 + 1e-6);
          expect(Number.isInteger(r)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("never rounds a distance within a radius above that radius", () => {
    fc.assert(
      fc.property(radiusArb, fc.double({ min: 0, max: 1, noNaN: true }), (radius, f) => {
        expect(roundApproxMiles(radius * f)).toBeLessThanOrEqual(radius);
      }),
      { numRuns: 300 },
    );
    for (const r of RADIUS_OPTIONS_MILES) expect(roundApproxMiles(r)).toBe(r);
  });

  it("is monotonic", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: 0, max: 60, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(roundApproxMiles(lo)).toBeLessThanOrEqual(roundApproxMiles(hi));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("board labels never exceed the radius, including edge postings at every radius", () => {
    const all = [...EDGE_PLACEMENTS_BERKELEY, ...EDGE_PLACEMENTS_HIGH_LATITUDE];
    for (const radius of RADIUS_OPTIONS_MILES) {
      for (const center of [BERKELEY, EDGE_PLACEMENTS_HIGH_LATITUDE[0].center]) {
        const postings = all.filter((p) => p.radiusMiles === radius && p.center === center).map((p) => edgePlacementPosting(p));
        const view = buildBoardView(postings, { category: null, reference: ref(center), radiusMiles: radius });
        expect(view.nearby.length).toBeGreaterThan(0);
        for (const item of view.nearby) {
          const v = labelValue(item.distanceLabel);
          if (v !== null) expect(v).toBeLessThanOrEqual(radius);
        }
      }
    }
  });

  it("random references and edge points keep labels within the radius", () => {
    fc.assert(
      fc.property(
        referencePointArb,
        radiusArb,
        fc.constantFrom(...COMPASS_DIRECTIONS),
        fc.double({ min: 0.9, max: 1, noNaN: true }),
        (center, radius, dir, f) => {
          const point = pointAtMiles(center, radius * f, 0 + COMPASS_DIRECTIONS.indexOf(dir) * 45);
          const posting = makeFixturePosting("p6", { lat: point.lat, lng: point.lng });
          const view = buildBoardView([posting], { category: null, reference: ref(center), radiusMiles: radius });
          for (const item of view.nearby) {
            const v = labelValue(item.distanceLabel);
            if (v !== null) expect(v).toBeLessThanOrEqual(radius);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("Property 7: distance labels are coarse and carry no coordinates", () => {
  /** **Validates: Requirements 4.4, 4.7, 20.1, 20.4** */
  it("every label matches the coarse pattern and omits coordinate digits", () => {
    fc.assert(
      fc.property(
        referencePointArb,
        fc.double({ min: 0, max: 25, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        (center, miles, bearing) => {
          const point = pointAtMiles(center, miles, bearing);
          const posting = makeFixturePosting("p7", { lat: point.lat, lng: point.lng });
          const view = buildBoardView([posting], { category: null, reference: ref(center), radiusMiles: 25 });
          for (const { distanceLabel } of view.nearby) {
            expect(distanceLabel).toMatch(LABEL_RE);
            const digits = distanceLabel.replace(/\D/g, "");
            for (const c of [center.lat, center.lng, point.lat, point.lng]) {
              const frac = Math.abs(c).toString().replace(".", "");
              // No run of 4+ coordinate digits may appear in the label.
              for (let i = 0; i + 4 <= frac.length; i++) expect(distanceLabel).not.toContain(frac.slice(i, i + 4));
            }
            expect(digits.length).toBeLessThanOrEqual(3);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("any non-negative distance formats to a coarse label", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1000, noNaN: true }), (m) => {
        expect(formatApproxDistance(m)).toMatch(LABEL_RE);
      }),
      { numRuns: 200 },
    );
  });
});

describe("Property 9: zero distance reads as under half a mile", () => {
  /** **Validates: Requirements 4.4** */
  it("a posting at the reference point is labelled under 0.5 mi", () => {
    fc.assert(
      fc.property(referencePointArb, radiusArb, (center, radius) => {
        const posting = makeFixturePosting("p9", { lat: center.lat, lng: center.lng });
        const view = buildBoardView([posting], { category: null, reference: ref(center), radiusMiles: radius });
        expect(view.nearby).toHaveLength(1);
        expect(view.nearby[0].distanceLabel).toBe("Under 0.5 mi away");
      }),
      { numRuns: 100 },
    );
    expect(formatApproxDistance(0)).toBe("Under 0.5 mi away");
    expect(roundApproxMiles(0)).toBe(0);
  });
});
