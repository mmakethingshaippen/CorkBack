import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  MAX_CANDIDATES,
  MAX_CANDIDATE_TEXT,
  normalizeAddressCandidates,
  normalizeAddressText,
  parseStoredExtraction,
  serializeExtraction,
} from "@/lib/addressCandidates";
import type { ExtractedFlyer } from "@/lib/types";
import { FX_FLYER_HOME, FX_FLYER_NONE, FX_FLYER_THREE } from "@/lib/__fixtures__/location";

const RUNS = { numRuns: 200 };
const KINDS = ["venue", "contact", "return", "other", "unknown"];

// Text drawn from a small alphabet so duplicates by normalized text are common.
const addrText = fc.oneof(
  fc.string({ maxLength: 260 }),
  fc.stringMatching(/^[ ]{0,2}(12|12\.)? ?(Main|main|MAIN) ?(St|st\.|Street|street)?,? ?[ ]{0,2}$/),
  fc.string({ minLength: 195, maxLength: 260 }),
);
const rawItem = fc.oneof(
  fc.record({ text: addrText, kind: fc.oneof(fc.constantFrom(...KINDS), fc.string(), fc.integer(), fc.constant(null)) }),
  fc.record({ text: addrText }),
  fc.jsonValue(),
);
const rawList = fc.array(rawItem, { maxLength: 12 });

describe("Property 4: Address candidates are bounded and well-formed", () => {
  /** **Validates: Requirements 2.3, 2.4** */
  it("returns a bounded, well-formed, deduplicated list for any array", () => {
    fc.assert(
      fc.property(rawList, (raw) => {
        const out = normalizeAddressCandidates(raw);
        expect(out.length).toBeLessThanOrEqual(MAX_CANDIDATES);
        const keys = new Set<string>();
        for (const c of out) {
          expect(typeof c.text).toBe("string");
          expect(c.text.length).toBeGreaterThan(0);
          expect(c.text.length).toBeLessThanOrEqual(MAX_CANDIDATE_TEXT);
          expect(KINDS).toContain(c.kind);
          const key = normalizeAddressText(c.text);
          expect(key).not.toBe("");
          expect(keys.has(key)).toBe(false);
          keys.add(key);
        }
      }),
      RUNS,
    );
  });

  it("never throws and returns [] for any non-list value", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.jsonValue(), fc.constant(undefined), fc.anything()).filter((v) => !Array.isArray(v)),
        (v) => {
          expect(normalizeAddressCandidates(v)).toEqual([]);
        },
      ),
      RUNS,
    );
  });

  it("returns [] for lists with no object that has text", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constant(null),
            fc.integer(),
            fc.string(),
            fc.array(fc.string()),
            fc.record({ text: fc.oneof(fc.integer(), fc.constant(null), fc.constant("   ")) }),
            fc.record({ kind: fc.constantFrom(...KINDS) }),
          ),
          { maxLength: 10 },
        ),
        (raw) => {
          expect(normalizeAddressCandidates(raw)).toEqual([]);
        },
      ),
      RUNS,
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(rawList, (raw) => {
        const once = normalizeAddressCandidates(raw);
        expect(normalizeAddressCandidates(once)).toEqual(once);
      }),
      RUNS,
    );
  });

  it("dedupes street-suffix variants and keeps the first", () => {
    const out = normalizeAddressCandidates([
      { text: "12 Main St.", kind: "venue" },
      { text: "12 main street", kind: "return" },
    ]);
    expect(out).toEqual([{ text: "12 Main St.", kind: "venue" }]);
  });

  it("keeps the fixture flyers' candidates unchanged", () => {
    for (const f of [FX_FLYER_HOME, FX_FLYER_THREE, FX_FLYER_NONE]) {
      expect(normalizeAddressCandidates(f.addresses)).toEqual(f.addresses);
    }
  });
});

const candidates = rawList.map((r) => normalizeAddressCandidates(r));
const nullableStr = fc.oneof(fc.string({ maxLength: 40 }), fc.constant(null));

const flyer: fc.Arbitrary<ExtractedFlyer> = fc
  .record(
    {
      title: fc.string({ maxLength: 80 }),
      eventDate: nullableStr,
      eventTime: nullableStr,
      placeLabel: fc.string({ maxLength: 60 }),
      categorySlug: fc.string({ maxLength: 20 }),
      rsvpUrl: nullableStr,
      body: fc.string({ maxLength: 200 }),
      eventDateYearPrinted: fc.boolean(),
      addresses: candidates,
    },
    { requiredKeys: ["title", "eventDate", "eventTime", "placeLabel", "categorySlug", "rsvpUrl", "body"] },
  )
  .map((x) => x as ExtractedFlyer);

describe("Property 5: Saved extraction round trip", () => {
  /** **Validates: Requirements 2.7, 2.8** */
  it("round-trips any valid extraction, reading a missing addresses as []", () => {
    fc.assert(
      fc.property(flyer, (x) => {
        const back = parseStoredExtraction(serializeExtraction(x));
        expect(back).toEqual({ ...x, addresses: x.addresses ?? [] });
      }),
      RUNS,
    );
  });

  it("returns null without throwing for any arbitrary string", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json().map((j) => j)), (s) => {
        const r = parseStoredExtraction(s);
        if (r !== null) {
          // Only a JSON object with a string title may parse.
          const o = JSON.parse(s);
          expect(typeof o.title).toBe("string");
        }
      }),
      RUNS,
    );
  });

  it("returns null for null, empty, non-objects and objects without a string title", () => {
    expect(parseStoredExtraction(null)).toBeNull();
    expect(parseStoredExtraction("")).toBeNull();
    expect(parseStoredExtraction("{not json")).toBeNull();
    expect(parseStoredExtraction("[]")).toBeNull();
    expect(parseStoredExtraction("42")).toBeNull();
    expect(parseStoredExtraction("null")).toBeNull();
    expect(parseStoredExtraction(JSON.stringify({ title: 5 }))).toBeNull();
    expect(parseStoredExtraction(JSON.stringify({ title: "t", eventDate: 5 }))).toBeNull();
    expect(parseStoredExtraction(JSON.stringify({ title: "t", body: 5 }))).toBeNull();
    expect(parseStoredExtraction(JSON.stringify({ title: "t", eventDateYearPrinted: "yes" }))).toBeNull();
  });

  it("reads an old extraction without addresses as []", () => {
    const old = { title: "t", eventDate: null, eventTime: null, placeLabel: "", categorySlug: "", rsvpUrl: null, body: "" };
    expect(parseStoredExtraction(JSON.stringify(old))).toEqual({ ...old, addresses: [] });
  });
});
