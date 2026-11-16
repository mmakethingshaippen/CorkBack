import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { countInView, pointInBounds, type Bounds } from "./mapBounds";

// Req 14.4: the caption count is the number of pins inside the visible (unsnapped) view.
describe("countInView", () => {
  const view: Bounds = { west: 0, south: 0, east: 10, north: 10 };

  it("counts only pins inside the view, inclusive of edges", () => {
    const items = [
      { lat: 5, lng: 5 },
      { lat: 0, lng: 10 }, // on the edge
      { lat: 10.05, lng: 5 }, // in the snapped margin, outside the view
      { lat: 5, lng: -0.05 },
    ];
    expect(countInView(items, view)).toBe(2);
  });

  it("returns 0 when the view is unknown or there are no items", () => {
    expect(countInView([{ lat: 1, lng: 1 }], null)).toBe(0);
    expect(countInView([], view)).toBe(0);
  });

  it("matches pointInBounds for any items", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ lat: fc.double({ min: -90, max: 90, noNaN: true }), lng: fc.double({ min: -180, max: 180, noNaN: true }) })),
        (items) => {
          expect(countInView(items, view)).toBe(items.filter((p) => pointInBounds(p, view)).length);
        },
      ),
    );
  });
});
