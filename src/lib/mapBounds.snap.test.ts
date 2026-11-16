import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  SNAP_DEGREES,
  boundsForRadius,
  parseBounds,
  pointInBounds,
  snapBoundsOutward,
  type Bounds,
} from "./mapBounds";
import {
  BERKELEY,
  COMPASS_BEARINGS,
  COMPASS_DIRECTIONS,
  RADIUS_OPTIONS_MILES,
  appDistanceMiles,
  edgePlacementArb,
  pointAtMiles,
} from "./__fixtures__/board";

// Feature: board-usability-improvements, Property 33: Bounds parsing and snapping
// **Validates: Requirements 6.3, 13.3, 13.13**

const TOL = 1e-9;
const dbl = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/** Valid boxes: south < north, west < east, all in range. */
const boundsArb: fc.Arbitrary<Bounds> = fc
  .tuple(dbl(-180, 180), dbl(-180, 180), dbl(-90, 90), dbl(-90, 90))
  .filter(([a, b, c, d]) => a < b && c < d)
  .map(([west, east, south, north]) => ({ west, east, south, north }));

const fmt = (b: Bounds) => `${b.west},${b.south},${b.east},${b.north}`;
const onGrid = (x: number, limit: number) => {
  if (Math.abs(x) === limit) return true;
  const q = x / SNAP_DEGREES;
  return Math.abs(q - Math.round(q)) < 1e-6;
};

describe("Property 33: parseBounds", () => {
  it("accepts valid boxes and round-trips the numbers", () => {
    fc.assert(
      fc.property(boundsArb, (b) => {
        const parsed = parseBounds(fmt(b));
        // String(number) may use exponent form for tiny values, which is rejected as non-decimal.
        if (/e/i.test(fmt(b))) return true;
        expect(parsed).toEqual(b);
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it("accepts plain decimals with whitespace and signs", () => {
    expect(parseBounds("-122.5, 37.7, -122.1, 38")).toEqual({ west: -122.5, south: 37.7, east: -122.1, north: 38 });
    expect(parseBounds("+1,.5,2.,3")).toEqual({ west: 1, south: 0.5, east: 2, north: 3 });
  });

  it("rejects malformed input", () => {
    for (const s of ["", "1,2,3", "1,2,3,4,5", "a,b,c,d", "1,2,3,", ",,,", "1,2,3,NaN", "1,2,3,Infinity", "1e1,2,30,4", "0x1,2,3,4", "1,2,3,4 5", "1;2;3;4"]) {
      expect(parseBounds(s), s).toBeNull();
    }
    expect(parseBounds(null)).toBeNull();
  });

  it("rejects inverted, degenerate, out-of-range and antimeridian-wrapping boxes", () => {
    for (const s of [
      "10,0,5,1", // west > east
      "5,0,5,1", // zero width
      "0,5,1,5", // zero height
      "0,6,1,5", // south > north
      "0,-91,1,0",
      "0,0,1,91",
      "-181,0,1,1",
      "0,0,181,1",
      "170,0,-170,1", // wraps antimeridian
    ]) {
      expect(parseBounds(s), s).toBeNull();
    }
  });

  it("never throws and rejects any non-valid 4-number box", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = parseBounds(s);
        if (r) {
          expect(r.south).toBeLessThan(r.north);
          expect(r.west).toBeLessThan(r.east);
          expect(Math.abs(r.south)).toBeLessThanOrEqual(90);
          expect(Math.abs(r.west)).toBeLessThanOrEqual(180);
        }
        return true;
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(fc.array(fc.double(), { minLength: 4, maxLength: 4 }), (n) => {
        const r = parseBounds(n.join(","));
        const [w, s, e, nn] = n;
        const valid = [w, s, e, nn].every(Number.isFinite) && s < nn && w < e && s >= -90 && nn <= 90 && w >= -180 && e <= 180;
        if (!valid) expect(r).toBeNull();
        return true;
      }),
      { numRuns: 300 },
    );
  });
});

describe("Property 33: snapBoundsOutward", () => {
  it("is idempotent, in range, on the 0.1 grid and contains the original", () => {
    fc.assert(
      fc.property(boundsArb, (b) => {
        const s = snapBoundsOutward(b);
        expect(snapBoundsOutward(s)).toEqual(s);
        expect(s.west).toBeGreaterThanOrEqual(-180);
        expect(s.east).toBeLessThanOrEqual(180);
        expect(s.south).toBeGreaterThanOrEqual(-90);
        expect(s.north).toBeLessThanOrEqual(90);
        expect(onGrid(s.west, 180) && onGrid(s.east, 180) && onGrid(s.south, 90) && onGrid(s.north, 90)).toBe(true);
        expect(s.west).toBeLessThanOrEqual(b.west + TOL);
        expect(s.south).toBeLessThanOrEqual(b.south + TOL);
        expect(s.east).toBeGreaterThanOrEqual(b.east - TOL);
        expect(s.north).toBeGreaterThanOrEqual(b.north - TOL);
        return true;
      }),
      { numRuns: 500 },
    );
  });

  it("leaves an already-snapped box unchanged", () => {
    const b = { west: -122.3, south: 37.8, east: -122.2, north: 37.9 };
    expect(snapBoundsOutward(b)).toEqual(b);
  });
});

describe("Property 33: radius edge stays inside the snapped box (Req 6.3)", () => {
  const centreArb = fc.record({ lat: dbl(-85, 85), lng: dbl(-180, 180) });

  it("a point at exactly the radius and at radius - 0.01 mi is inside", () => {
    fc.assert(
      fc.property(
        centreArb,
        fc.constantFrom(...RADIUS_OPTIONS_MILES),
        dbl(0, 360),
        (centre, radius, bearing) => {
          const box = snapBoundsOutward(boundsForRadius(centre, radius));
          for (const miles of [radius, radius - 0.01]) {
            const p = pointAtMiles(centre, miles, bearing);
            expect(appDistanceMiles(centre, p)).toBeLessThanOrEqual(miles + 1e-9);
            expect(pointInBounds(p, box), `${miles} mi @ ${bearing}`).toBe(true);
          }
          return true;
        },
      ),
      { numRuns: 600 },
    );
  });

  it("fixture edge postings (inside and at) lie inside the snapped box", () => {
    fc.assert(
      fc.property(edgePlacementArb, (e) => {
        fc.pre(e.kind !== "outside");
        const box = snapBoundsOutward(boundsForRadius(e.center, e.radiusMiles));
        expect(pointInBounds(e.point, box)).toBe(true);
        return true;
      }),
      { numRuns: 500 },
    );
  });

  it.each(COMPASS_DIRECTIONS)("Berkeley 10 mi, direction %s", (dir) => {
    const box = snapBoundsOutward(boundsForRadius(BERKELEY, 10));
    for (const miles of [10, 9.99]) {
      const p = pointAtMiles(BERKELEY, miles, COMPASS_BEARINGS[dir]);
      expect(pointInBounds(p, box)).toBe(true);
    }
  });
});
