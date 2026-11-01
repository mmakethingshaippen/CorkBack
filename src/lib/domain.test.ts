import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  isValidUsername,
  USERNAME_RE,
  computeExpiresAt,
  effectiveTakedown,
  clampPinNudge,
  haversineMeters,
  MAX_NUDGE_METERS,
  cardTilt,
  TILT_MIN,
  TILT_MAX,
  EXPIRY_PRESETS,
  type ExpiryPreset,
} from "./domain";

// ---------------------------------------------------------------------------
// Property 1 (LOCKED): username rule. A username is valid IFF it is 3-20
// characters of letters, numbers, underscore only.
// ---------------------------------------------------------------------------
describe("username rule (property)", () => {
  it("accepts any string of 3-20 chars from [A-Za-z0-9_]", () => {
    fc.assert(
      fc.property(
        fc.stringOf(
          fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_".split("")),
          { minLength: 3, maxLength: 20 },
        ),
        (name) => isValidUsername(name) === true,
      ),
    );
  });

  it("rejects wrong length or any disallowed character", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const expected = /^[A-Za-z0-9_]{3,20}$/.test(s);
        return isValidUsername(s) === expected;
      }),
    );
  });

  it("validator agrees with the shared regex", () => {
    fc.assert(
      fc.property(fc.string(), (s) => isValidUsername(s) === USERNAME_RE.test(s)),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 (LOCKED): a posting always expires after its preset.
// expires_at = created_at + preset, and the event-date takedown is never later
// than the preset expiry.
// ---------------------------------------------------------------------------
describe("expiry rule (property)", () => {
  it("expires_at is strictly after created_at for every preset", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
        fc.constantFrom<ExpiryPreset>(...EXPIRY_PRESETS),
        (createdAt, preset) => {
          const exp = computeExpiresAt(createdAt, preset);
          return exp.getTime() > createdAt.getTime();
        },
      ),
    );
  });

  it("event-date takedown is never later than preset expiry", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
        fc.constantFrom<ExpiryPreset>(...EXPIRY_PRESETS),
        fc.date({ min: new Date("2020-01-01"), max: new Date("2031-01-01") }),
        (createdAt, preset, eventDate) => {
          const exp = computeExpiresAt(createdAt, preset);
          const takedown = effectiveTakedown(exp, eventDate);
          return takedown.getTime() <= exp.getTime();
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 (LOCKED): a pin always stays near the poster location. After
// clamping, the pin is within MAX_NUDGE_METERS of the real location.
// ---------------------------------------------------------------------------
describe("pin nudge rule (property)", () => {
  const coord = fc.record({
    lat: fc.double({ min: -60, max: 60, noNaN: true }),
    lng: fc.double({ min: -179, max: 179, noNaN: true }),
  });

  it("clamped pin is always within MAX_NUDGE_METERS of the real location", () => {
    fc.assert(
      fc.property(coord, coord, (real, desired) => {
        const pinned = clampPinNudge(real, desired);
        // allow 1m slack for float/linear-interp error at this small scale
        return haversineMeters(real, pinned) <= MAX_NUDGE_METERS + 1;
      }),
    );
  });

  it("a desired pin already within bounds is kept unchanged", () => {
    const real = { lat: 51.5416, lng: -0.1426 }; // North London
    const pinned = clampPinNudge(real, real);
    expect(pinned).toEqual(real);
  });
});

// ---------------------------------------------------------------------------
// Choice B (LOCKED): card tilt is uneven 2deg..8deg, and adjacent cards never
// form a mirrored pair.
// ---------------------------------------------------------------------------
describe("card tilt rule (Choice B, property)", () => {
  it("magnitude is always within [2,8] degrees", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (id) => {
        const t = cardTilt(id, null);
        const m = Math.abs(t);
        return m >= TILT_MIN - 0.001 && m <= TILT_MAX + 0.001;
      }),
    );
  });

  it("adjacent cards never form a mirrored pair", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (idA, idB) => {
        const a = cardTilt(idA, null);
        const b = cardTilt(idB, a);
        const mirrored =
          Math.abs(Math.abs(a) - Math.abs(b)) < 0.05 && Math.sign(a) !== Math.sign(b);
        return !mirrored;
      }),
    );
  });
});
