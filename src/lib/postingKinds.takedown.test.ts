import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { postingTakedown, eventEnd, type LifecycleFields } from "./lifecycle";
import { takedownInfo } from "./postingKinds";

const ZONES = [
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Australia/Lord_Howe",
  "Asia/Kolkata",
  "Pacific/Auckland",
  "Etc/GMT+12",
];
const SLUGS = ["jobs", "housing", "sale", "lost-found", "community", "music", "unknown-slug"];

const dateArb = fc
  .date({ min: new Date("2024-01-01T00:00:00Z"), max: new Date("2027-12-31T00:00:00Z"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));
// Includes dates near common DST transitions.
const dstDateArb = fc.constantFrom("2025-03-09", "2025-11-02", "2025-03-30", "2025-10-26", "2025-04-06", "2025-09-28");
const anyDate = fc.oneof(dateArb, dstDateArb);
const timeArb = fc.option(
  fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })).map(
    ([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
  ),
  { nil: null },
);

const postingArb = fc.record({
  categorySlug: fc.constantFrom(...SLUGS),
  expiresAt: fc
    .date({ min: new Date("2024-01-01T00:00:00Z"), max: new Date("2028-01-31T00:00:00Z"), noInvalidDate: true })
    .map((d) => d.toISOString()),
  eventDate: fc.option(anyDate, { nil: null }),
  endDate: fc.option(anyDate, { nil: null }),
  endTime: timeArb,
  timeZone: fc.option(fc.constantFrom(...ZONES), { nil: null }),
  lat: fc.constant(0),
  lng: fc.constant(0),
});

describe("takedownInfo", () => {
  it("Property 13: Takedown matches the lifecycle rule", () => {
    // **Validates: Requirements 10.1, 10.2, 10.3**
    fc.assert(
      fc.property(postingArb, (p) => {
        const info = takedownInfo(p);
        const expected = postingTakedown(p);
        expect(info.at.getTime()).toBe(expected.getTime());
        const end = eventEnd(p);
        const expires = new Date(p.expiresAt).getTime();
        if (end && end.getTime() < expires) {
          expect(info.reason).toBe(p.categorySlug === "community" || !["jobs", "housing", "sale", "lost-found"].includes(p.categorySlug) ? "event_end" : "deadline");
          expect(info.at.getTime()).toBe(end.getTime());
        } else {
          expect(info.reason).toBe("expiry");
          expect(info.at.getTime()).toBe(expires);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("Property 13: ties and missing dates name expiry", () => {
    // **Validates: Requirements 10.1, 10.2, 10.3**
    const base = { categorySlug: "jobs", lat: 0, lng: 0, timeZone: "America/New_York" };
    const end = eventEnd({ ...base, expiresAt: "2030-01-01T00:00:00Z", eventDate: null, endDate: "2025-06-01", endTime: "10:00" })!;
    const tie = takedownInfo({ ...base, expiresAt: end.toISOString(), eventDate: null, endDate: "2025-06-01", endTime: "10:00" });
    expect(tie.reason).toBe("expiry");
    const none = takedownInfo({ ...base, expiresAt: "2030-01-01T00:00:00Z", eventDate: null });
    expect(none.reason).toBe("expiry");
    expect(none.at.toISOString()).toBe("2030-01-01T00:00:00.000Z");
  });

  it("Property 28: Community takedown follows the date", () => {
    // **Validates: Requirements 9.5, 9.6**
    fc.assert(
      fc.property(postingArb, (raw) => {
        const p = { ...raw, categorySlug: "community" };
        const info = takedownInfo(p);
        const expires = new Date(p.expiresAt).getTime();
        if (!p.eventDate && !p.endDate) {
          expect(info.at.getTime()).toBe(expires);
          expect(info.reason).toBe("expiry");
        } else {
          const end = eventEnd(p)!.getTime();
          expect(info.at.getTime()).toBe(Math.min(expires, end));
          expect(info.reason).toBe(end < expires ? "event_end" : "expiry");
        }
      }),
      { numRuns: 300 },
    );
  });
});
