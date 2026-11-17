// Feature: posting-location-confirmation, Property 13: Address leaks are found in any field and nowhere else
// **Validates: Requirements 10.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.12**
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canPublishWithLeaks, findAddressLeaks, type LeakInput } from "@/lib/addressLeaks";
import type { AddressCandidate } from "@/lib/addressCandidates";

const FIELDS = ["title", "body", "placeLabel"] as const;
type Field = (typeof FIELDS)[number];

const word = fc.stringMatching(/^[a-z]{3,8}$/);
const filler = fc.array(word, { maxLength: 4 }).map((w) => w.join(" "));
const field = fc.constantFrom<Field>(...FIELDS);
const suffix = fc.constantFrom("street", "avenue", "road", "lane", "drive");
// Street names are made of words that are not street suffixes or directions.
const streetName = fc
  .array(word.filter((w) => !/^(street|avenue|road|boulevard|drive|lane|court|way|place|terrace|parkway|highway|north|south|east|west|circle|square|st|ave|rd|dr|ln|ct|pl|ter|sq|blvd|hwy|pkwy|cir)$/.test(w)), {
    minLength: 1,
    maxLength: 2,
  })
  .map((w) => w.join(" "));
const streetLine = fc
  .tuple(fc.integer({ min: 1, max: 99999 }), streetName, suffix)
  .map(([n, name, s]) => `${n} ${name} ${s}`);
const phone = fc.constantFrom("555-123-4567", "(555) 123-4567", "555.123.4567", "+1 555 123 4567");
const email = fc
  .tuple(fc.stringMatching(/^[a-z]{3,8}$/), fc.stringMatching(/^[a-z]{3,8}$/))
  .map(([a, b]) => `${a}@${b}.com`);

/** Same address with different case and commas between words. */
const disguise = (s: string, upper: boolean) => (upper ? s.toUpperCase() : s).split(" ").join(", ");

function input(f: Field, text: string): LeakInput {
  return { title: "", body: "", placeLabel: "", [f]: text };
}
const cand = (text: string): AddressCandidate => ({ text, kind: "contact" });

describe("Property 13: address leaks", () => {
  it("reports a candidate in any field, whatever the case, punctuation and surrounding text", () => {
    fc.assert(
      fc.property(streetLine, field, filler, filler, fc.boolean(), (addr, f, pre, post, upper) => {
        const text = `${pre} ${disguise(addr, upper)} ${post}`;
        const leaks = findAddressLeaks(input(f, text), [cand(addr)], null, "exact");
        expect(leaks.some((l) => l.field === f)).toBe(true);
        expect(leaks.every((l) => l.field === f)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("does not report the confirmed street line with exact precision, and reports it with approximate", () => {
    fc.assert(
      fc.property(streetLine, field, filler, filler, (addr, f, pre, post) => {
        const text = `${pre} ${addr} ${post}`;
        const confirmed = { addressLine: addr };
        expect(findAddressLeaks(input(f, text), [cand(addr)], confirmed, "exact")).toEqual([]);
        const approx = findAddressLeaks(input(f, text), [cand(addr)], confirmed, "approximate");
        expect(approx.some((l) => l.field === f)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("reports nothing for text without a candidate or a house number plus street word", () => {
    fc.assert(
      fc.property(filler, filler, filler, (a, b, c) => {
        expect(findAddressLeaks({ title: a, body: b, placeLabel: c }, [], null, "exact")).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("reports a street pattern even when no candidate lists it", () => {
    fc.assert(
      fc.property(streetLine, field, filler, (addr, f, pre) => {
        const leaks = findAddressLeaks(input(f, `${pre} ${addr}`), [], null, "exact");
        expect(leaks.some((l) => l.field === f && l.reason === "pattern")).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("reports phones and emails in any field whatever the confirmed place and precision", () => {
    fc.assert(
      fc.property(
        fc.oneof(phone.map((t) => ({ t, k: "phone" as const })), email.map((t) => ({ t, k: "email" as const }))),
        field,
        filler,
        filler,
        streetLine,
        fc.constantFrom<"exact" | "approximate">("exact", "approximate"),
        fc.boolean(),
        ({ t, k }, f, pre, post, addr, precision, withConfirmed) => {
          const confirmed = withConfirmed ? { addressLine: addr } : null;
          const leaks = findAddressLeaks(input(f, `${pre} ${t} ${post}`), [], confirmed, precision);
          expect(leaks.some((l) => l.field === f && l.reason === k)).toBe(true);
          // After the flagged text is removed, nothing is reported.
          expect(findAddressLeaks(input(f, `${pre} ${post}`), [], confirmed, precision)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never changes its input, and venue address, phone and email stay in the text", () => {
    fc.assert(
      fc.property(
        streetLine,
        phone,
        email,
        filler,
        fc.constantFrom<"exact" | "approximate">("exact", "approximate"),
        (addr, ph, em, pre, precision) => {
          const title = `${pre} ${addr}`;
          const body = `Call ${ph} or write ${em}`;
          const placeLabel = addr;
          const before = [title, body, placeLabel];
          findAddressLeaks({ title, body, placeLabel }, [cand(addr)], { addressLine: addr }, precision);
          expect([title, body, placeLabel]).toEqual(before);
          expect(title).toContain(addr);
          expect(body).toContain(ph);
          expect(body).toContain(em);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("canPublishWithLeaks is true exactly when leaks is empty or acknowledged", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), fc.boolean(), (n, ack) => {
        const leaks = Array.from({ length: n }, () => ({ field: "body" as const, text: "x", reason: "pattern" as const }));
        expect(canPublishWithLeaks(leaks, ack)).toBe(n === 0 || ack);
      }),
      { numRuns: 100 },
    );
  });
});
