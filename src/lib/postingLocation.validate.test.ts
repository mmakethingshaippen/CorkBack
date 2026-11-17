// Feature: posting-location-confirmation, Properties 1, 2 and 3 (publish part). Pure, no network.
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { CATEGORIES } from "./categories";
import { EXPIRY_PRESETS } from "./domain";
import { localDate, timeZoneForPin } from "./lifecycle";
import { validatePostingInput } from "./postingInput";
import { categoryKind } from "./postingKinds";

const NOW = new Date("2030-06-15T12:00:00Z");
const SOURCES = ["flyer_candidate", "search", "pin", "device"] as const;
const slugArb = fc.constantFrom(...CATEGORIES.map((c) => c.slug));
const latArb = fc.double({ min: -90, max: 90, noNaN: true });
const lngArb = fc.double({ min: -180, max: 180, noNaN: true });

const body = (slug: string, extra: Record<string, unknown> = {}) => ({
  title: "Test posting",
  categorySlug: slug,
  expiry: EXPIRY_PRESETS[0],
  placeLabel: "Somewhere",
  ...extra,
});
const loc = (over: Record<string, unknown> = {}) => ({
  lat: 40.7,
  lng: -74,
  confirmed: true,
  source: "search",
  precision: "exact",
  ...over,
});

describe("Property 1: publish requires a confirmed, valid location block", () => {
  // **Validates: Requirements 1.1, 1.5, 1.6, 12.1, 12.2, 12.9**
  it("accepts any confirmed in-range block with a known source", () => {
    fc.assert(
      fc.property(slugArb, latArb, lngArb, fc.constantFrom(...SOURCES), (slug, lat, lng, source) => {
        const r = validatePostingInput(body(slug, { location: loc({ lat, lng, source }) }), NOW);
        expect(r.ok).toBe(true);
      }),
    );
  });

  it("rejects a missing location, with or without retired real/desired", () => {
    fc.assert(
      fc.property(
        slugArb,
        fc.constantFrom(undefined, null),
        fc.record({ lat: latArb, lng: lngArb }),
        fc.constantFrom({}, "real", "desired", "both"),
        (slug, missing, pt, retired) => {
          const extra: Record<string, unknown> = { location: missing };
          if (retired === "real" || retired === "both") extra.real = pt;
          if (retired === "desired" || retired === "both") extra.desired = pt;
          expect(validatePostingInput(body(slug, extra), NOW).ok).toBe(false);
        },
      ),
    );
  });

  it("rejects confirmed other than true", () => {
    fc.assert(
      fc.property(
        slugArb,
        fc.constantFrom(false, undefined, null, "true", 1, 0, "yes", {}),
        (slug, confirmed) => {
          expect(validatePostingInput(body(slug, { location: loc({ confirmed }) }), NOW).ok).toBe(false);
        },
      ),
    );
  });

  it("rejects an unknown source", () => {
    fc.assert(
      fc.property(
        slugArb,
        fc.oneof(fc.string().filter((s) => !(SOURCES as readonly string[]).includes(s)), fc.constantFrom(undefined, null, 5, "real", "desired")),
        (slug, source) => {
          expect(validatePostingInput(body(slug, { location: loc({ source }) }), NOW).ok).toBe(false);
        },
      ),
    );
  });

  it("rejects non-finite, out-of-range, non-number and string coordinates", () => {
    const badCoord = (limit: number) =>
      fc.oneof(
        fc.constantFrom(NaN, Infinity, -Infinity, undefined, null, "10", "abc", true, {}, []),
        fc.double({ min: limit + 0.000001, max: 1e9, noNaN: true }),
        fc.double({ min: -1e9, max: -limit - 0.000001, noNaN: true }),
      );
    fc.assert(
      fc.property(slugArb, badCoord(90), (slug, lat) => {
        expect(validatePostingInput(body(slug, { location: loc({ lat }) }), NOW).ok).toBe(false);
      }),
    );
    fc.assert(
      fc.property(slugArb, badCoord(180), (slug, lng) => {
        expect(validatePostingInput(body(slug, { location: loc({ lng }) }), NOW).ok).toBe(false);
      }),
    );
  });

  it("rejects a location that is not an object", () => {
    for (const location of ["x", 5, true, [], [loc()]]) {
      expect(validatePostingInput(body("music", { location }), NOW).ok).toBe(false);
    }
  });
});

