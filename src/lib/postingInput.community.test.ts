import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validatePostingEdit, validatePostingInput, type EditContext } from "./postingInput";
import { eventEnd, postingTakedown } from "./lifecycle";
import { takedownInfo } from "./postingKinds";

// Fake clock, fixed pin in America/Los_Angeles.
const now = new Date("2026-11-10T20:00:00Z");
const real = { lat: 37.87, lng: -122.27 };
const TZ = "America/Los_Angeles";
const expiresAt = "2026-12-10T00:00:00Z";
const baseCtx: EditContext = { expiresAt, timeZone: TZ, lat: real.lat, lng: real.lng };

const pub = (slug: string, o: Record<string, unknown>) =>
  validatePostingInput({ title: "T", categorySlug: slug, expiry: "1w", location: { ...real, source: "pin", confirmed: true, precision: "exact" }, ...o }, now);
const edit = (slug: string, o: Record<string, unknown>, ctx: EditContext = baseCtx) =>
  validatePostingEdit({ title: "T", categorySlug: slug, ...o }, ctx, now);

const iso = (offsetDays: number) =>
  new Date(Date.UTC(2026, 10, 10 + offsetDays)).toISOString().slice(0, 10);
const dayOffset = fc.integer({ min: -30, max: 60 });
const dateStr = dayOffset.map(iso);
const clock = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
/** A field that is absent, empty, or holds a value. */
const optional = <T>(v: fc.Arbitrary<T>) =>
  fc.oneof(fc.constant(undefined), fc.constant(""), fc.constant(null), v);
const isBlank = (v: unknown) => v === undefined || v === null || v === "";

const strip = <T extends { categorySlug: string }>(v: T) => ({ ...v, categorySlug: "" });
const sameResult = (a: ReturnType<typeof pub>, b: ReturnType<typeof pub>) => {
  if (!a.ok || !b.ok) return expect(a).toEqual(b);
  expect(strip(a.value)).toEqual(strip(b.value));
};
const sameEdit = (a: ReturnType<typeof edit>, b: ReturnType<typeof edit>) => {
  if (!a.ok || !b.ok) return expect(a).toEqual(b);
  expect(strip(a.value)).toEqual(strip(b.value));
};

describe("Property 27: Community validation", () => {
  /** **Validates: Requirements 9.1, 9.2** */
  it("without an event date, succeeds exactly when the other date/time fields are blank, with all four null", () => {
    fc.assert(
      fc.property(optional(clock), optional(dateStr), optional(clock), (eventTime, endDate, endTime) => {
        const input = { eventTime, endDate, endTime };
        const clean = isBlank(eventTime) && isBlank(endDate) && isBlank(endTime);
        for (const r of [pub("community", input), edit("community", input)]) {
          expect(r.ok).toBe(clean);
          if (r.ok) {
            expect([r.value.eventDate, r.value.eventTime, r.value.endDate, r.value.endTime]).toEqual([null, null, null, null]);
          } else {
            expect(r.error).toBe("Add an event date first, or clear the time fields.");
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  /** **Validates: Requirements 9.3** */
  it("with an event date, gives the same result as an event category for the same input", () => {
    fc.assert(
      fc.property(
        dateStr,
        optional(clock),
        optional(dateStr),
        optional(clock),
        (eventDate, eventTime, endDate, endTime) => {
          const input = { eventDate, eventTime, endDate, endTime };
          sameResult(pub("community", input), pub("sports", input));
          sameEdit(edit("community", input), edit("sports", input));
        },
      ),
      { numRuns: 300 },
    );
  });

  /** **Validates: Requirements 9.4** */
  it("rejects any deadline payload, on publish and edit", () => {
    fc.assert(
      fc.property(optional(dateStr), dateStr, (eventDate, deadline) => {
        const input = { eventDate, deadline };
        expect(pub("community", input).ok).toBe(false);
        expect(edit("community", input).ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("exact examples", () => {
    expect(pub("community", { eventTime: "18:00" })).toEqual({ ok: false, error: "Add an event date first, or clear the time fields." });
    expect(pub("community", { deadline: "2026-11-20" }).ok).toBe(false);
    expect(pub("community", {}).ok).toBe(true);
  });
});

describe("Property 29: Community edit cannot revive an ended posting", () => {
  const ENDED = "This posting has ended. Clearing its date would put it back on the board.";

  /** **Validates: Requirements 9.7** */
  it("clearing the date of a posting ended by its event fails", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -30, max: -1 }),
        fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
        optional(clock),
        (start, span, endTime) => {
          const eventDate = iso(start);
          const endDate = span === undefined ? null : iso(Math.min(start + span, -1));
          const ctx: EditContext = { ...baseCtx, eventDate, endDate, endTime: isBlank(endTime) ? null : (endTime as string) };
          const end = eventEnd({ ...ctx, eventDate });
          fc.pre(end !== null && end.getTime() <= now.getTime() && end.getTime() < new Date(expiresAt).getTime());
          expect(edit("community", { eventDate: "" }, ctx)).toEqual({ ok: false, error: ENDED });
          expect(edit("community", {}, ctx)).toEqual({ ok: false, error: ENDED });
        },
      ),
      { numRuns: 200 },
    );
  });

  /** **Validates: Requirements 9.8** */
  it("clearing the date of a posting still active succeeds and the takedown is expiresAt", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 }), fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }), (start, span) => {
        const eventDate = iso(start);
        const endDate = span === undefined ? null : iso(start + span);
        const ctx: EditContext = { ...baseCtx, eventDate, endDate };
        const end = eventEnd({ ...ctx, eventDate });
        fc.pre(end !== null && end.getTime() > now.getTime());
        const r = edit("community", { eventDate: "" }, ctx);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const row = { ...baseCtx, ...r.value };
        expect(postingTakedown(row).toISOString()).toBe(new Date(expiresAt).toISOString());
        expect(takedownInfo({ ...row, categorySlug: "community" }).reason).toBe("expiry");
      }),
      { numRuns: 200 },
    );
  });

  /** **Validates: Requirements 9.8** */
  it("adding a date never moves the takedown later than expires_at (publish and edit)", () => {
    fc.assert(
      fc.property(dateStr, optional(clock), optional(dateStr), optional(clock), (eventDate, eventTime, endDate, endTime) => {
        const input = { eventDate, eventTime, endDate, endTime };
        const e = edit("community", input);
        if (e.ok) {
          const row = { ...baseCtx, ...e.value };
          expect(postingTakedown(row).getTime()).toBeLessThanOrEqual(new Date(expiresAt).getTime());
          expect(takedownInfo({ ...row, categorySlug: "community" }).at.getTime()).toBeLessThanOrEqual(new Date(expiresAt).getTime());
        }
        const p = pub("community", input);
        if (p.ok) {
          const row = { ...p.value, expiresAt: p.value.expiresAt.toISOString(), lat: p.value.pin.lat, lng: p.value.pin.lng };
          expect(postingTakedown(row).getTime()).toBeLessThanOrEqual(p.value.expiresAt.getTime());
        }
      }),
      { numRuns: 300 },
    );
  });

  it("exact examples", () => {
    expect(edit("community", { eventDate: "" }, { ...baseCtx, eventDate: "2026-11-01" })).toEqual({ ok: false, error: ENDED });
    expect(edit("community", { eventDate: "" }, { ...baseCtx, eventDate: "2026-11-20" }).ok).toBe(true);
  });
});
