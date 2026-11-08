import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validatePostingInput } from "./postingInput";
import { CATEGORIES } from "./categories";
import { EXPIRY_PRESETS, haversineMeters, MAX_NUDGE_METERS } from "./domain";

const now = new Date("2025-01-01T00:00:00Z");
const real = { lat: 51.5416, lng: -0.1426 };
const base = () => ({
  title: "Jumble sale",
  categorySlug: CATEGORIES[0].slug,
  expiry: "1w",
  real,
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

  it("requires a poster location and rejects bad presets", () => {
    expect(validatePostingInput({ ...base(), real: undefined }, now).ok).toBe(false);
    expect(validatePostingInput({ ...base(), real: { lat: NaN, lng: 0 } }, now).ok).toBe(false);
    expect(validatePostingInput({ ...base(), expiry: "2d" }, now).ok).toBe(false);
  });

  it("result never carries the raw location", () => {
    const r = validatePostingInput({ ...base(), desired: { lat: real.lat + 1, lng: real.lng } }, now);
    expect(r.ok && JSON.stringify(r.value)).not.toContain(String(real.lat));
  });

  /** Validates: Requirements 4.3, 4.5 */
  it("property: expiry is after now for every preset and pin is within bound", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...EXPIRY_PRESETS),
        fc.record({ lat: fc.double({ min: -80, max: 80, noNaN: true }), lng: fc.double({ min: -179, max: 179, noNaN: true }) }),
        fc.record({ lat: fc.double({ min: -80, max: 80, noNaN: true }), lng: fc.double({ min: -179, max: 179, noNaN: true }) }),
        (expiry, r, d) => {
          const res = validatePostingInput({ ...base(), expiry, real: r, desired: d }, now);
          if (!res.ok) return false;
          return (
            res.value.expiresAt.getTime() > now.getTime() &&
            haversineMeters(r, res.value.pin) <= MAX_NUDGE_METERS + 1
          );
        },
      ),
    );
  });
});
