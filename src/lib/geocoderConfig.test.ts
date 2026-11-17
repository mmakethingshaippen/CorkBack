import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveGeocoderConfig, isValidUserAgent } from "./geocoderConfig";

const GOOD_UA = "CorkBack/1.0 (contact: ops@corkback.example)";
const GOOD_SECRET = "s".repeat(40);

function validEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    GEOCODER_USER_AGENT: GOOD_UA,
    GEOCODER_CACHE_SECRET: GOOD_SECRET,
  };
}

// Each breaker removes or corrupts one required condition.
const breakers: Array<(e: Record<string, string | undefined>, s: string) => void> = [
  (e, s) => { e.NEXT_PUBLIC_SUPABASE_URL = s.trim() === "" ? undefined : ""; },
  (e) => { delete e.SUPABASE_SERVICE_ROLE_KEY; },
  (e, s) => { e.GEOCODER_URL = "http://" + (s.replace(/\W/g, "") || "x") + ".example/search"; },
  (e) => { e.GEOCODER_URL = "not a url"; },
  (e) => { delete e.GEOCODER_USER_AGENT; },
  (e, s) => { e.GEOCODER_USER_AGENT = s.replace(/[@/(]/g, "") || "x"; },
  (e) => { delete e.GEOCODER_CACHE_SECRET; },
  (e, s) => { e.GEOCODER_CACHE_SECRET = s.slice(0, 31); },
];

describe("resolveGeocoderConfig (Property 24, config part)", () => {
  /** **Validates: Requirements 19.7, 19.9** */
  it("is disabled whenever any condition is broken, and the reason never leaks secrets", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: breakers.length - 1 }),
        fc.string({ minLength: 0, maxLength: 60 }),
        fc.stringMatching(/^[A-Za-z0-9]{33,60}$/),
        fc.stringMatching(/^[A-Za-z0-9]{12,30}$/),
        (i, junk, secret, apiKey) => {
          const env = validEnv();
          env.GEOCODER_API_KEY = apiKey;
          env.GEOCODER_CACHE_SECRET = secret.padEnd(32, "x");
          breakers[i](env, junk);
          // keep the secret for the leak check unless the breaker changed it
          const cfg = resolveGeocoderConfig(env);
          expect(cfg.enabled).toBe(false);
          if (!cfg.enabled) {
            const text = JSON.stringify(cfg);
            const s = (env.GEOCODER_CACHE_SECRET ?? "").trim();
            // Short junk values can occur inside the fixed reason text by chance; only real-length secrets are checked.
            if (s.length >= 16) expect(text).not.toContain(s);
            expect(text).not.toContain(apiKey);
            expect(text).not.toContain("service-role-key");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never throws on arbitrary string environments", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom(
            "NEXT_PUBLIC_SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "GEOCODER_URL",
            "GEOCODER_USER_AGENT",
            "GEOCODER_CACHE_SECRET",
            "GEOCODER_API_KEY",
          ),
          fc.option(fc.string(), { nil: undefined }),
        ),
        (env) => {
          const cfg = resolveGeocoderConfig(env);
          if (!cfg.enabled) {
            expect(["no_supabase", "bad_endpoint", "bad_user_agent", "no_cache_secret"]).toContain(cfg.reason);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is enabled for a fully valid environment", () => {
    const cfg = resolveGeocoderConfig(validEnv());
    expect(cfg.enabled).toBe(true);
    if (cfg.enabled) expect(cfg.publicNominatim).toBe(true);
  });

  it("whitespace padding does not count toward secret length", () => {
    const env = validEnv();
    env.GEOCODER_CACHE_SECRET = "a".repeat(10) + " ".repeat(40);
    expect(resolveGeocoderConfig(env)).toEqual({ enabled: false, reason: "no_cache_secret" });
  });
});

describe("isValidUserAgent", () => {
  it.each([
    "CorkBack/1.0 (contact: ops@corkback.example)",
    "CorkBack/2.3.1 (https://corkback.example/contact)",
    "my-app/0.1 (admin@example.org)",
  ])("accepts %s", (ua) => expect(isValidUserAgent(ua)).toBe(true));

  it.each([
    undefined,
    "",
    "CorkBack",
    "CorkBack/1.0",
    "CorkBack/1.0 (no contact here)",
    "CorkBack/1.0 (http://insecure.example)",
    "Mozilla (ops@example.com)",
    "CorkBack/1.0 (ops@example.com)\r\nX-Evil: 1",
    "CorkBack/1.0 (ops@example.com" + "a".repeat(300) + ")",
  ])("rejects %j", (ua) => expect(isValidUserAgent(ua)).toBe(false));
});
