import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CATEGORIES } from "./categories";
import { locationLabels } from "./postingKinds";

const HINT = "This text is shown to visitors. The pin shows the same place on the map.";

/** The design table, written out independently of the implementation. */
function expected(slug: string, hasEventDate: boolean): { field: string; detail: string } {
  if (["music", "nightlife", "sports", "social-clubs", "classes"].includes(slug)) {
    return { field: "Event venue", detail: "Event venue" };
  }
  if (slug === "community") {
    return hasEventDate
      ? { field: "Event venue", detail: "Event venue" }
      : { field: "Location", detail: "Location" };
  }
  if (["jobs", "housing", "sale"].includes(slug)) {
    return { field: "Listing location", detail: "Listing location" };
  }
  if (slug === "lost-found") {
    return { field: "Where it was lost or found", detail: "Lost or found near" };
  }
  throw new Error(`unlisted slug ${slug}`);
}

describe("locationLabels", () => {
  // Feature: posting-location-confirmation, Property 14: Every category has a location label
  // **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.6**
  it("returns the designed, non-empty labels for every category and either date state", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CATEGORIES.map((c) => c.slug)),
        fc.boolean(),
        (slug, hasEventDate) => {
          const got = locationLabels(slug, { hasEventDate });
          const want = expected(slug, hasEventDate);
          expect(got.field.trim()).not.toBe("");
          expect(got.detail.trim()).not.toBe("");
          expect(got.hint.trim()).not.toBe("");
          expect(got.field).toBe(want.field);
          expect(got.detail).toBe(want.detail);
          expect(got.hint).toBe(HINT);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("covers every category exactly (examples)", () => {
    for (const { slug } of CATEGORIES) {
      for (const hasEventDate of [true, false]) {
        expect(locationLabels(slug, { hasEventDate }).field).toBe(expected(slug, hasEventDate).field);
      }
    }
  });

  it("treats an unknown slug as an event", () => {
    expect(locationLabels("mystery", { hasEventDate: false }).field).toBe("Event venue");
  });
});
