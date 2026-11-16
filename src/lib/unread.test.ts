import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  advanceMarker,
  applyUnreadResult,
  badgeText,
  classifyUnreadResponse,
  INITIAL_UNREAD_STATE,
  messagesAriaLabel,
  shouldStopUnread,
  totalUnread,
  unreadCount,
  type UnreadClientState,
  type UnreadMessage,
} from "./unread";

// Feature: board-usability-improvements, Property 23: Unread count is exact and monotone

const T0 = Date.UTC(2020, 0, 1);
const tsArb = fc
  .integer({ min: 0, max: 1_000_000 })
  .map((s) => new Date(T0 + s * 1000).toISOString());
const msgArb: fc.Arbitrary<UnreadMessage> = fc.record({
  sender_id: fc.constantFrom("me", "you", "other"),
  created_at: tsArb,
});
const msgsArb = fc.array(msgArb, { maxLength: 40 });
const markerArb = fc.option(tsArb, { nil: null });

const brute = (ms: UnreadMessage[], viewer: string, marker: string | null) =>
  ms.filter(
    (m) =>
      m.sender_id !== viewer &&
      (marker === null || Date.parse(m.created_at) > Date.parse(marker)),
  ).length;

describe("Property 23: unread count", () => {
  /** **Validates: Requirements 18.3, 18.4, 18.6** */
  it("equals a brute-force count of other-participant messages after the marker", () => {
    fc.assert(
      fc.property(msgsArb, markerArb, (ms, marker) => {
        expect(unreadCount(ms, "me", marker)).toBe(brute(ms, "me", marker));
      }),
      { numRuns: 200 },
    );
  });

  it("never counts the viewer's own messages", () => {
    fc.assert(
      fc.property(msgsArb, markerArb, (ms, marker) => {
        const own = ms.map((m) => ({ ...m, sender_id: "me" }));
        expect(unreadCount(own, "me", marker)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("advancing the marker never increases the count nor moves the marker back", () => {
    fc.assert(
      fc.property(msgsArb, markerArb, tsArb, (ms, marker, upTo) => {
        const next = advanceMarker(marker, upTo);
        expect(unreadCount(ms, "me", next)).toBeLessThanOrEqual(
          unreadCount(ms, "me", marker),
        );
        if (marker) {
          expect(Date.parse(next)).toBeGreaterThanOrEqual(Date.parse(marker));
        }
        expect(Date.parse(next)).toBeGreaterThanOrEqual(Date.parse(upTo));
      }),
      { numRuns: 200 },
    );
  });

  it("totalUnread sums valid counts and ignores negative / non-finite", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.nat(50),
            fc.integer({ min: -50, max: -1 }),
            fc.constantFrom(NaN, Infinity, -Infinity),
          ),
          { maxLength: 15 },
        ),
        (vals) => {
          const rec: Record<string, number> = {};
          vals.forEach((v, i) => (rec[`t${i}`] = v));
          const expected = vals
            .filter((v) => Number.isFinite(v) && v > 0)
            .reduce((a, b) => a + b, 0);
          expect(totalUnread(rec)).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("badge and aria label", () => {
  it("badgeText", () => {
    expect(badgeText(0)).toBeNull();
    for (let n = 1; n <= 9; n++) expect(badgeText(n)).toBe(String(n));
    expect(badgeText(10)).toBe("9+");
    expect(badgeText(250)).toBe("9+");
  });
  it("messagesAriaLabel carries the exact count", () => {
    expect(messagesAriaLabel(0)).toBe("Messages");
    expect(messagesAriaLabel(1)).toBe("Messages, 1 unread");
    expect(messagesAriaLabel(37)).toBe("Messages, 37 unread");
  });
  it("aria label uses exact N for any positive count", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000 }), (n) => {
        expect(messagesAriaLabel(n)).toBe(`Messages, ${n} unread`);
      }),
    );
  });
});

describe("stop rules", () => {
  const live: UnreadClientState = {
    supported: true,
    stopped: false,
    total: 3,
    byThread: { a: 3 },
  };

  it("classifies responses", () => {
    expect(classifyUnreadResponse(401, null)).toEqual({ kind: "unauthorized" });
    expect(classifyUnreadResponse(200, { supported: false })).toEqual({ kind: "unsupported" });
    expect(classifyUnreadResponse(500, {})).toEqual({ kind: "failed" });
    expect(classifyUnreadResponse(200, null)).toEqual({ kind: "failed" });
    expect(
      classifyUnreadResponse(200, { supported: true, total: 2, byThread: { a: 2 } }),
    ).toEqual({ kind: "ok", total: 2, byThread: { a: 2 } });
  });

  it("supported:false stops for good", () => {
    const s = applyUnreadResult(live, classifyUnreadResponse(200, { supported: false }));
    expect(s.supported).toBe(false);
    expect(shouldStopUnread(s)).toBe(true);
  });

  it("401 stops for good", () => {
    const s = applyUnreadResult(live, classifyUnreadResponse(401, {}));
    expect(shouldStopUnread(s)).toBe(true);
  });

  it("other failures keep last counts and supported, and do not stop", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 300, max: 599 }).filter((n) => n !== 401),
        (status) => {
          const s = applyUnreadResult(live, classifyUnreadResponse(status, {}));
          expect(s).toEqual(live);
          expect(shouldStopUnread(s)).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
    const fresh = applyUnreadResult(INITIAL_UNREAD_STATE, { kind: "failed" });
    expect(fresh.supported).toBeNull();
    expect(shouldStopUnread(fresh)).toBe(false);
  });
});
