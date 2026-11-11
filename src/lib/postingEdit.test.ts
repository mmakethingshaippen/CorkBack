import { describe, expect, it } from "vitest";
import { validatePostingEdit, validatePostingInput } from "./postingInput";

const now = new Date("2026-11-10T20:00:00Z");
const ctx = { expiresAt: "2026-11-17T20:00:00Z", timeZone: "America/Los_Angeles", lat: 37.87, lng: -122.27 };
const base = {
  title: "Pickup game", body: "Details", categorySlug: "community", rsvpUrl: null, eventDate: "2026-11-12",
  eventTime: "18:00", endDate: null, endTime: null, placeLabel: "Park",
};

describe("validatePostingEdit", () => {
  it("accepts a normal edit and returns only content fields (never pin, expiry or flyer)", () => {
    const v = validatePostingEdit({ ...base, lat: 1, lng: 2, expiry: "1m", flyerUrl: "x", isPromoted: true }, ctx, now);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(Object.keys(v.value).sort()).toEqual(["body", "categorySlug", "endDate", "endTime", "eventDate", "eventTime", "placeLabel", "rsvpUrl", "title"]);
    }
  });
  it("requires a title and exactly one valid category", () => {
    expect(validatePostingEdit({ ...base, title: "  " }, ctx, now).ok).toBe(false);
    expect(validatePostingEdit({ ...base, categorySlug: "nope" }, ctx, now).ok).toBe(false);
    expect(validatePostingEdit({ ...base, categorySlug: ["community"] }, ctx, now).ok).toBe(false);
  });
  it("allows at most one http(s) RSVP link", () => {
    expect(validatePostingEdit({ ...base, rsvpUrl: "https://example.org/a" }, ctx, now).ok).toBe(true);
    expect(validatePostingEdit({ ...base, rsvpUrl: "ftp://example.org" }, ctx, now).ok).toBe(false);
    expect(validatePostingEdit({ ...base, rsvpUrl: "https://a.org https://b.org" }, ctx, now).ok).toBe(false);
    expect(validatePostingEdit({ ...base, rsvpUrl: ["https://a.org"] }, ctx, now).ok).toBe(false);
  });
  it("rejects past events in the posting's own time zone, like publishing", () => {
    const past = validatePostingEdit({ ...base, eventDate: "2026-11-09" }, ctx, now);
    expect(past.ok).toBe(false);
    // 20:00 UTC on Nov 10 is still Nov 10 in Los Angeles, so Nov 10 is today, not the past.
    expect(validatePostingEdit({ ...base, eventDate: "2026-11-10", eventTime: null }, ctx, now).ok).toBe(true);
  });
  it("rejects an end before the start, and an end without an event date", () => {
    expect(validatePostingEdit({ ...base, endDate: "2026-11-11" }, ctx, now).ok).toBe(false);
    expect(validatePostingEdit({ ...base, eventDate: null, endTime: "20:00" }, ctx, now).ok).toBe(false);
    expect(validatePostingEdit({ ...base, endDate: "2026-11-13", endTime: "20:00" }, ctx, now).ok).toBe(true);
  });
  it("applies the same rules as publishing to the fields they share", () => {
    const pub = (o: Record<string, unknown>) =>
      validatePostingInput({ ...base, expiry: "1w", real: { lat: 37.87, lng: -122.27 }, ...o }, now).ok;
    const edit = (o: Record<string, unknown>) => validatePostingEdit({ ...base, ...o }, ctx, now).ok;
    const cases: Record<string, unknown>[] = [
      {}, { title: "" }, { categorySlug: "nope" }, { rsvpUrl: "javascript:alert(1)" }, { rsvpUrl: "https://ok.example" },
      { eventDate: "2026-11-01" }, { eventDate: "11/12/2026" }, { endDate: "2026-11-11" }, { endTime: "25:00" }, { eventDate: null, endDate: "2026-11-13" },
    ];
    for (const c of cases) expect(edit(c)).toBe(pub(c));
  });
});
