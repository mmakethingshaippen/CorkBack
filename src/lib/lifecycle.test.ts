import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  FALLBACK_TIME_ZONE,
  eventEnd,
  isPostingActive,
  isValidTimeZone,
  localDate,
  postingTakedown,
  resolveTimeZone,
  timeZoneForPin,
  wallTimeToInstant,
} from "./lifecycle";

const BERKELEY = { lat: 37.8716, lng: -122.2727 };
const NYC = { lat: 40.7128, lng: -74.006 };
const LA = { ...BERKELEY, timeZone: "America/Los_Angeles" };
const FAR = "2099-01-01T00:00:00.000Z";

describe("time zone resolution (stored zone only)", () => {
  it("looks up the IANA zone from a pin (used at publish)", () => {
    expect(timeZoneForPin(BERKELEY.lat, BERKELEY.lng)).toBe("America/Los_Angeles");
    expect(timeZoneForPin(NYC.lat, NYC.lng)).toBe("America/New_York");
  });

  it("uses the stored zone", () => {
    expect(resolveTimeZone({ timeZone: "Europe/London" })).toEqual({ timeZone: "Europe/London", fallback: false });
  });

  it("never consults the pin at read time: no stored zone means the fallback", () => {
    // Same as the database, which has no pin lookup.
    expect(resolveTimeZone({ timeZone: null })).toEqual({ timeZone: FALLBACK_TIME_ZONE, fallback: true });
  });

  it("rejects malformed or unknown zones exactly like cb_safe_time_zone", () => {
    for (const bad of ["Not/AZone", "5", "+05", "", " America/Los_Angeles", "America/Los Angeles"]) {
      expect(isValidTimeZone(bad)).toBe(false);
      expect(resolveTimeZone({ timeZone: bad }).timeZone).toBe(FALLBACK_TIME_ZONE);
    }
    expect(isValidTimeZone("Etc/GMT+12")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });
});

// The same cases and expected values appear in
// supabase/stage6_social_part1_verify_admin.sql (A-section lifecycle checks).
describe("parity with the database rule", () => {
  const cases: [string, Parameters<typeof eventEnd>[0], string][] = [
    ["local midnight, Los Angeles", { expiresAt: FAR, eventDate: "2026-11-16", ...LA }, "2026-11-17T07:59:59.999Z"],
    ["daylight saving day", { expiresAt: FAR, eventDate: "2026-03-08", ...LA }, "2026-03-09T06:59:59.999Z"],
    ["no stored zone -> UTC-12", { expiresAt: FAR, eventDate: "2026-11-16", ...BERKELEY }, "2026-11-17T11:59:59.999Z"],
    ["invalid zone -> UTC-12", { expiresAt: FAR, eventDate: "2026-11-16", timeZone: "Not/AZone", ...BERKELEY }, "2026-11-17T11:59:59.999Z"],
    ["explicit end time", { expiresAt: FAR, eventDate: "2026-11-16", endTime: "12:00", ...LA }, "2026-11-16T20:00:00.000Z"],
    ["explicit end date + time", { expiresAt: FAR, eventDate: "2026-11-16", endDate: "2026-11-18", endTime: "17:30", ...LA }, "2026-11-19T01:30:00.000Z"],
    ["expiry wins when earlier", { expiresAt: "2026-11-10T00:00:00Z", eventDate: "2026-11-16", ...LA }, "2026-11-10T00:00:00.000Z"],
  ];
  for (const [name, p, expected] of cases) {
    it(name, () => expect(postingTakedown(p).toISOString()).toBe(expected));
  }

  it("reference posting ffe92f35 (no stored zone) is ended under the shared rule", () => {
    const ref = { expiresAt: "2026-11-09T18:50:29.704Z", eventDate: "2024-11-16", ...BERKELEY };
    expect(isPostingActive(ref, new Date("2026-11-08T20:00:00Z"))).toBe(false);
  });
});

describe("event end in the posting's time zone", () => {
  it("ends at local midnight in New York", () => {
    const end = eventEnd({ expiresAt: FAR, eventDate: "2026-11-16", ...NYC, timeZone: "America/New_York" });
    expect(end?.toISOString()).toBe("2026-11-17T04:59:59.999Z");
  });

  it("ends at the end of an explicit end date when no end time is given", () => {
    const end = eventEnd({ expiresAt: FAR, eventDate: "2026-11-16", endDate: "2026-11-18", ...LA });
    expect(end?.toISOString()).toBe("2026-11-19T07:59:59.999Z");
  });

  it("has no event end without an event date", () => {
    expect(eventEnd({ expiresAt: FAR, eventDate: null, ...LA })).toBeNull();
  });
});

describe("isPostingActive", () => {
  it("is active during the event day in local time", () => {
    const p = { expiresAt: FAR, eventDate: "2026-11-16", ...LA };
    // 2026-11-17 03:00 UTC is still 7 pm on Nov 16 in California.
    expect(isPostingActive(p, new Date("2026-11-17T03:00:00Z"))).toBe(true);
    expect(isPostingActive(p, new Date("2026-11-17T08:00:00Z"))).toBe(false);
  });

  it("is ended exactly at the takedown instant (same strict < as SQL)", () => {
    const p = { expiresAt: "2026-11-10T00:00:00Z", eventDate: null, ...LA };
    expect(isPostingActive(p, new Date("2026-11-09T23:59:59.999Z"))).toBe(true);
    expect(isPostingActive(p, new Date("2026-11-10T00:00:00.000Z"))).toBe(false);
  });

  it("is never active when deleted", () => {
    const p = { expiresAt: FAR, eventDate: null, deletedAt: "2026-01-01T00:00:00Z", ...LA };
    expect(isPostingActive(p, new Date("2026-01-02T00:00:00Z"))).toBe(false);
  });

  it("takedown is never later than expiry (property)", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
        fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
        fc.constantFrom<string | null>("America/Los_Angeles", "Europe/Berlin", "Asia/Tokyo", null),
        (expires, event, timeZone) => {
          const t = postingTakedown({
            expiresAt: expires.toISOString(),
            eventDate: event.toISOString().slice(0, 10),
            timeZone,
            ...BERKELEY,
          });
          return t.getTime() <= expires.getTime();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("an event never ends before its day has ended in the posting's zone (property)", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }), (d) => {
        const date = d.toISOString().slice(0, 10);
        const end = eventEnd({ expiresAt: FAR, eventDate: date, ...LA })!;
        return localDate(end, "America/Los_Angeles") === date &&
          localDate(new Date(end.getTime() + 1), "America/Los_Angeles") !== date;
      }),
      { numRuns: 200 },
    );
  });

  it("the fallback never ends an event earlier than its real zone would (property)", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
        fc.constantFrom("America/Los_Angeles", "Pacific/Honolulu", "Europe/London", "Pacific/Kiritimati"),
        (d, zone) => {
          const date = d.toISOString().slice(0, 10);
          const real = eventEnd({ expiresAt: FAR, eventDate: date, timeZone: zone, ...BERKELEY })!;
          const fallback = eventEnd({ expiresAt: FAR, eventDate: date, timeZone: null, ...BERKELEY })!;
          return fallback.getTime() >= real.getTime();
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("helpers", () => {
  it("converts wall time to an instant", () => {
    expect(wallTimeToInstant("2026-07-04", { h: 9, m: 0, s: 0, ms: 0 }, "America/Los_Angeles").toISOString()).toBe(
      "2026-07-04T16:00:00.000Z",
    );
  });

  it("reports the local calendar date", () => {
    expect(localDate(new Date("2026-11-17T03:00:00Z"), "America/Los_Angeles")).toBe("2026-11-16");
    expect(localDate(new Date("2026-11-17T03:00:00Z"), "UTC")).toBe("2026-11-17");
  });
});
