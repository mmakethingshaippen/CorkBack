import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validatePostingEdit, validatePostingInput, type EditContext } from "./postingInput";
import { validatePostingEdit as baselineEdit, validatePostingInput as baselinePublish } from "./__testing__/postingInputBaseline";
import { CATEGORIES } from "./categories";
import { EXPIRY_PRESETS } from "./domain";
import { LISTING_SLUGS, categoryKind } from "./postingKinds";
import { localDate, timeZoneForPin } from "./lifecycle";

const LISTING = [...LISTING_SLUGS];
const EVENT_SLUGS = CATEGORIES.map((c) => c.slug as string).filter((s) => categoryKind(s) === "event");

// Pins in zones far apart, so "today" differs by up to a day between them.
const PLACES = {
  "Pacific/Kiritimati": { lat: 1.87, lng: -157.4 },
  "America/Los_Angeles": { lat: 37.87, lng: -122.27 },
  "Europe/London": { lat: 51.5416, lng: -0.1426 },
} as const;
const placeArb = fc.constantFrom(...(Object.keys(PLACES) as (keyof typeof PLACES)[]));
const slugArb = fc.constantFrom(...LISTING);
const nowArb = fc.date({ min: new Date("2025-01-01T00:00:00Z"), max: new Date("2030-12-31T00:00:00Z"), noInvalidDate: true });

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const locOf = (p: { lat: number; lng: number }) => ({ ...p, source: "pin", confirmed: true, precision: "exact" });
/** Maps the location block back to the retired real/desired fields for the frozen baseline. */
const toBaseline = (input: Record<string, unknown>) => {
  const { location, ...rest } = input;
  const p = location as { lat: number; lng: number };
  return { ...rest, real: { lat: p.lat, lng: p.lng }, desired: null };
};
/** The new result carries `precision`, which the baseline has no notion of. */
const withoutPrecision = (r: ReturnType<typeof validatePostingInput>) => {
  if (!r.ok) return r;
  const { precision: _p, ...value } = r.value;
  return { ok: true as const, value };
};
const publish = (slug: string, place: keyof typeof PLACES, now: Date, o: Record<string, unknown>) =>
  validatePostingInput({ title: "T", categorySlug: slug, expiry: "1w", location: locOf(PLACES[place]), ...o }, now);
const ctxFor = (place: keyof typeof PLACES, now: Date): EditContext => ({
  expiresAt: new Date(now.getTime() + 7 * 864e5).toISOString(),
  timeZone: timeZoneForPin(PLACES[place].lat, PLACES[place].lng),
  lat: PLACES[place].lat,
  lng: PLACES[place].lng,
});
const edit = (slug: string, place: keyof typeof PLACES, now: Date, o: Record<string, unknown>) =>
  validatePostingEdit({ title: "T", categorySlug: slug, ...o }, ctxFor(place, now), now);

const EVENT_MSG = "Listings use a deadline instead of an event date.";
const PAST_MSG = "This deadline has already passed.";

