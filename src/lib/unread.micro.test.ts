import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { advanceMarker, compareInstants, parseInstantMicros, unreadCount } from "./unread";

// Postgres keeps microseconds; the client must not collapse instants in the same millisecond.
describe("microsecond precision (found by supabase/isolated-test/twoaccount.mjs)", () => {
  const marked = "2026-11-16T17:17:15.472583+00:00";
  const later = "2026-11-16T17:17:15.472999+00:00";
  it("orders instants within one millisecond", () => {
    expect(compareInstants(later, marked)).toBe(1);
    expect(compareInstants(marked, later)).toBe(-1);
    expect(compareInstants(marked, marked)).toBe(0);
    expect(compareInstants("2026-11-16T09:17:15.472999-08:00", marked)).toBe(1); // offsets are honoured
  });
  it("advanceMarker moves to a later instant in the same millisecond", () => {
    expect(advanceMarker(marked, later)).toBe(later);
    expect(advanceMarker(later, marked)).toBe(later);
  });
  it("unreadCount counts a same-millisecond, later-microsecond message as unread", () => {
    expect(unreadCount([{ sender_id: "a", created_at: later }], "b", marked)).toBe(1);
    expect(unreadCount([{ sender_id: "a", created_at: marked }], "b", marked)).toBe(0);
  });
  it("whole seconds and millisecond-only strings still work", () => {
    expect(parseInstantMicros("2026-11-16T17:17:15Z")).toEqual([Date.parse("2026-11-16T17:17:15Z"), 0]);
    expect(compareInstants("2026-11-16T17:17:15.473Z", marked)).toBe(1);
    expect(Number.isNaN(compareInstants("not a date", marked))).toBe(true);
  });
  it("property: agrees with exact microsecond integers", () => {
    const base = Date.parse("2026-01-01T00:00:00Z") * 1000;
    const iso = (us: number) => {
      const ms = Math.floor(us / 1000);
      const d = new Date(ms).toISOString().slice(0, 19);
      const frac = String(us % 1000000).padStart(6, "0");
      return `${d}.${frac}+00:00`;
    };
    fc.assert(fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: 0, max: 5_000_000 }), (a, b) => {
      expect(compareInstants(iso(base + a), iso(base + b))).toBe(Math.sign(a - b));
    }), { numRuns: 500 });
  });
});
