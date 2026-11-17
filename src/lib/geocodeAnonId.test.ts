import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ANON_ID_LABEL,
  NO_IP_FALLBACK,
  anonymousClientId,
  anonymousClientIdFromIp,
  readClientIp,
  resolvePurpose,
} from "./geocodePurpose";
import { cacheKey } from "./geocodeQuery";

/**
 * Property 26: Auth depends only on the resolved purpose (resolver part).
 *
 * `resolvePurpose` returns `"place"` only for the exact string `"place"`; every
 * other value, including `null`, resolves to `"posting"`.
 *
 * **Validates: Requirements 21.1**
 */
describe("Property 26: the purpose resolver returns 'place' only for exactly 'place'", () => {
  it("resolves the exact string 'place' to 'place'", () => {
    expect(resolvePurpose("place")).toBe("place");
  });

  it("resolves null and absent to 'posting'", () => {
    expect(resolvePurpose(null)).toBe("posting");
  });

  it("resolves every value other than exactly 'place' to 'posting'", () => {
    const otherArb = fc
      .oneof(
        fc.string(),
        fc.constantFrom("Place", "PLACE", " place", "place ", "places", "posting", "", "PLACe"),
      )
      .filter((s) => s !== "place");
    fc.assert(
      fc.property(otherArb, (raw) => {
        expect(resolvePurpose(raw)).toBe("posting");
      }),
    );
  });

  it("only ever returns one of the two purposes", () => {
    const rawArb = fc.oneof(fc.string(), fc.constant(null));
    fc.assert(
      fc.property(rawArb, (raw) => {
        const result = resolvePurpose(raw);
        expect(result === "place" || result === "posting").toBe(true);
        // `"place"` iff the exact string, otherwise `"posting"`.
        expect(result === "place").toBe(raw === "place");
      }),
    );
  });
});

/**
 * Property 29: The anonymous client id is an IP HMAC that never contains the IP.
 *
 * The id is 64 lowercase hex, equals `cacheKey(ip, "anon", secret)`, depends on
 * both the IP and the secret, and never contains the raw IP as a substring.
 *
 * **Validates: Requirements 21.8, 21.11**
 */
