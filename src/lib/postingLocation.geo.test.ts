import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { haversineMeters } from "./domain";
import { approximatePin, circleRing, nudgePin } from "./postingLocation";

const validCoord = (p: { lat: number; lng: number }) =>
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  p.lat >= -90 &&
  p.lat <= 90 &&
  p.lng >= -180 &&
  p.lng <= 180;

const rand01 = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });
const randPair = fc.tuple(rand01, rand01) as fc.Arbitrary<[number, number]>;

// Includes high latitudes and the antimeridian.
const exactPoint = fc.oneof(
  fc.record({ lat: fc.double({ min: -85, max: 85, noNaN: true }), lng: fc.double({ min: -180, max: 180, noNaN: true }) }),
  fc.record({ lat: fc.double({ min: 80, max: 85, noNaN: true }), lng: fc.double({ min: -180, max: 180, noNaN: true }) }),
  fc.record({
    lat: fc.double({ min: -85, max: 85, noNaN: true }),
    lng: fc.constantFrom(-180, 180, 179.9999, -179.9999),
  }),
);

describe("Property 9: approximatePin bounds", () => {
  /** **Validates: Requirements 9.2, 9.4** */
  it("is 150 to 400 m from the exact point, valid, and not equal to it", () => {
    fc.assert(
      fc.property(exactPoint, randPair, (exact, rand) => {
        const a = approximatePin(exact, rand);
        const d = haversineMeters(exact, a);
        expect(validCoord(a)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(149);
        expect(d).toBeLessThanOrEqual(401);
        expect(a.lat === exact.lat && a.lng === exact.lng).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("holds at the rand extremes", () => {
    for (const r of [[0, 0], [0.9999999, 0.9999999], [0, 0.5], [0.5, 0]] as [number, number][]) {
      const exact = { lat: 85, lng: 180 };
      const d = haversineMeters(exact, approximatePin(exact, r));
      expect(d).toBeGreaterThanOrEqual(149);
      expect(d).toBeLessThanOrEqual(401);
    }
  });
});

describe("Property 11: nudgePin step", () => {
  /** **Validates: Requirements 5.4** */
  it("moves a valid point by 10 m (0.5 m tolerance) in every direction", () => {
    fc.assert(
      fc.property(
        fc.record({ lat: fc.double({ min: -85, max: 85, noNaN: true }), lng: fc.double({ min: -180, max: 180, noNaN: true }) }),
        fc.constantFrom("n", "s", "e", "w") as fc.Arbitrary<"n" | "s" | "e" | "w">,
        (p, dir) => {
          const q = nudgePin(p, dir);
          expect(validCoord(q)).toBe(true);
          expect(Math.abs(haversineMeters(p, q) - 10)).toBeLessThanOrEqual(0.5);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("circleRing", () => {
  it("is closed and every point lies at the radius", () => {
    fc.assert(
      fc.property(exactPoint, fc.integer({ min: 50, max: 5000 }), fc.integer({ min: 3, max: 90 }), (c, m, steps) => {
        const ring = circleRing(c, m, steps);
        expect(ring).toHaveLength(steps + 1);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        for (const p of ring) {
          expect(validCoord(p)).toBe(true);
          expect(Math.abs(haversineMeters(c, p) - m)).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});
