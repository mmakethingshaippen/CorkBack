// Property tests for the posting location draft state machine.
import { describe, it, expect } from "vitest";
import fc from "fast-check";

import {
  emptyDraft,
  locationReducer,
  publicPin,
  publishableLocation,
  type LocationDraft,
  type LocationEvent,
  type PinChoice,
} from "./postingLocation";
import { isAmbiguous, type LatLng, type PlaceMatch } from "./geocode";

// ---------------------------------------------------------------------------
// Generators. Points sit on a small grid (about 55 m apart) so that the 100 m
// stale-label rule and the 250 m ambiguity rule are both exercised.
// ---------------------------------------------------------------------------

const gridStep = fc.integer({ min: -8, max: 8 });
const point: fc.Arbitrary<LatLng> = fc
  .tuple(gridStep, gridStep)
  .map(([a, b]) => ({ lat: 40 + a * 0.0005, lng: -105 + b * 0.0006 }));

const match: fc.Arbitrary<PlaceMatch> = fc
  .record({
    n: fc.integer({ min: 0, max: 5 }),
    name: fc.constantFrom("", "Town Hall", "Elm Cafe"),
    street: fc.constantFrom("", "123 Oak Street", "9 Birch Road"),
    area: fc.constantFrom("", "Springfield", "Rivertown"),
    point,
    level: fc.constantFrom<"address" | "area">("address", "area"),
  })
  .map(({ n, name, street, area, point: p, level }) => ({
    id: `node${n}`,
    name,
    addressLine: street,
    area,
    displayName: [name, street, area].filter(Boolean).join(", "),
    point: p,
    level,
  }));

const rand = fc.tuple(
  fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
  fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
) as fc.Arbitrary<[number, number]>;

const src = fc.constantFrom<"flyer_candidate" | "search">("flyer_candidate", "search");

const event: fc.Arbitrary<LocationEvent> = fc.oneof(
  fc.constant<LocationEvent>({ type: "extracted", candidates: [{ text: "55 Home Lane", kind: "return" }] }),
  fc.record({
    type: fc.constant("matches_loaded" as const),
    matches: fc.array(match, { maxLength: 4 }),
    autoPropose: fc.boolean(),
    source: fc.option(src, { nil: undefined }),
  }),
  fc.record({ type: fc.constant("match_selected" as const), match, source: src }),
  point.map<LocationEvent>((p) => ({ type: "pin_placed", point: p })),
  point.map<LocationEvent>((p) => ({ type: "device_succeeded", point: p })),
  fc.constant<LocationEvent>({ type: "device_failed" }),
  fc
    .constantFrom<"unavailable" | "busy" | "refused">("unavailable", "busy", "refused")
    .map<LocationEvent>((kind) => ({ type: "search_failed", kind })),
  fc.constant<LocationEvent>({ type: "location_save_failed" }),
  rand.map<LocationEvent>((r) => ({ type: "proposal_confirmed", rand: r })),
  rand.map<LocationEvent>((r) => ({ type: "proposal_confirmed", rand: r })),
  fc.constant<LocationEvent>({ type: "proposal_rejected" }),
  fc.tuple(fc.boolean(), rand).map<LocationEvent>(([value, r]) => ({ type: "private_home_set", value, rand: r })),
  fc.constantFrom("", "Back porch", "  Library  ", "x").map<LocationEvent>((text) => ({ type: "label_typed", text })),
  fc
    .tuple(point, fc.constantFrom<"exact" | "approximate" | "unreviewed">("exact", "approximate", "unreviewed"), fc.constantFrom("", "Old label"))
    .map<LocationEvent>(([p, precision, label]) => ({ type: "existing_loaded", point: p, precision, label })),
);

const events = fc.array(event, { maxLength: 25 });

function run(seq: LocationEvent[], from: LocationDraft = emptyDraft()): LocationDraft[] {
  const states = [from];
  for (const e of seq) states.push(locationReducer(states[states.length - 1], e));
  return states;
}

const sameChoice = (a: PinChoice | null, b: PinChoice | null) =>
  a === null || b === null ? a === b : a.point.lat === b.point.lat && a.point.lng === b.point.lng && a.source === b.source;

// ---------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------

