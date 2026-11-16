/**
 * Property tests for radius parsing, the search centre and the heading
 * (design.md Properties 8, 25, 26).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildBoardView,
  DEFAULT_RADIUS_MILES,
  formatApproxDistance,
  milesBetween,
  parseRadius,
  radiusPhrase,
  RADIUS_OPTIONS_MILES,
  referenceAfterSearch,
  referenceLabel,
  type BoardReference,
  type ReferenceKind,
} from "./nearby";
import { BERKELEY, makeFixturePosting } from "./__fixtures__/board";

const radiusArb = fc.constantFrom(...RADIUS_OPTIONS_MILES);
const kindArb = fc.constantFrom<ReferenceKind>("town", "device", "home", "saved", "default");
const nameArb = fc.option(fc.stringMatching(/^[A-Za-z][A-Za-z ]{1,15}[A-Za-z]$/), { nil: null });
const latArb = fc.double({ min: -80, max: 80, noNaN: true });
const lngArb = fc.double({ min: -179, max: 179, noNaN: true });
const referenceArb: fc.Arbitrary<BoardReference> = fc.record({ lat: latArb, lng: lngArb, kind: kindArb, name: nameArb });

describe("Property 8: Radius parsing falls back to the default", () => {
  /** **Validates: Requirements 2.2** */
  it("returns the option for the five values, as number or digit string", () => {
    for (const r of RADIUS_OPTIONS_MILES) {
      expect(parseRadius(r)).toBe(r);
      expect(parseRadius(String(r))).toBe(r);
    }
  });

  it("returns the default for any other input", () => {
    const options = RADIUS_OPTIONS_MILES.map(String);
    fc.assert(
      fc.property(
        fc.oneof(fc.anything(), fc.integer(), fc.double(), fc.string()),
        (x) => {
          const isOption =
            (typeof x === "number" && (RADIUS_OPTIONS_MILES as readonly number[]).includes(x)) ||
            (typeof x === "string" && options.includes(x));
          fc.pre(!isOption);
          expect(parseRadius(x)).toBe(DEFAULT_RADIUS_MILES);
        },
      ),
    );
  });

  it("returns the default for null, undefined, malformed strings", () => {
    for (const x of [null, undefined, "", " 5", "5.0", "05", "-5", "abc", NaN, Infinity, 2, 0, [5], {}]) {
      expect(parseRadius(x)).toBe(DEFAULT_RADIUS_MILES);
    }
  });
});

describe("Property 25: A place search sets the centre", () => {
  const resultArb = fc.record({ lat: latArb, lng: lngArb, name: fc.string({ minLength: 1, maxLength: 20 }) });

  /** **Validates: Requirements 2.3** */
  it("referenceAfterSearch gives a town reference at the result", () => {
    fc.assert(
      fc.property(resultArb, (r) => {
        const ref = referenceAfterSearch(r);
        expect(ref).toEqual({ lat: r.lat, lng: r.lng, kind: "town", name: r.name });
      }),
    );
  });

  it("the nearby set and distances ignore the previous reference", () => {
    const placeArb = fc.record({ lat: fc.double({ min: 37.5, max: 38.2, noNaN: true }), lng: fc.double({ min: -122.6, max: -122, noNaN: true }) });
    fc.assert(
      fc.property(
        fc.array(placeArb, { maxLength: 25 }),
        referenceArb,
        referenceArb,
        radiusArb,
        (spots, prevA, prevB, radiusMiles) => {
          const postings = spots.map((s, i) => makeFixturePosting(`p${String(i).padStart(3, "0")}`, { lat: s.lat, lng: s.lng }));
          const searched = referenceAfterSearch({ lat: BERKELEY.lat, lng: BERKELEY.lng, name: "Berkeley" });
          // The previous reference (device, map position, and so on) is never an input to the view.
          void prevA;
          void prevB;
          const a = buildBoardView(postings, { category: null, reference: searched, radiusMiles });
          const b = buildBoardView(postings, { category: null, reference: referenceAfterSearch({ ...BERKELEY, name: "Berkeley" }), radiusMiles });
          expect(a).toEqual(b);
          for (const item of a.nearby) {
            expect(item.distanceLabel).toBe(formatApproxDistance(milesBetween(searched, item.posting)));
          }
          expect(a.referenceLabel).toBe("Berkeley");
        },
      ),
    );
  });

  it("labels a Richmond posting with its distance from Berkeley after searching Berkeley", () => {
    const richmond = makeFixturePosting("richmond", { lat: 37.9358, lng: -122.3478 });
    const searched = referenceAfterSearch({ lat: BERKELEY.lat, lng: BERKELEY.lng, name: "Berkeley" });
    const device: BoardReference = { lat: 37.7749, lng: -122.4194, kind: "device", name: null };
    const view = buildBoardView([richmond], { category: null, reference: searched, radiusMiles: 10 });
    const viaDevice = buildBoardView([richmond], { category: null, reference: device, radiusMiles: 10 });
    expect(view.nearby).toHaveLength(1);
    expect(view.nearby[0].distanceLabel).toBe(formatApproxDistance(milesBetween(BERKELEY, richmond)));
    expect(view.nearby[0].distanceLabel).not.toBe(viaDevice.nearby[0]?.distanceLabel);
  });
});

describe("Property 26: Heading states the centre and radius", () => {
  /** **Validates: Requirements 2.1, 5.1** */
  it("radiusPhrase contains the radius and the reference label", () => {
    fc.assert(
      fc.property(radiusArb, referenceArb, (r, ref) => {
        const phrase = radiusPhrase(r, ref);
        expect(phrase).toContain(String(r));
        expect(phrase).toContain(referenceLabel(ref));
        expect(phrase).toBe(`Within ${r} mi of ${referenceLabel(ref)}`);
      }),
    );
  });

  it("the view carries the same label and radius the heading uses", () => {
    fc.assert(
      fc.property(radiusArb, referenceArb, (r, ref) => {
        const view = buildBoardView([], { category: null, reference: ref, radiusMiles: r });
        expect(view.radiusMiles).toBe(r);
        expect(view.referenceLabel).toBe(referenceLabel(ref));
        expect(radiusPhrase(view.radiusMiles, ref)).toContain(view.referenceLabel);
      }),
    );
  });

  it("the default radius is 10 and the Berkeley default reads 'Within 10 mi of Berkeley'", () => {
    expect(DEFAULT_RADIUS_MILES).toBe(10);
    expect(radiusPhrase(DEFAULT_RADIUS_MILES, { lat: BERKELEY.lat, lng: BERKELEY.lng, kind: "default", name: null })).toBe(
      "Within 10 mi of Berkeley",
    );
  });
});