describe("Property 11: Listing validation", () => {
  it("**Validates: Requirements 8.1, 8.3, 8.4** a deadline today or later succeeds with endDate = deadline and null event fields", () => {
    fc.assert(
      fc.property(slugArb, placeArb, nowArb, fc.integer({ min: 0, max: 400 }), (slug, place, now, offset) => {
        const tz = timeZoneForPin(PLACES[place].lat, PLACES[place].lng)!;
        const deadline = addDays(localDate(now, tz), offset);
        for (const r of [publish(slug, place, now, { deadline }), edit(slug, place, now, { deadline })]) {
          expect(r.ok).toBe(true);
          if (!r.ok) continue;
          expect([r.value.eventDate, r.value.eventTime, r.value.endDate, r.value.endTime]).toEqual([null, null, deadline, null]);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("any non-empty event field fails, even with a valid deadline", () => {
    const fieldArb = fc.constantFrom("eventDate", "eventTime", "endTime");
    const valueArb = fc.constantFrom("2030-01-01", "18:00", "x", "0", " ");
    fc.assert(
      fc.property(slugArb, placeArb, nowArb, fieldArb, valueArb, fc.boolean(), (slug, place, now, field, value, withDeadline) => {
        const tz = timeZoneForPin(PLACES[place].lat, PLACES[place].lng)!;
        const o: Record<string, unknown> = { [field]: value };
        if (withDeadline) o.deadline = addDays(localDate(now, tz), 3);
        const expected = { ok: false, error: EVENT_MSG };
        expect(publish(slug, place, now, o)).toEqual(expected);
        expect(edit(slug, place, now, o)).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("a deadline before today in the posting's zone fails", () => {
    fc.assert(
      fc.property(slugArb, placeArb, nowArb, fc.integer({ min: 1, max: 400 }), (slug, place, now, back) => {
        const tz = timeZoneForPin(PLACES[place].lat, PLACES[place].lng)!;
        const deadline = addDays(localDate(now, tz), -back);
        const expected = { ok: false, error: PAST_MSG };
        expect(publish(slug, place, now, { deadline })).toEqual(expected);
        expect(edit(slug, place, now, { deadline })).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("malformed deadlines are rejected", () => {
    const bad = fc.oneof(
      fc.constantFrom("2026-02-30", "2026-13-01", "tomorrow", "11/20/2026", "2026-1-5", "20261120", "2026-11-20T10:00"),
      fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !/^\d{4}-\d{2}-\d{2}$/.test(s)),
      fc.constantFrom<unknown>(5, true, {}, []),
    );
    fc.assert(
      fc.property(slugArb, placeArb, nowArb, bad, (slug, place, now, deadline) => {
        // blank-looking strings are "no deadline" by design, so skip them
        if (deadline === "") return;
        expect(publish(slug, place, now, { deadline }).ok).toBe(false);
        expect(edit(slug, place, now, { deadline }).ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("day boundary: the deadline day is allowed today and rejected once the zone's day has moved on", () => {
    // 2026-11-10T20:00Z is 2026-11-11 10:00 in Kiritimati (UTC+14) and 2026-11-10 12:00 in Los Angeles.
    const at = new Date("2026-11-10T20:00:00Z");
    for (const slug of LISTING) {
      expect(publish(slug, "Pacific/Kiritimati", at, { deadline: "2026-11-11" }).ok).toBe(true);
      expect(publish(slug, "Pacific/Kiritimati", at, { deadline: "2026-11-10" })).toEqual({ ok: false, error: PAST_MSG });
      expect(publish(slug, "America/Los_Angeles", at, { deadline: "2026-11-10" }).ok).toBe(true);
      expect(publish(slug, "America/Los_Angeles", at, { deadline: "2026-11-09" })).toEqual({ ok: false, error: PAST_MSG });
    }
    // One minute either side of local midnight in Los Angeles (PST, UTC-8): 08:00Z.
    const before = new Date("2026-11-11T07:59:00Z");
    const after = new Date("2026-11-11T08:00:00Z");
    expect(publish("jobs", "America/Los_Angeles", before, { deadline: "2026-11-10" }).ok).toBe(true);
    expect(publish("jobs", "America/Los_Angeles", after, { deadline: "2026-11-10" }).ok).toBe(false);
    expect(edit("jobs", "America/Los_Angeles", before, { deadline: "2026-11-10" }).ok).toBe(true);
    expect(edit("jobs", "America/Los_Angeles", after, { deadline: "2026-11-10" }).ok).toBe(false);
  });
});

describe("Property 12: Event categories are unchanged", () => {
  const dateArb = fc.oneof(
    fc.date({ min: new Date("2024-01-01"), max: new Date("2031-01-01"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
    fc.constantFrom<unknown>("", null, undefined, "2026-02-30", "junk", 7),
  );
  const timeArb = fc.oneof(
    fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })).map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`),
    fc.constantFrom<unknown>("", null, undefined, "7pm", "25:00", 3),
  );
  const rsvpArb = fc.constantFrom<unknown>(undefined, "", "https://a.example/x", "ftp://a.example", "not a url", "https://a.example https://b.example", ["https://a.example"]);
  const inputArb = fc.record(
    {
      title: fc.constantFrom<unknown>("T", "  Jumble  ", "", "   ", undefined, 5),
      body: fc.constantFrom<unknown>("b", undefined, 3),
      categorySlug: fc.oneof(
        { weight: 9, arbitrary: fc.constantFrom<unknown>(...EVENT_SLUGS) },
        { weight: 1, arbitrary: fc.constantFrom<unknown>("nope", undefined, ["music", "art"]) },
      ),
      expiry: fc.oneof(
        { weight: 9, arbitrary: fc.constantFrom<unknown>(...EXPIRY_PRESETS) },
        { weight: 1, arbitrary: fc.constantFrom<unknown>("2d", undefined) },
      ),
      // Always a valid confirmed location: the location error messages are new by design.
      location: fc.constantFrom<unknown>(...Object.values(PLACES).map(locOf)),
      eventDate: dateArb,
      eventTime: timeArb,
      endDate: dateArb,
      endTime: timeArb,
      rsvpUrl: rsvpArb,
      placeLabel: fc.constantFrom<unknown>("Cafe", undefined, 1),
      dateNeedsConfirmation: fc.constantFrom<unknown>(true, false, undefined),
      dateConfirmed: fc.constantFrom<unknown>(true, false, undefined),
    },
    { requiredKeys: ["location"] },
  );
  it("**Validates: Requirements 8.7** publish matches the pre-feature validator, outcome and message", () => {
    fc.assert(
      fc.property(inputArb, nowArb, (input, now) => {
        expect(withoutPrecision(validatePostingInput(input, now))).toEqual(baselinePublish(toBaseline(input), now));
      }),
      { numRuns: 500 },
    );
  });

  it("edit matches the pre-feature validator, outcome and message", () => {
    fc.assert(
      fc.property(inputArb, nowArb, placeArb, fc.constantFrom<string | null>(null, "2026-01-01"), (input, now, place, stored) => {
        const ctx: EditContext = { ...ctxFor(place, now), eventDate: stored, endDate: null, endTime: null };
        // The generated input may carry a publish-style location; the baseline never saw one.
        const { location: _loc, ...noLoc } = input as Record<string, unknown>;
        input = noLoc as typeof input;
        const got = validatePostingEdit(input, ctx, now);
        let stripped: unknown = got;
        if (got.ok) {
          // Bodies here carry no location, so the edit leaves the stored one untouched.
          expect(got.value.location).toBeNull();
          const { location: _l, ...value } = got.value;
          stripped = { ok: true as const, value };
        }
        expect(stripped).toEqual(baselineEdit(input, ctx, now));
      }),
      { numRuns: 500 },
    );
  });
});

describe("Property 14: Publish and edit validate alike", () => {
  it("**Validates: Requirements 8.8** same listing input gives the same accept/reject, message and shared fields", () => {
    fc.assert(
      fc.property(
        slugArb,
        placeArb,
        nowArb,
        fc.record(
          {
            title: fc.constantFrom<unknown>("T", "  Room  ", "", "  ", 5),
            body: fc.constantFrom<unknown>("b", 3),
            rsvpUrl: fc.constantFrom<unknown>("", null, "https://a.example/x", "mailto:a@b.c", "x y", ["https://a.example"]),
            deadline: fc.oneof(
              fc.integer({ min: -3, max: 5 }).map((n) => ({ off: n })),
              fc.constantFrom<unknown>("", null, "2026-02-30", "junk", 4),
            ),
            eventDate: fc.constantFrom<unknown>("", null, "2030-01-01"),
            eventTime: fc.constantFrom<unknown>("", null, "18:00"),
            endTime: fc.constantFrom<unknown>("", null, "19:00"),
            dateNeedsConfirmation: fc.constantFrom<unknown>(true, false),
            dateConfirmed: fc.constantFrom<unknown>(true, false),
            placeLabel: fc.constantFrom<unknown>("Cafe", 1),
          },
          { requiredKeys: ["title"] },
        ),
        (slug, place, now, raw) => {
          const tz = timeZoneForPin(PLACES[place].lat, PLACES[place].lng)!;
          const input: Record<string, unknown> = { ...raw, categorySlug: slug };
          const dl = raw.deadline as unknown;
          if (dl && typeof dl === "object" && !Array.isArray(dl) && "off" in dl) {
            input.deadline = addDays(localDate(now, tz), (dl as { off: number }).off);
          }
          const p = validatePostingInput({ ...input, expiry: "1w", location: locOf(PLACES[place]) }, now);
          const e = validatePostingEdit(input, ctxFor(place, now), now);
          expect(p.ok).toBe(e.ok);
          if (!p.ok && !e.ok) expect(p.error).toBe(e.error);
          if (p.ok && e.ok) {
            const { title, body, categorySlug, rsvpUrl, eventDate, eventTime, endDate, endTime, placeLabel } = p.value;
            expect(e.value).toEqual({ title, body, categorySlug, rsvpUrl, eventDate, eventTime, endDate, endTime, placeLabel, location: null });
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

