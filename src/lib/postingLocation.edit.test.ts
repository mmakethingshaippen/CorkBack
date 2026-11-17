// Feature: posting-location-confirmation, Property 3 (edit part) and Property 17 (validator part). Pure, no network.
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { CATEGORIES } from "./categories";
import { localDate, timeZoneForPin } from "./lifecycle";
import { validatePostingEdit, type EditContext } from "./postingInput";

const NOW = new Date("2030-06-15T12:00:00Z");
const slugArb = fc.constantFrom(...CATEGORIES.map((c) => c.slug));
const latArb = fc.double({ min: -90, max: 90, noNaN: true });
const lngArb = fc.double({ min: -180, max: 180, noNaN: true });

const PINS = [
  { name: "Honolulu", lat: 21.3069, lng: -157.8583 },
  { name: "Auckland", lat: -36.8485, lng: 174.7633 },
  { name: "New York", lat: 40.7128, lng: -74.006 },
];
type Pin = (typeof PINS)[number];

const ctxFor = (p: Pin): EditContext => ({
  expiresAt: "2031-01-01T00:00:00Z",
  timeZone: timeZoneForPin(p.lat, p.lng),
  lat: p.lat,
  lng: p.lng,
});
const body = (slug: string, extra: Record<string, unknown> = {}) => ({
  title: "Edited posting",
  categorySlug: slug,
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
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const nowArb = fc.integer({ min: 0, max: 48 * 4 }).map((q) => new Date(NOW.getTime() + q * 15 * 60 * 1000));

describe("Property 17 (validator part): an edit with a location returns the new pin, precision and zone", () => {
  // **Validates: Requirements 13.6, 13.8**
  it("returns the submitted point, precision and the zone of that point", () => {
    fc.assert(
      fc.property(
        slugArb,
        latArb,
        lngArb,
        fc.constantFrom("exact", "approximate"),
        fc.constantFrom(...PINS),
        (slug, lat, lng, precision, stored) => {
          const r = validatePostingEdit(body(slug, { location: loc({ lat, lng, precision }) }), ctxFor(stored), NOW);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.value.location).toEqual({
            pin: { lat, lng },
            precision,
            timeZone: timeZoneForPin(lat, lng),
          });
        },
      ),
    );
  });

  it("returns location null when the body carries no location block", () => {
    fc.assert(
      fc.property(slugArb, fc.constantFrom(undefined, null), fc.constantFrom(...PINS), (slug, missing, stored) => {
        const extra = missing === null ? { location: null } : {};
        const r = validatePostingEdit(body(slug, extra), ctxFor(stored), NOW);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.location).toBeNull();
      }),
    );
  });

  it("rejects an unconfirmed, out-of-range or unknown-precision location", () => {
    const bad = [
      loc({ confirmed: false }),
      loc({ lat: 91 }),
      loc({ lng: -181 }),
      loc({ lat: NaN }),
      loc({ precision: "rough" }),
      loc({ source: "real" }),
      "x",
    ];
    for (const location of bad) {
      expect(validatePostingEdit(body("music", { location }), ctxFor(PINS[2]), NOW).ok).toBe(false);
    }
  });
});

describe("Property 3 (edit part): date rules are judged in the zone of the pin", () => {
  // **Validates: Requirements 12.5, 13.6**
  it("with a new location, an event date is past exactly when it is before the new pin's local date", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("music", "sports", "classes"),
        fc.constantFrom(...PINS),
        fc.constantFrom(...PINS),
        nowArb,
        fc.integer({ min: -3, max: 3 }),
        (slug, newPin, stored, now, offset) => {
          const tz = timeZoneForPin(newPin.lat, newPin.lng) as string;
          const eventDate = addDays(localDate(now, tz), offset);
          const r = validatePostingEdit(
            body(slug, { eventDate, location: loc({ lat: newPin.lat, lng: newPin.lng }) }),
            ctxFor(stored),
            now,
          );
          expect(r.ok).toBe(eventDate >= localDate(now, tz));
        },
      ),
    );
  });

  it("without a location, an event date is judged in the stored zone", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("music", "sports", "classes"),
        fc.constantFrom(...PINS),
        nowArb,
        fc.integer({ min: -3, max: 3 }),
        (slug, stored, now, offset) => {
          const tz = ctxFor(stored).timeZone as string;
          const eventDate = addDays(localDate(now, tz), offset);
          const r = validatePostingEdit(body(slug, { eventDate }), ctxFor(stored), now);
          expect(r.ok).toBe(eventDate >= localDate(now, tz));
        },
      ),
    );
  });

  it("a listing deadline is judged in the new pin's zone with a location, the stored zone without", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("jobs", "housing", "sale"),
        fc.constantFrom(...PINS),
        fc.constantFrom(...PINS),
        nowArb,
        fc.integer({ min: -3, max: 3 }),
        fc.boolean(),
        (slug, newPin, stored, now, offset, withLocation) => {
          const zonePin = withLocation ? newPin : stored;
          const tz = timeZoneForPin(zonePin.lat, zonePin.lng) as string;
          const deadline = addDays(localDate(now, tz), offset);
          const extra: Record<string, unknown> = { deadline };
          if (withLocation) extra.location = loc({ lat: newPin.lat, lng: newPin.lng });
          const r = validatePostingEdit(body(slug, extra), ctxFor(stored), now);
          expect(r.ok).toBe(deadline >= localDate(now, tz));
        },
      ),
    );
  });

  it("the same date passes under one new pin and fails under another", () => {
    // 2030-06-15T12:00Z is June 16 in Auckland and June 15 in Honolulu.
    const eventDate = "2030-06-15";
    const at = (p: Pin) =>
      validatePostingEdit(body("music", { eventDate, location: loc({ lat: p.lat, lng: p.lng }) }), ctxFor(PINS[2]), NOW).ok;
    expect(at(PINS[0])).toBe(true);
    expect(at(PINS[1])).toBe(false);
  });
});
