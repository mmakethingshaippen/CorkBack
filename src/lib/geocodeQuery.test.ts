import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildGeocodeUrl, prepareGeocodeQuery } from "./geocodeQuery";

const BASE = "https://nominatim.example.org/search";
const letters = "abcdefghijklmnopqrstuvwxyz";

/** Plain place words with no digits or @, so no contact details. */
const wordArb = fc.stringOf(fc.constantFrom(...letters.split("")), { minLength: 1, maxLength: 12 });
const placeArb = fc
  .array(wordArb, { minLength: 1, maxLength: 12 })
  .map((w) => w.join(" "))
  .filter((s) => s.length >= 3);
const spacedArb = fc
  .tuple(fc.constantFrom("", " ", "\t ", "\n"), placeArb, fc.constantFrom("", "  ", "\n\t"))
  .map(([a, b, c]) => a + b.replace(/ /g, "  ") + c);

describe("Property 18: the upstream request carries only the prepared query", () => {
  /** **Validates: Requirements 18.1, 18.2, 18.3, 18.4** */
  it("prepared query is trimmed, collapsed and capped at 200", () => {
    fc.assert(
      fc.property(spacedArb, (raw) => {
        const r = prepareGeocodeQuery(raw);
        const expected = raw.trim().replace(/\s+/g, " ").slice(0, 200);
        expect(r).toEqual({ ok: true, query: expected });
      }),
    );
  });

  it("URL q decodes to exactly the query; other params are fixed or the key; other text is absent", () => {
    fc.assert(
      fc.property(
        placeArb,
        fc.option(fc.record({ param: fc.constantFrom("key", "apikey"), value: fc.hexaString({ minLength: 8, maxLength: 20 }) }), {
          nil: undefined,
        }),
        fc.uuid(),
        (query, key, otherText) => {
          const url = new URL(buildGeocodeUrl(BASE, query, key));
          expect(url.searchParams.getAll("q")).toEqual([query]);
          const allowed = new Set(["q", "format", "addressdetails", "limit", "dedupe", ...(key ? [key.param] : [])]);
          for (const name of url.searchParams.keys()) expect(allowed.has(name)).toBe(true);
          expect(url.searchParams.get("format")).toBe("jsonv2");
          expect(url.toString()).not.toContain(otherText);
        },
      ),
    );
  });

  it("a key param named q cannot override the query", () => {
    const url = new URL(buildGeocodeUrl(BASE, "main street", { param: "q", value: "evil" }));
    expect(url.searchParams.getAll("q")).toEqual(["main street"]);
  });

  it("drops any query string already on the base", () => {
    const url = new URL(buildGeocodeUrl(`${BASE}?q=old&x=1`, "main street"));
    expect(url.searchParams.get("x")).toBeNull();
    expect(url.searchParams.get("q")).toBe("main street");
  });

  it("caps long input at 200 characters", () => {
    const r = prepareGeocodeQuery("a".repeat(500));
    expect(r).toEqual({ ok: true, query: "a".repeat(200) });
  });
});

describe("Property 20: a query with contact details is refused", () => {
  /** **Validates: Requirements 20.4** */
  const phoneArb = fc
    .tuple(fc.integer({ min: 200, max: 999 }), fc.integer({ min: 200, max: 999 }), fc.integer({ min: 1000, max: 9999 }))
    .map(([a, b, c]) => `(${a}) ${b}-${c}`);
  const emailArb = fc
    .tuple(wordArb, wordArb)
    .map(([u, d]) => `${u}@${d}.com`);

  it("refuses text containing a phone or email", () => {
    fc.assert(
      fc.property(placeArb, fc.oneof(phoneArb, emailArb), (place, contact) => {
        expect(prepareGeocodeQuery(`${place} ${contact}`)).toEqual({ ok: false, reason: "contains_contact" });
      }),
    );
  });

  it("accepts contact-free text of 3+ characters", () => {
    fc.assert(
      fc.property(placeArb, (place) => {
        expect(prepareGeocodeQuery(place).ok).toBe(true);
      }),
    );
  });

  it("refuses text shorter than 3 characters", () => {
    expect(prepareGeocodeQuery("  ab ")).toEqual({ ok: false, reason: "too_short" });
  });
});