describe("Property 2: the submitted point is the pin, the zone follows the pin", () => {
  // **Validates: Requirements 1.2, 1.7, 9.9, 12.3, 12.4**
  it("returns the exact pin, the pin's zone and the submitted precision", () => {
    fc.assert(
      fc.property(
        slugArb,
        latArb,
        lngArb,
        fc.constantFrom("exact", "approximate"),
        // A distant "other point", e.g. a device position, must have no effect.
        fc.record({ lat: latArb, lng: lngArb }),
        (slug, lat, lng, precision, other) => {
          const r = validatePostingInput(
            body(slug, { location: loc({ lat, lng, precision }), real: other, desired: other }),
            NOW,
          );
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.value.pin).toEqual({ lat, lng });
          expect(r.value.precision).toBe(precision);
          expect(r.value.timeZone).toBe(timeZoneForPin(lat, lng));
        },
      ),
    );
  });

  it("rejects any precision other than exact or approximate", () => {
    fc.assert(
      fc.property(
        slugArb,
        fc.oneof(
          fc.string().filter((s) => s !== "exact" && s !== "approximate"),
          fc.constantFrom(undefined, null, 1, true, {}),
        ),
        (slug, precision) => {
          expect(validatePostingInput(body(slug, { location: loc({ precision }) }), NOW).ok).toBe(false);
        },
      ),
    );
  });
});

describe("Property 3 (publish part): date rules are judged in the zone of the pin", () => {
  // **Validates: Requirements 1.2, 12.5**
  const PINS = [
    { name: "Honolulu", lat: 21.3069, lng: -157.8583 },
    { name: "Auckland", lat: -36.8485, lng: 174.7633 },
    { name: "New York", lat: 40.7128, lng: -74.006 },
  ];
  const addDays = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const nowArb = fc.integer({ min: 0, max: 48 * 4 }).map((q) => new Date(NOW.getTime() + q * 15 * 60 * 1000));

  it("an event without an end is rejected as past exactly when its date is before the pin's local date", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("music", "sports", "classes"),
        fc.constantFrom(...PINS),
        nowArb,
        fc.integer({ min: -3, max: 3 }),
        (slug, pin, now, offset) => {
          const tz = timeZoneForPin(pin.lat, pin.lng);
          expect(tz).not.toBeNull();
          const eventDate = addDays(localDate(now, tz as string), offset);
          const r = validatePostingInput(
            body(slug, { eventDate, location: loc({ lat: pin.lat, lng: pin.lng }) }),
            now,
          );
          const isPast = eventDate < localDate(now, tz as string);
          expect(r.ok).toBe(!isPast);
        },
      ),
    );
  });

  it("a listing deadline is rejected as passed exactly when it is before the pin's local date", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("jobs", "housing", "sale"),
        fc.constantFrom(...PINS),
        nowArb,
        fc.integer({ min: -3, max: 3 }),
        (slug, pin, now, offset) => {
          expect(categoryKind(slug)).toBe("listing");
          const tz = timeZoneForPin(pin.lat, pin.lng) as string;
          const deadline = addDays(localDate(now, tz), offset);
          const r = validatePostingInput(
            body(slug, { deadline, location: loc({ lat: pin.lat, lng: pin.lng }) }),
            now,
          );
          expect(r.ok).toBe(deadline >= localDate(now, tz));
        },
      ),
    );
  });

  it("the same date can pass at one pin and fail at another", () => {
    // 2030-06-15T12:00Z is June 16 in Auckland (UTC+12) and June 15 in Honolulu (UTC-10).
    const eventDate = "2030-06-15";
    const at = (p: (typeof PINS)[number]) =>
      validatePostingInput(body("music", { eventDate, location: loc({ lat: p.lat, lng: p.lng }) }), NOW).ok;
    expect(at(PINS[0])).toBe(true);
    expect(at(PINS[1])).toBe(false);
  });
});
