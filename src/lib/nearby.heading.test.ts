import { describe, expect, it } from "vitest";
import { nextLargerRadius, postingCountHeading, type BoardReference } from "./nearby";

const berkeley: BoardReference = { lat: 37.8715, lng: -122.273, kind: "default", name: null };

describe("postingCountHeading", () => {
  it("uses singular for 1 and plural otherwise", () => {
    expect(postingCountHeading(1, 10, berkeley)).toBe("1 posting · Within 10 mi of Berkeley");
    expect(postingCountHeading(0, 5, berkeley)).toBe("0 postings · Within 5 mi of Berkeley");
    expect(postingCountHeading(3, 10, { ...berkeley, kind: "device" })).toBe(
      "3 postings · Within 10 mi of your location",
    );
  });
});

describe("nextLargerRadius", () => {
  it("steps 1 to 3 to 5 to 10 to 25 and stops", () => {
    expect([1, 3, 5, 10, 25].map(nextLargerRadius)).toEqual([3, 5, 10, 25, null]);
  });
});
