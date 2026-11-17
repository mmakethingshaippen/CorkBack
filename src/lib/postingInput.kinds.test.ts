import { describe, expect, it } from "vitest";
import { validatePostingEdit, validatePostingInput, type EditContext } from "./postingInput";

const now = new Date("2026-11-10T20:00:00Z");
const real = { lat: 37.87, lng: -122.27 }; // America/Los_Angeles
const pub = (o: Record<string, unknown>) =>
  validatePostingInput({ title: "T", categorySlug: "jobs", expiry: "1w", location: { ...real, source: "pin", confirmed: true, precision: "exact" }, ...o }, now);
const ctx: EditContext = { expiresAt: "2026-12-10T00:00:00Z", timeZone: "America/Los_Angeles", lat: real.lat, lng: real.lng };
const edit = (o: Record<string, unknown>, c = ctx) => validatePostingEdit({ title: "T", categorySlug: "jobs", ...o }, c, now);

describe("listing branch", () => {
  it("returns the deadline as endDate and nulls the event fields", () => {
    const r = pub({ deadline: "2026-11-20" });
    expect(r.ok && [r.value.eventDate, r.value.eventTime, r.value.endDate, r.value.endTime]).toEqual([null, null, "2026-11-20", null]);
    const e = edit({ deadline: "2026-11-10" });
    expect(e.ok && e.value.endDate).toBe("2026-11-10");
    const none = pub({ deadline: "" });
    expect(none.ok && none.value.endDate).toBeNull();
  });
  it("rejects event fields, past, malformed and unconfirmed deadlines, same for publish and edit", () => {
    for (const run of [pub, (o: Record<string, unknown>) => edit(o)]) {
      expect(run({ eventDate: "2026-11-20" })).toEqual({ ok: false, error: "Listings use a deadline instead of an event date." });
      expect(run({ endTime: "10:00" })).toEqual({ ok: false, error: "Listings use a deadline instead of an event date." });
      expect(run({ deadline: "2026-11-09" })).toEqual({ ok: false, error: "This deadline has already passed." });
      expect(run({ deadline: "2026-02-30" }).ok).toBe(false);
      expect(run({ deadline: "2026-11-20", dateNeedsConfirmation: true }).ok).toBe(false);
      expect(run({ deadline: "2026-11-20", dateNeedsConfirmation: true, dateConfirmed: true }).ok).toBe(true);
    }
  });
});

describe("community branch", () => {
  const c = (o: Record<string, unknown>) => pub({ categorySlug: "community", ...o });
  it("accepts a dateless notice and applies event rules with a date", () => {
    const r = c({});
    expect(r.ok && [r.value.eventDate, r.value.eventTime, r.value.endDate, r.value.endTime]).toEqual([null, null, null, null]);
    expect(c({ eventDate: "2026-11-09" }).ok).toBe(false);
    expect(c({ eventDate: "2026-11-20", eventTime: "18:00" }).ok).toBe(true);
  });
  it("rejects time fields without a date and any deadline", () => {
    for (const o of [{ eventTime: "18:00" }, { endDate: "2026-11-20" }, { endTime: "10:00" }]) {
      expect(c(o)).toEqual({ ok: false, error: "Add an event date first, or clear the time fields." });
    }
    expect(c({ deadline: "2026-11-20" }).ok).toBe(false);
  });
  it("edit rejects clearing the date of an ended posting, allows it while running", () => {
    const body = { categorySlug: "community", eventDate: "" };
    const ended = edit(body, { ...ctx, eventDate: "2026-11-01" });
    expect(ended).toEqual({ ok: false, error: "This posting has ended. Clearing its date would put it back on the board." });
    expect(edit(body, { ...ctx, eventDate: "2026-11-20" }).ok).toBe(true);
    expect(edit(body, ctx).ok).toBe(true);
  });
});