describe("Property 7: only Yes confirms, and it confirms exactly the proposal", () => {
  it("matches a reference model of proposal and confirmed", () => {
    fc.assert(
      fc.property(events, (seq) => {
        let model: { proposal: PinChoice | null; confirmed: PinChoice | null } = { proposal: null, confirmed: null };
        let d = emptyDraft();
        for (const e of seq) {
          const next = locationReducer(d, e);
          switch (e.type) {
            case "proposal_confirmed":
              if (model.proposal) model = { proposal: null, confirmed: model.proposal };
              break;
            case "match_selected":
              model = { proposal: { point: e.match.point, source: e.source, match: e.match }, confirmed: null };
              break;
            case "pin_placed":
              model = { proposal: { point: e.point, source: "pin", match: null }, confirmed: null };
              break;
            case "device_succeeded":
              model = { proposal: { point: e.point, source: "device", match: null }, confirmed: null };
              break;
            case "proposal_rejected":
              model = { ...model, proposal: null };
              break;
            case "matches_loaded":
              if (e.matches.length > 0 && e.autoPropose && !isAmbiguous(e.matches)) {
                model = {
                  proposal: { point: e.matches[0].point, source: e.source ?? "search", match: e.matches[0] },
                  confirmed: null,
                };
              }
              break;
            default:
              break;
          }
          if (!sameChoice(next.proposal, model.proposal)) return false;
          if (!sameChoice(next.confirmed, model.confirmed)) return false;
          d = next;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it("extracted, existing_loaded, label_typed and device_failed never set confirmed or proposal", () => {
    fc.assert(
      fc.property(
        events,
        fc.constantFrom<LocationEvent>(
          { type: "extracted", candidates: [{ text: "1 Main Street", kind: "venue" }] },
          { type: "existing_loaded", point: { lat: 40, lng: -105 }, precision: "exact", label: "Hall" },
          { type: "label_typed", text: "Hall" },
          { type: "device_failed" },
        ),
        (seq, e) => {
          const before = run(seq).pop()!;
          const after = locationReducer(before, e);
          return after.confirmed === before.confirmed && after.proposal === before.proposal;
        },
      ),
    );
  });

  it("an extracted candidate never becomes the pin on its own", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom<LocationEvent>(
        { type: "extracted", candidates: [{ text: "1 Main Street", kind: "venue" }] },
        { type: "device_failed" },
        { type: "label_typed", text: "Hall" },
        { type: "proposal_rejected" },
        { type: "search_failed", kind: "busy" },
      ), { maxLength: 15 }), rand, (seq, r) => {
        const d = run([...seq, { type: "proposal_confirmed", rand: r }]).pop()!;
        return d.confirmed === null && d.proposal === null && publishableLocation(d) === null;
      }),
    );
  });

  it("an ambiguous or empty match set leaves the proposal alone; a clear one proposes the first match unconfirmed", () => {
    fc.assert(
      fc.property(fc.array(match, { maxLength: 4 }), (ms) => {
        const d = locationReducer(emptyDraft(), { type: "matches_loaded", matches: ms, autoPropose: true });
        if (ms.length === 0 || isAmbiguous(ms)) return d.proposal === null && d.confirmed === null;
        return d.proposal?.point === ms[0].point && d.confirmed === null;
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8
// ---------------------------------------------------------------------------

describe("Property 8: the publish payload comes only from the confirmed point", () => {
  it("is null without a confirmation; otherwise built from the confirmed point or approx", () => {
    fc.assert(
      fc.property(events, (seq) => {
        for (const d of run(seq)) {
          const p = publishableLocation(d);
          if (!d.confirmed) {
            if (p !== null) return false;
            continue;
          }
          if (!p || p.confirmed !== true || p.source !== d.confirmed.source) return false;
          if (d.privateHome) {
            if (!d.approx || p.precision !== "approximate" || p.lat !== d.approx.lat || p.lng !== d.approx.lng) return false;
          } else if (p.precision !== "exact" || p.lat !== d.confirmed.point.lat || p.lng !== d.confirmed.point.lng) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it("failure events change only notice", () => {
    const failure = fc.oneof(
      fc.constant<LocationEvent>({ type: "device_failed" }),
      fc.constant<LocationEvent>({ type: "location_save_failed" }),
      fc
        .constantFrom<"unavailable" | "busy" | "refused">("unavailable", "busy", "refused")
        .map<LocationEvent>((kind) => ({ type: "search_failed", kind })),
    );
    fc.assert(
      fc.property(events, failure, (seq, e) => {
        const before = run(seq).pop()!;
        const after = locationReducer(before, e);
        const { notice: _a, ...restBefore } = before;
        const { notice: _b, ...restAfter } = after;
        return (
          JSON.stringify(restAfter) === JSON.stringify(restBefore) &&
          JSON.stringify(publishableLocation(after)) === JSON.stringify(publishableLocation(before))
        );
      }),
    );
  });

  it("a manual pin that was confirmed stays publishable after a failed search", () => {
    const d = run([
      { type: "pin_placed", point: { lat: 40, lng: -105 } },
      { type: "proposal_confirmed", rand: [0.3, 0.3] },
      { type: "search_failed", kind: "unavailable" },
    ]).pop()!;
    expect(publishableLocation(d)).toEqual({ lat: 40, lng: -105, source: "pin", confirmed: true, precision: "exact" });
  });
});

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe("Property 10: the approximate pin is stable and does not leak the exact point", () => {
  it("only proposal_confirmed and private_home_set change approx while the confirmation stands", () => {
    fc.assert(
      fc.property(events, (seq) => {
        const states = run(seq);
        for (let i = 0; i < seq.length; i++) {
          const a = states[i];
          const b = states[i + 1];
          const t = seq[i].type;
          if (a.confirmed && a.privateHome && b.confirmed === a.confirmed && t !== "proposal_confirmed" && t !== "private_home_set") {
            if (b.approx !== a.approx) return false;
          }
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it("the payload never carries the exact coordinates for a private home", () => {
    // Bearings of exactly 0 and pi (rand[1] of 0 or 0.5) move due north or south,
    // which keeps the exact longitude. Math.random() hits them with probability
    // about 2^-53, so the generator skips those two values.
    const offAxis = (r: [number, number]) => Math.abs(r[1] * 2 - Math.round(r[1] * 2)) > 1e-6;
    const safeEvents = fc.array(
      event.filter((e) => (e.type !== "proposal_confirmed" && e.type !== "private_home_set") || offAxis(e.rand)),
      { maxLength: 25 },
    );
    fc.assert(
      fc.property(safeEvents, (seq) => {
        for (const d of run(seq)) {
          if (!d.confirmed || !d.privateHome) continue;
          const parsed = JSON.parse(JSON.stringify(publishableLocation(d))) as { lat: number; lng: number };
          const exact = d.confirmed.point;
          if (parsed.lat === exact.lat || parsed.lng === exact.lng) return false;
          const pin = publicPin(d);
          if (!pin || pin.lat !== parsed.lat || pin.lng !== parsed.lng) return false;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it("setting private home on and off restores the earlier payload", () => {
    fc.assert(
      fc.property(point, src, rand, rand, (p, s, r1, r2) => {
        const base = run([
          { type: "match_selected", match: { id: "n1", name: "", addressLine: "5 Elm Street", area: "Springfield", displayName: "x", point: p, level: "address" }, source: s },
          { type: "proposal_confirmed", rand: r1 },
        ]).pop()!;
        const before = publishableLocation(base);
        const after = run(
          [
            { type: "private_home_set", value: true, rand: r2 },
            { type: "private_home_set", value: false, rand: r2 },
          ],
          base,
        ).pop()!;
        return JSON.stringify(publishableLocation(after)) === JSON.stringify(before) && before !== null;
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12
// ---------------------------------------------------------------------------

describe("Property 12: the place label and the pin agree", () => {
  it("a derived label stays within 100 m of the proposal, or the confirmed point when there is no proposal", () => {
    fc.assert(
      fc.property(events, (seq) => {
        for (const d of run(seq)) {
          if (d.label.origin !== "derived") continue;
          const at = d.proposal?.point ?? d.confirmed?.point;
          if (!at || !d.label.derivedFrom) continue;
          const dLat = (at.lat - d.label.derivedFrom.lat) * 111_000;
          const dLng = (at.lng - d.label.derivedFrom.lng) * 111_000 * Math.cos((40 * Math.PI) / 180);
          if (Math.hypot(dLat, dLng) > 101) return false;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it("moving the pin more than 100 m from a derived label's point clears it, and a typed label survives", () => {
    fc.assert(
      fc.property(match, point, (m, p) => {
        const derived = run([{ type: "match_selected", match: m, source: "search" }]).pop()!;
        const moved = locationReducer(derived, { type: "pin_placed", point: p });
        const far = Math.hypot((p.lat - m.point.lat) * 111_000, (p.lng - m.point.lng) * 85_000) > 105;
        const near = Math.hypot((p.lat - m.point.lat) * 111_000, (p.lng - m.point.lng) * 85_000) < 95;
        if (derived.label.origin === "derived" && far) return moved.label.origin === "none" && moved.notice === "label_cleared";
        if (derived.label.origin === "derived" && near) return moved.label.origin === "derived";
        return true;
      }),
    );
  });

  it("a typed label keeps its text through every event except another label_typed", () => {
    fc.assert(
      fc.property(events, (seq) => {
        let d = locationReducer(emptyDraft(), { type: "label_typed", text: "Back porch" });
        for (const e of seq) {
          const next = locationReducer(d, e);
          if (e.type !== "label_typed" && d.label.origin === "typed") {
            if (next.label.origin !== "typed" || next.label.text !== d.label.text) return false;
          }
          d = next;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it("with private home on, a derived label never contains the street line", () => {
    fc.assert(
      fc.property(events, (seq) => {
        const streets = ["123 Oak Street", "9 Birch Road"];
        for (const d of run(seq)) {
          if (!d.privateHome || !d.confirmed || d.label.origin !== "derived") continue;
          if (streets.some((s) => d.label.text.includes(s))) return false;
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });
});