describe("Property 29: the anonymous client id is an IP HMAC that never contains the IP", () => {
  const secretArb = fc.string({ minLength: 32, maxLength: 64 });

  // IPs in the shapes a forwarded header carries: IPv4, IPv6, and the fallback.
  const ipArb = fc.oneof(
    fc
      .tuple(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
      )
      .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`),
    fc
      .array(fc.integer({ min: 0, max: 0xffff }), { minLength: 8, maxLength: 8 })
      .map((groups) => groups.map((g) => g.toString(16)).join(":")),
    fc.constant(NO_IP_FALLBACK),
  );

  it("is 64 lowercase hex", () => {
    fc.assert(
      fc.property(ipArb, secretArb, (ip, secret) => {
        expect(anonymousClientIdFromIp(ip, secret)).toMatch(/^[0-9a-f]{64}$/);
      }),
    );
  });

  it("equals cacheKey(ip, 'anon', secret)", () => {
    fc.assert(
      fc.property(ipArb, secretArb, (ip, secret) => {
        expect(anonymousClientIdFromIp(ip, secret)).toBe(cacheKey(ip, ANON_ID_LABEL, secret));
      }),
    );
  });

  it("never contains the raw IP as a substring", () => {
    fc.assert(
      fc.property(ipArb, secretArb, (ip, secret) => {
        const id = anonymousClientIdFromIp(ip, secret);
        expect(id.includes(ip)).toBe(false);
        // Also absent in lower case, since an IPv6 group may use hex letters.
        expect(id.includes(ip.toLowerCase())).toBe(false);
      }),
    );
  });

  it("is stable for the same IP and secret", () => {
    fc.assert(
      fc.property(ipArb, secretArb, (ip, secret) => {
        expect(anonymousClientIdFromIp(ip, secret)).toBe(anonymousClientIdFromIp(ip, secret));
      }),
    );
  });

  it("differs for a different secret", () => {
    fc.assert(
      fc.property(ipArb, secretArb, secretArb, (ip, s1, s2) => {
        fc.pre(s1 !== s2);
        expect(anonymousClientIdFromIp(ip, s1)).not.toBe(anonymousClientIdFromIp(ip, s2));
      }),
    );
  });

  it("differs for a different IP", () => {
    // `cacheKey` normalizes its first argument (lowercase, whitespace collapse),
    // so two IPs collide only when they normalize alike; exclude that case.
    const normalize = (s: string) => s.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");
    fc.assert(
      fc.property(ipArb, ipArb, secretArb, (ip1, ip2, secret) => {
        fc.pre(normalize(ip1) !== normalize(ip2));
        expect(anonymousClientIdFromIp(ip1, secret)).not.toBe(anonymousClientIdFromIp(ip2, secret));
      }),
    );
  });
});

/**
 * `readClientIp` order: the first entry of `x-forwarded-for`, else `x-real-ip`,
 * else the fixed fallback. Accepts a `Headers`-like object or a plain record.
 *
 * **Validates: Requirement 21.11**
 */
describe("readClientIp header precedence", () => {
  const ipTokenArb = fc
    .stringOf(fc.constantFrom(..."0123456789.:abcdef".split("")), { minLength: 1, maxLength: 20 })
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  it("takes the first x-forwarded-for entry when present", () => {
    fc.assert(
      fc.property(
        ipTokenArb,
        fc.array(ipTokenArb, { minLength: 0, maxLength: 4 }),
        ipTokenArb,
        (first, rest, realIp) => {
          const forwarded = [first, ...rest].join(", ");
          const ip = readClientIp({ "x-forwarded-for": forwarded, "x-real-ip": realIp });
          expect(ip).toBe(first);
        },
      ),
    );
  });

  it("falls back to x-real-ip when x-forwarded-for is absent or blank", () => {
    fc.assert(
      fc.property(ipTokenArb, fc.constantFrom(undefined, "", "   "), (realIp, forwarded) => {
        const headers: Record<string, string | undefined> = { "x-real-ip": realIp };
        if (forwarded !== undefined) headers["x-forwarded-for"] = forwarded;
        expect(readClientIp(headers)).toBe(realIp);
      }),
    );
  });

  it("falls back to the fixed string when no forwarded IP can be read", () => {
    expect(readClientIp({})).toBe(NO_IP_FALLBACK);
    expect(readClientIp({ "x-forwarded-for": "   ", "x-real-ip": "" })).toBe(NO_IP_FALLBACK);
  });

  it("reads a Headers-like object case-insensitively", () => {
    const headers = new Headers();
    headers.set("X-Forwarded-For", "203.0.113.7, 70.41.3.18");
    expect(readClientIp(headers)).toBe("203.0.113.7");
  });

  it("trims whitespace around the first forwarded entry", () => {
    expect(readClientIp({ "x-forwarded-for": "  198.51.100.9  , 10.0.0.1" })).toBe("198.51.100.9");
  });
});

/**
 * `anonymousClientId` reads the IP from headers and returns its id, never the IP.
 *
 * **Validates: Requirements 21.8, 21.11**
 */
describe("anonymousClientId composes readClientIp and the HMAC", () => {
  const secretArb = fc.string({ minLength: 32, maxLength: 64 });

  it("matches the id derived from the IP that readClientIp returns", () => {
    fc.assert(
      fc.property(
        fc.record({
          "x-forwarded-for": fc.option(fc.constantFrom("192.0.2.1, 10.0.0.1", "", "   "), {
            nil: undefined,
          }),
          "x-real-ip": fc.option(fc.constantFrom("198.51.100.5", ""), { nil: undefined }),
        }),
        secretArb,
        (headers, secret) => {
          const ip = readClientIp(headers);
          expect(anonymousClientId(headers, secret)).toBe(anonymousClientIdFromIp(ip, secret));
        },
      ),
    );
  });

  it("never returns the raw IP from the headers", () => {
    const secret = "a-test-secret-value-at-least-32-chars-long";
    const id = anonymousClientId({ "x-forwarded-for": "203.0.113.42, 10.0.0.1" }, secret);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id.includes("203.0.113.42")).toBe(false);
  });
});
