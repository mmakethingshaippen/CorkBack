import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cacheKey, normalizeForCache } from "./geocodeQuery";

/** **Validates: Requirements 18.5, 18.6** */
describe("Property 23: the cache key is an HMAC and never contains the query", () => {
  const secretArb = fc.string({ minLength: 32, maxLength: 64 });
  const hostArb = fc.constantFrom("nominatim.example.org", "geo.example.com", "photon.example.net");
  const queryArb = fc
    .stringOf(fc.constantFrom(..."ghijklmnopqrstuvwxyz ,".split("")), { minLength: 4, maxLength: 60 })
    .filter((s) => s.trim().length >= 4);

  it("is 64 lowercase hex and does not contain the normalized query", () => {
    fc.assert(
      fc.property(queryArb, hostArb, secretArb, (q, host, secret) => {
        const key = cacheKey(q, host, secret);
        expect(key).toMatch(/^[0-9a-f]{64}$/);
        const n = normalizeForCache(q);
        if (n.length >= 4) expect(key.includes(n)).toBe(false);
      }),
    );
  });

  it("is equal for queries differing only in case and whitespace", () => {
    fc.assert(
      fc.property(queryArb, hostArb, secretArb, (q, host, secret) => {
        const variant = "  " + q.toUpperCase().replace(/ /g, "   ") + "\n";
        expect(cacheKey(variant, host, secret)).toBe(cacheKey(q, host, secret));
      }),
    );
  });

  it("differs for a different secret, host, or normalized query", () => {
    fc.assert(
      fc.property(queryArb, queryArb, secretArb, secretArb, (q1, q2, s1, s2) => {
        fc.pre(s1 !== s2);
        expect(cacheKey(q1, "geo.example.com", s1)).not.toBe(cacheKey(q1, "geo.example.com", s2));
        expect(cacheKey(q1, "geo.example.com", s1)).not.toBe(cacheKey(q1, "photon.example.net", s1));
        fc.pre(normalizeForCache(q1) !== normalizeForCache(q2));
        expect(cacheKey(q1, "geo.example.com", s1)).not.toBe(cacheKey(q2, "geo.example.com", s1));
      }),
    );
  });
});
