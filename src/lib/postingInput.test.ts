import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validatePostingInput } from "./postingInput";
import { CATEGORIES } from "./categories";
import { EXPIRY_PRESETS } from "./domain";

const now = new Date("2025-01-01T00:00:00Z");
const real = { lat: 51.5416, lng: -0.1426 };
const loc = (p: { lat: number; lng: number }, precision = "exact") => ({
  ...p,
  source: "search",
  confirmed: true,
  precision,
});
const base = () => ({
  title: "Jumble sale",
  categorySlug: CATEGORIES[0].slug,
  expiry: "1w",
  location: loc(real),
});

describe("validatePostingInput", () => {
  it("accepts a minimal valid body", () => {
    expect(validatePostingInput(base(), now).ok).toBe(true);
  });

  it("requires exactly one valid category", () => {
    expect(validatePostingInput({ ...base(), categorySlug: undefined }, now).ok).toBe(false);
    expect(validatePostingInput({ ...base(), categorySlug: "nope" }, now).ok).toBe(false);
    expect(validatePostingInput({ ...base(), categorySlug: [CATEGORIES[0].slug, CATEGORIES[1].slug] }, now).ok).toBe(false);
  });

  it("allows at most one RSVP link", () => {
    expect(validatePostingInput({ ...base(), rsvpUrl: "https://a.example/x" }, now).ok).toBe(true);
    expect(validatePostingInput({ ...base(), rsvpUrl: ["https://a.example", "https://b.example"] }, now).ok).toBe(false);
    expect(validatePostingInput({ ...base(), rsvpUrl: "https://a.example https://b.example" }, now).ok).toBe(false);
    expect(validatePostingInput({ ...base(), rsvpUrl: "javascript:alert(1)" }, now).ok).toBe(false);
  });

  it("requires a confirmed location and rejects bad presets", () => {
    const missing = "Choose where this takes place on the map before publishing.";
    expect(validatePostingInput({ ...base(), location: undefined }, now)).toEqual({ ok: false, error: missing });
    expect(validatePostingInput({ ...base(), location: { ...loc(real), confirmed: false } }, now)).toEqual({ ok: false, error: missing });
    expect(validatePostingInput({ ...base(), location: loc({ lat: NaN, lng: 0 }) }, now).ok).toBe(false);
    expect(validatePostingInput({ ...base(), location: { ...loc(real), source: "gps" } }, now).ok).toBe(false);
    expect(validatePostingInput({ ...base(), location: loc(real, "fuzzy") }, now).ok).toBe(false);
    expect(validatePostingInput({ ...base(), expiry: "2d" }, now).ok).toBe(false);
  });

  it("rejects the retired real and desired fields", () => {
    const { location: _l, ...rest } = base();
    expect(validatePostingInput({ ...rest, real, desired: real }, now)).toEqual({
      ok: false,
      error: "Reload the page and choose where this takes place.",
    });
  });

  it("returns the submitted point and precision", () => {
    const r = validatePostingInput({ ...base(), location: loc({ lat: 40.1, lng: -73.9 }, "approximate") }, now);
    expect(r.ok && [r.value.pin, r.value.precision]).toEqual([{ lat: 40.1, lng: -73.9 }, "approximate"]);
  });

  it("stores the posting's IANA time zone from the pin", () => {
    const r = validatePostingInput(base(), now);
    expect(r.ok && r.value.timeZone).toBe("Europe/London");
  });

  describe("event dates", () => {
    // 2026-11-17 03:00 UTC = 2026-11-16 19:00 in California.
    const at = new Date("2026-11-17T03:00:00Z");
    const berkeley = { lat: 37.8716, lng: -122.2727 };
    const ev = (over: Record<string, unknown>) => ({ ...base(), location: loc(berkeley), ...over });

    it("rejects a past event date", () => {
      const r = validatePostingInput(ev({ eventDate: "2024-11-16" }), at);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/already passed/);
    });

    it("accepts today in the posting's time zone even when UTC is already tomorrow", () => {
      expect(validatePostingInput(ev({ eventDate: "2026-11-16" }), at).ok).toBe(true);
    });

    it("rejects an explicit end that has already passed", () => {
      const r = validatePostingInput(ev({ eventDate: "2026-11-16", endTime: "12:00" }), at);
      expect(r.ok).toBe(false);
    });

    it("accepts a running multi-day event and keeps the end fields", () => {
      const r = validatePostingInput(ev({ eventDate: "2026-11-15", endDate: "2026-11-18", endTime: "17:30" }), at);
      expect(r.ok && [r.value.endDate, r.value.endTime, r.value.timeZone]).toEqual([
        "2026-11-18",
        "17:30",
        "America/Los_Angeles",
      ]);
    });

    it("rejects an end before the start, malformed values, and an end without a date", () => {
      expect(validatePostingInput(ev({ eventDate: "2026-11-20", endDate: "2026-11-19" }), at).ok).toBe(false);
      expect(validatePostingInput(ev({ eventDate: "2026-11-20", endTime: "7pm" }), at).ok).toBe(false);
      expect(validatePostingInput(ev({ eventDate: "2026-02-30" }), at).ok).toBe(false);
      expect(validatePostingInput(ev({ endTime: "18:00" }), at).ok).toBe(false);
    });

    it("requires confirmation when the flyer did not print a year", () => {
      const unconfirmed = validatePostingInput(ev({ eventDate: "2026-11-20", dateNeedsConfirmation: true }), at);
      expect(unconfirmed.ok).toBe(false);
      expect(!unconfirmed.ok && unconfirmed.error).toMatch(/year/);
      expect(
        validatePostingInput(ev({ eventDate: "2026-11-20", dateNeedsConfirmation: true, dateConfirmed: true }), at).ok,
      ).toBe(true);
    });
  });

  /** Validates: Requirements 1.1, 12.1 (the pin is exactly the confirmed point, at any distance) */
  it("property: expiry is after now for every preset and the pin is the submitted point", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EXPIRY_PRESETS),
        fc.record({ lat: fc.double({ min: -80, max: 80, noNaN: true }), lng: fc.double({ min: -179, max: 179, noNaN: true }) }),
        (expiry, r) => {
          const res = validatePostingInput({ ...base(), expiry, location: loc(r) }, now);
          if (!res.ok) return false;
          return res.value.expiresAt.getTime() > now.getTime() && res.value.pin.lat === r.lat && res.value.pin.lng === r.lng;
        },
      ),
    );
  });
});
