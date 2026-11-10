import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { TILT_MAX, TILT_MIN, tiltClearance } from "./domain";

/** Resolve the calc() for a given card width, the way the browser does for a grid item. */
const resolve = (css: string, width: number) => {
  const m = /^calc\(([\d.]+)% \+ (\d+)px\)$/.exec(css);
  if (!m) throw new Error(`unexpected ${css}`);
  return (Number(m[1]) / 100) * width + Number(m[2]);
};

describe("tilted card clearance (property)", () => {
  it("covers each card's corner lift, so two stacked cards can never overlap", () => {
    const tilt = fc.double({ min: TILT_MIN, max: TILT_MAX, noNaN: true }).chain((m) => fc.constantFrom(m, -m));
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 1400 }), tilt, tilt, (width, a, b) => {
        const lift = (t: number) => (width / 2) * Math.sin((Math.abs(t) * Math.PI) / 180);
        // Worst case: card above drops a corner, card below raises the same-side corner; no gap counted.
        return resolve(tiltClearance(a), width) + resolve(tiltClearance(b), width) >= lift(a) + lift(b) + 12 - 0.05;
      }),
    );
  });

  it("is about 7% of the width at 8deg, 1.7% at 2deg", () => {
    expect(tiltClearance(8)).toBe("calc(6.959% + 6px)");
    expect(tiltClearance(-2)).toBe("calc(1.745% + 6px)");
  });
});
