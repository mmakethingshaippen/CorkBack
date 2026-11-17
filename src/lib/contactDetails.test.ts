import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { findContactDetails, hasContactDetails } from "./contactDetails";
import { FX_CONTACT_STRINGS, FX_LOOKALIKE_STRINGS } from "./__fixtures__/location";

// Feature: posting-location-confirmation, Property 19: Phone numbers and email addresses are found, and ordinary numbers are not
// **Validates: Requirements 11.7, 11.8, 11.9**

const digits = (n: number) =>
  fc.array(fc.integer({ min: 0, max: 9 }), { minLength: n, maxLength: n }).map((a) => a.join(""));
const lead = fc.integer({ min: 2, max: 9 }).map(String);
// Surrounding text never has a digit, currency sign, comma or separator touching the match.
const around = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz ".split("")), { maxLength: 12 })
  .map((a) => a.join(""));

const phone = fc.oneof(
  fc.tuple(lead, digits(2), digits(3), digits(4)).map(([a, b, c, d]) => `${a}${b}-${c}-${d}`),
  fc.tuple(lead, digits(2), digits(3), digits(4)).map(([a, b, c, d]) => `(${a}${b}) ${c}-${d}`),
  fc.tuple(lead, digits(2), digits(3), digits(4)).map(([a, b, c, d]) => `${a}${b}.${c}.${d}`),
  fc
    .tuple(fc.integer({ min: 1, max: 99 }), lead, digits(2), digits(3), digits(4))
    .map(([cc, a, b, c, d]) => `+${cc} ${a}${b} ${c} ${d}`),
  fc.tuple(digits(3), digits(4)).map(([c, d]) => `${c}-${d}`),
);

const email = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9][a-z0-9._+-]{0,10}$/),
    fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
    fc.stringMatching(/^[a-z]{2,6}$/),
  )
  .map(([l, d, t]) => `${l}@${d}.${t}`);

const time = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${h}:${String(m).padStart(2, "0")}`);
const two = (n: number) => String(n).padStart(2, "0");
const dateParts = fc.tuple(
  fc.integer({ min: 1900, max: 2099 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }),
);
const date = fc.oneof(
  dateParts.map(([y, m, d]) => `${y}-${two(m)}-${two(d)}`),
  dateParts.map(([y, m, d]) => `${two(m)}/${two(d)}/${y}`),
  dateParts.map(([y, m, d]) => `${two(d)}.${two(m)}.${y}`),
);
const price = fc
  .tuple(fc.integer({ min: 1, max: 999 }), digits(3), digits(2))
  .map(([a, b, c]) => `$${a},${b}.${c}`);
const year = fc.integer({ min: 1800, max: 2099 }).map(String);
const postcode = fc.oneof(
  digits(5),
  fc.tuple(digits(5), digits(4)).map(([a, b]) => `${a}-${b}`),
);
const lookalike = fc.oneof(time, date, price, year, postcode);

describe("findContactDetails (Property 19)", () => {
  it("finds a phone number in any listed form with non-digit surrounding text", () => {
    fc.assert(
      fc.property(around, phone, around, (pre, p, post) => {
        const text = `${pre} ${p} ${post}`;
        return findContactDetails(text).some((m) => m.kind === "phone");
      }),
    );
  });

  it("finds an email address", () => {
    fc.assert(
      fc.property(around, email, around, (pre, e, post) => {
        const text = `${pre} ${e} ${post}`;
        return findContactDetails(text).some((m) => m.kind === "email");
      }),
    );
  });

  it("reports nothing for times, dates, prices, years and postcodes", () => {
    fc.assert(
      fc.property(around, lookalike, around, (pre, l, post) => {
        return findContactDetails(`${pre} ${l} ${post}`).length === 0;
      }),
    );
  });

  it("never throws and never changes its input", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (s) => {
        const copy = `${s}`;
        const r = findContactDetails(s);
        return s === copy && Array.isArray(r) && typeof hasContactDetails(s) === "boolean";
      }),
    );
  });

  it("reports matches whose text sits at the reported index", () => {
    fc.assert(
      fc.property(around, phone, email, (pre, p, e) => {
        const text = `${pre} ${p} and ${e}`;
        return findContactDetails(text).every((m) => text.slice(m.index, m.index + m.text.length) === m.text);
      }),
    );
  });

  it.each([
    ["7:30"],
    ["2025-06-14"],
    ["06/14/2025"],
    ["$1,250.00"],
    ["2025"],
    ["94704"],
    ["94704-1234"],
  ])("does not flag %s", (s) => {
    expect(findContactDetails(s)).toEqual([]);
  });

  it.each([["510-555-0142"], ["(510) 555-0142"], ["+1 510 555 0142"], ["555-0142"]])(
    "flags %s as a phone",
    (s) => {
      const r = findContactDetails(s);
      expect(r).toHaveLength(1);
      expect(r[0].kind).toBe("phone");
    },
  );

  it("flags every contact fixture and no look-alike fixture", () => {
    for (const s of FX_CONTACT_STRINGS) expect(hasContactDetails(s), s).toBe(true);
    for (const s of FX_LOOKALIKE_STRINGS) expect(hasContactDetails(s), s).toBe(false);
  });

  it("returns an empty list for empty input", () => {
    expect(findContactDetails("")).toEqual([]);
  });
});
