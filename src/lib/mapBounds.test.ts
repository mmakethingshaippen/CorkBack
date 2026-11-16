import { describe, expect, it } from "vitest";
import {
  boundsForRadius,
  MAP_CAPS,
  parseBounds,
  pointInBounds,
  selectForBounds,
  snapBoundsOutward,
} from "./mapBounds";
import { COMPASS_DIRECTIONS, COMPASS_BEARINGS, appDistanceMiles, pointAtMiles } from "./__fixtures__/board";

describe("boundsForRadius + snapBoundsOutward containment (sanity)", () => {
  const lats = [0, 37.87, 60, 80, -60, 89.9];
  const radii = [1, 3, 5, 10, 25];
  it("contains points at the radius in all 8 directions", () => {
    for (const lat of lats) {
      for (const miles of radii) {
        const centre = { lat, lng: -122.27 };
        const box = snapBoundsOutward(boundsForRadius(centre, miles));
        for (const d of COMPASS_DIRECTIONS) {
          const p = pointAtMiles(centre, miles, COMPASS_BEARINGS[d]);
          expect(appDistanceMiles(centre, p)).toBeLessThanOrEqual(miles);
          expect(pointInBounds(p, box), `lat ${lat} ${miles}mi ${d}`).toBe(true);
        }
      }
    }
  });

  it("contains the widest-longitude point of the circle (tangent latitude)", () => {
    const centre = { lat: 80, lng: 10 };
    const box = boundsForRadius(centre, 25);
    // scan bearings finely for the max |dLng|
    for (let b = 0; b < 360; b += 0.25) {
      const p = pointAtMiles(centre, 25, b);
      expect(pointInBounds(p, box)).toBe(true);
    }
  });

  it("uses the full longitude range near the poles and the antimeridian, never wrapping", () => {
    const pole = boundsForRadius({ lat: 89.95, lng: 0 }, 10);
    expect([pole.west, pole.east]).toEqual([-180, 180]);
    const am = boundsForRadius({ lat: 10, lng: 179.99 }, 10);
    expect([am.west, am.east]).toEqual([-180, 180]);
    expect(am.west).toBeLessThan(am.east);
  });
});

describe("snapBoundsOutward", () => {
  it("expands, stays on grid, is idempotent, and does not step on grid lines", () => {
    const b = { west: -122.34, south: 37.81, east: -122.21, north: 37.93 };
    const s = snapBoundsOutward(b);
    expect(s).toEqual({ west: -122.4, south: 37.8, east: -122.2, north: 38 });
    expect(snapBoundsOutward(s)).toEqual(s);
    const onGrid = { west: -122.3, south: 37.8, east: -122.2, north: 37.9 };
    expect(snapBoundsOutward({ ...onGrid, east: 0.1 + 0.2 - 0.1 })).toMatchObject({ east: 0.2 });
    expect(snapBoundsOutward(onGrid)).toEqual(onGrid);
  });
  it("clamps to the valid range", () => {
    expect(snapBoundsOutward({ west: -180, south: -90, east: 180, north: 90 })).toEqual({
      west: -180, south: -90, east: 180, north: 90,
    });
    expect(snapBoundsOutward({ west: -179.99, south: -89.99, east: 179.99, north: 89.99 })).toEqual({
      west: -180, south: -90, east: 180, north: 90,
    });
  });
});

describe("parseBounds / pointInBounds / selectForBounds", () => {
  it("parses good input and rejects bad input", () => {
    expect(parseBounds("-122.4,37.8,-122.2,38")).toEqual({ west: -122.4, south: 37.8, east: -122.2, north: 38 });
    for (const bad of [null, "", "1,2,3", "a,1,2,3", "1,,3,4", "-122,38,-123,37", "-181,0,0,1", "0,-91,1,0", "10,0,-10,1", "0,5,1,5", "0,0,Infinity,1"]) {
      expect(parseBounds(bad)).toBeNull();
    }
  });
  it("includes points exactly on the edges", () => {
    const b = { west: 0, south: 0, east: 1, north: 1 };
    expect(pointInBounds({ lat: 0, lng: 0 }, b)).toBe(true);
    expect(pointInBounds({ lat: 1, lng: 1 }, b)).toBe(true);
    expect(pointInBounds({ lat: 1.0001, lng: 1 }, b)).toBe(false);
  });
  it("filters, orders promoted/newest/id desc, caps and flags truncation", () => {
    const mk = (id: string, createdAt: string, isPromoted = false, categorySlug = "music", lat = 0.5) => ({
      id, lat, lng: 0.5, categorySlug, isPromoted, createdAt,
    });
    const all = [
      mk("a", "2025-01-01T00:00:00Z"),
      mk("b", "2025-01-02T00:00:00Z"),
      mk("c", "2025-01-02T00:00:00Z"),
      mk("p", "2024-01-01T00:00:00Z", true),
      mk("x", "2025-01-03T00:00:00Z", false, "sports"),
      mk("far", "2025-01-04T00:00:00Z", false, "music", 5),
    ];
    const bounds = { west: 0, south: 0, east: 1, north: 1 };
    const r = selectForBounds(all, { bounds, category: "music", cap: 3 });
    expect(r.items.map((i) => i.id)).toEqual(["p", "c", "b"]);
    expect(r.truncated).toBe(true);
    const r2 = selectForBounds(all, { bounds, category: "music", cap: 4 });
    expect(r2.truncated).toBe(false);
    expect(r2.items).toHaveLength(4);
    expect(MAP_CAPS).toEqual({ pins: 300, cards: 100 });
  });
});
