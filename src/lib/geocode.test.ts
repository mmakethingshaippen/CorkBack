import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversineMeters } from "./domain";
import { AMBIGUOUS_METERS, isAmbiguous, normalizeNominatim, type PlaceMatch } from "./geocode";
import {
  FX_MATCH_AREA,
  FX_MATCH_STREET,
  FX_MATCHES_AMBIGUOUS,
  FX_MATCHES_CLOSE,
} from "./__fixtures__/location";

// Property 6: Geocoder results are normalized and ambiguity is order-independent.
// **Validates: Requirements 4.1, 4.3, 4.5**

const junk = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.string(),
  fc.double({ noNaN: false }),
  fc.boolean(),
  fc.array(fc.string(), { maxLength: 2 }),
);

const coordLike = fc.oneof(
  fc.double({ min: -100, max: 100, noNaN: true }),
  fc.double({ min: -200, max: 200, noNaN: true }).map(String),
  junk,
);

const addressLike = fc.oneof(
  junk,
  fc.record(
    { house_number: junk, road: junk, suburb: junk, city: junk, town: junk },
    { requiredKeys: [] },
  ),
);

const row = fc.oneof(
  junk,
  fc.record(
    {
      osm_type: junk,
      osm_id: junk,
      lat: coordLike,
      lon: coordLike,
      name: junk,
      display_name: fc.oneof(junk, fc.constantFrom("A", "B")),
      category: junk,
      class: junk,
      address: addressLike,
    },
    { requiredKeys: [] },
  ),
);

const point = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

/** Points clustered near one spot so pairs fall on both sides of 250 m. */
const nearPoint = fc
  .record({
    dLat: fc.double({ min: -0.004, max: 0.004, noNaN: true }),
    dLng: fc.double({ min: -0.004, max: 0.004, noNaN: true }),
  })
  .map(({ dLat, dLng }) => ({ lat: 37.87 + dLat, lng: -122.27 + dLng }));

function match(i: number, p: { lat: number; lng: number }): PlaceMatch {
  return {
    id: `fx-${i}`,
    name: "",
    addressLine: "",
    area: "",
    displayName: `fx place ${i}`,
    point: p,
    level: "area",
  };
}

const matches = fc
  .array(fc.oneof(point, nearPoint), { maxLength: 8 })
  .map((ps) => ps.map((p, i) => match(i, p)));

function bruteAmbiguous(ms: PlaceMatch[]): boolean {
  for (let i = 0; i < ms.length; i++)
    for (let j = i + 1; j < ms.length; j++)
      if (haversineMeters(ms[i].point, ms[j].point) > AMBIGUOUS_METERS) return true;
  return false;
}

describe("normalizeNominatim (Property 6)", () => {
  it("never throws, keeps at most 5 valid matches", () => {
    fc.assert(
      fc.property(fc.oneof(fc.array(row, { maxLength: 12 }), junk), (rows) => {
        const out = normalizeNominatim(rows);
        expect(out.length).toBeLessThanOrEqual(5);
        for (const m of out) {
          expect(Number.isFinite(m.point.lat)).toBe(true);
          expect(Number.isFinite(m.point.lng)).toBe(true);
          expect(m.point.lat).toBeGreaterThanOrEqual(-90);
          expect(m.point.lat).toBeLessThanOrEqual(90);
          expect(m.point.lng).toBeGreaterThanOrEqual(-180);
          expect(m.point.lng).toBeLessThanOrEqual(180);
          expect(["address", "area"]).toContain(m.level);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("returns no duplicates within 25 m with the same display name", () => {
    fc.assert(
      fc.property(fc.array(row, { maxLength: 12 }), (rows) => {
        const out = normalizeNominatim(rows);
        for (let i = 0; i < out.length; i++)
          for (let j = i + 1; j < out.length; j++)
            if (out[i].displayName === out[j].displayName)
              expect(haversineMeters(out[i].point, out[j].point)).toBeGreaterThan(25);
      }),
      { numRuns: 200 },
    );
  });

  it("isAmbiguous matches the pairwise definition for any order", () => {
    fc.assert(
      fc.property(matches, fc.array(fc.nat(), { minLength: 8, maxLength: 8 }), (ms, keys) => {
        const shuffled = ms
          .map((m, i) => ({ m, k: keys[i] }))
          .sort((a, b) => a.k - b.k)
          .map((x) => x.m);
        const expected = bruteAmbiguous(ms);
        expect(isAmbiguous(ms)).toBe(expected);
        expect(isAmbiguous(shuffled)).toBe(expected);
        expect(isAmbiguous(ms.slice().reverse())).toBe(expected);
      }),
      { numRuns: 300 },
    );
  });

  it("fixture examples: 3 km apart is ambiguous, 40 m apart is not, singletons are not", () => {
    expect(isAmbiguous(FX_MATCHES_AMBIGUOUS)).toBe(true);
    expect(isAmbiguous(FX_MATCHES_CLOSE)).toBe(false);
    expect(isAmbiguous([FX_MATCH_AREA])).toBe(false);
    expect(isAmbiguous([])).toBe(false);
    expect(isAmbiguous([FX_MATCH_STREET, FX_MATCH_AREA])).toBe(true);
  });

  it("normalizes a Nominatim-shaped row", () => {
    const out = normalizeNominatim([
      {
        osm_type: "way",
        osm_id: 4001,
        lat: "37.88",
        lon: "-122.28",
        name: "Maple Hall",
        display_name: "Maple Hall, 200 Maple Avenue, Westside",
        category: "amenity",
        address: { house_number: "200", road: "Maple Avenue", suburb: "Westside" },
      },
      { lat: "abc", lon: "1" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "way4001", addressLine: "200 Maple Avenue", area: "Westside", level: "address" });
  });
});
