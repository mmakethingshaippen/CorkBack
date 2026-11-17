import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { haversineMeters } from "./domain";
import type { PlaceMatch } from "./geocode";
import {
  approximatePin,
  circleRing,
  emptyDraft,
  locationReducer,
  nudgePin,
  publicPin,
  publishableLocation,
  type LocationDraft,
} from "./postingLocation";

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

describe("Property 31: an approximate posting exposes only the approximate pin on every surface", () => {
  /** **Validates: Requirements 23.1, 23.2, 23.3** */

  // A street-level match whose name, addressLine and displayName all carry the
  // exact house number, so a derived label built from it could leak it.
  const privateHomeMatch = (point: { lat: number; lng: number }, houseNumber: number): PlaceMatch => ({
    id: `node${houseNumber}`,
    name: `${houseNumber} Maple Street`,
    addressLine: `${houseNumber} Maple Street`,
    area: "Elmwood",
    displayName: `${houseNumber} Maple Street, Elmwood`,
    point,
    level: "address",
  });

  // Confirm a private-home draft from a street-level match and return the draft
  // plus the exact confirmed point.
  const confirmedPrivateHome = (
    exact: { lat: number; lng: number },
    houseNumber: number,
    rand: [number, number],
  ): { draft: LocationDraft; exact: { lat: number; lng: number } } => {
    const match = privateHomeMatch(exact, houseNumber);
    let d = emptyDraft();
    d = locationReducer(d, { type: "private_home_set", value: true, rand });
    d = locationReducer(d, { type: "match_selected", match, source: "search" });
    d = locationReducer(d, { type: "proposal_confirmed", rand });
    return { draft: d, exact };
  };

  const exactPointBerkeley = fc.record({
    lat: fc.double({ min: -85, max: 85, noNaN: true }),
    lng: fc.double({ min: -180, max: 180, noNaN: true }),
  });

  it("publishableLocation and publicPin carry only the approximate point, 150-400 m from and never equal to the exact point, marked approximate", () => {
    fc.assert(
      fc.property(exactPointBerkeley, fc.integer({ min: 1, max: 99999 }), randPair, (exact, houseNumber, rand) => {
        const { draft } = confirmedPrivateHome(exact, houseNumber, rand);

        const pin = publicPin(draft);
        const payload = publishableLocation(draft);
        expect(pin).not.toBeNull();
        expect(payload).not.toBeNull();
        if (!pin || !payload) return;

        // The public pin is the approximate point, not the exact one.
        expect(pin.lat === exact.lat && pin.lng === exact.lng).toBe(false);
        const d = haversineMeters(exact, pin);
        expect(d).toBeGreaterThanOrEqual(149);
        expect(d).toBeLessThanOrEqual(401);

        // The payload carries only the approximate point and is flagged approximate.
        expect(payload.lat).toBe(pin.lat);
        expect(payload.lng).toBe(pin.lng);
        expect(payload.precision).toBe("approximate");
        expect(payload.lat === exact.lat && payload.lng === exact.lng).toBe(false);

        // No other coordinate field rides along on the payload.
        expect(Object.keys(payload).sort()).toEqual(["confirmed", "lat", "lng", "precision", "source"]);
      }),
      { numRuns: 300 },
    );
  });

  it("the stored/derived label carries no house number of the confirmed place", () => {
    fc.assert(
      fc.property(exactPointBerkeley, fc.integer({ min: 1, max: 99999 }), randPair, (exact, houseNumber, rand) => {
        const { draft } = confirmedPrivateHome(exact, houseNumber, rand);
        // The private-home label uses the "Near {area}" rule (Requirement 9.7),
        // so the house number of the confirmed place never appears in it.
        expect(draft.label.text).not.toContain(String(houseNumber));
        if (draft.label.text !== "") expect(draft.label.text.startsWith("Near ")).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("the publish payload never carries the exact point as a pair", () => {
    // The guarantee is that the published (lat, lng) pair is not the exact pair.
    // A displacement due north/south leaves longitude unchanged (and east/west leaves
    // latitude unchanged), so neither coordinate alone has to differ; the pair must.
    fc.assert(
      fc.property(exactPointBerkeley, fc.integer({ min: 1, max: 99999 }), randPair, (exact, houseNumber, rand) => {
        const { draft } = confirmedPrivateHome(exact, houseNumber, rand);
        const payload = publishableLocation(draft);
        expect(payload).not.toBeNull();
        if (!payload) return;
        const json = JSON.stringify(payload);
        const parsed = JSON.parse(json) as { lat: number; lng: number };
        // The serialized payload round-trips to the approximate pin, which is never the exact pair.
        expect(parsed.lat === exact.lat && parsed.lng === exact.lng).toBe(false);
        expect(haversineMeters(exact, parsed)).toBeGreaterThanOrEqual(149);
      }),
      { numRuns: 300 },
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
