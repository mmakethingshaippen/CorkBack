import { describe, it, expect } from "vitest";
import { alertMatchesPosting, withinRadius, distanceMiles, type AlertRule, type PostingForMatch } from "./alerts";

const FUTURE = "2999-01-01T00:00:00.000Z";

// Alert: music, centered on central London, 5-mile radius, owned by user "owner".
const alert: AlertRule = {
  id: "a1",
  ownerId: "owner",
  categorySlug: "music",
  centerLat: 51.5074,
  centerLng: -0.1278,
  radiusMiles: 5,
};

function posting(over: Partial<PostingForMatch>): PostingForMatch {
  return {
    id: "p1",
    authorId: "someone-else",
    categorySlug: "music",
    lat: 51.5074,
    lng: -0.1278,
    expiresAt: FUTURE,
    eventDate: null,
    deletedAt: null,
    ...over,
  };
}

describe("alert matching", () => {
  it("matches a same-category posting inside the radius", () => {
    // ~2 miles north of center.
    const p = posting({ lat: 51.536, lng: -0.1278 });
    expect(distanceMiles(alert, p)).toBeLessThan(5);
    expect(alertMatchesPosting(alert, p)).toBe(true);
  });

  it("does NOT match a posting outside the radius", () => {
    // ~20 miles away.
    const p = posting({ lat: 51.79, lng: -0.1278 });
    expect(distanceMiles(alert, p)).toBeGreaterThan(5);
    expect(withinRadius(alert, p)).toBe(false);
    expect(alertMatchesPosting(alert, p)).toBe(false);
  });

  it("does NOT match a posting in a different category", () => {
    const p = posting({ categorySlug: "sports" }); // same location, wrong category
    expect(alertMatchesPosting(alert, p)).toBe(false);
  });

  it("does NOT match the alert owner's own posting", () => {
    const p = posting({ authorId: "owner" });
    expect(alertMatchesPosting(alert, p)).toBe(false);
  });

  it("does NOT match a hidden posting", () => {
    const p = posting({});
    expect(alertMatchesPosting(alert, p, { hidden: true })).toBe(false);
  });

  it("does NOT match an expired posting", () => {
    const p = posting({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(alertMatchesPosting(alert, p)).toBe(false);
  });

  it("does NOT match a past-event posting even if expiry is in the future", () => {
    const p = posting({ eventDate: "2020-01-01", expiresAt: FUTURE });
    expect(alertMatchesPosting(alert, p)).toBe(false);
  });

  it("a whole-town alert (null radius) matches nearby but not far postings", () => {
    const townAlert: AlertRule = { ...alert, radiusMiles: null, townName: "London" };
    const near = posting({ lat: 51.52, lng: -0.1 }); // within the town cap
    const far = posting({ lat: 55.95, lng: -3.19 }); // Edinburgh
    expect(alertMatchesPosting(townAlert, near)).toBe(true);
    expect(alertMatchesPosting(townAlert, far)).toBe(false);
  });
});

// Dedupe is enforced by the sent_alerts ledger: a sweep only emails (alert,
// posting) pairs not already present. This models that set logic.
describe("sweep dedupe", () => {
  function newPairs(
    candidates: Array<{ alertId: string; postingId: string }>,
    alreadySent: Set<string>,
  ) {
    return candidates.filter((c) => !alreadySent.has(`${c.alertId}:${c.postingId}`));
  }

  it("sends each (alert, posting) pair only once across repeated sweeps", () => {
    const candidates = [
      { alertId: "a1", postingId: "p1" },
      { alertId: "a1", postingId: "p2" },
    ];
    const sent = new Set<string>();

    // First sweep: both are new → both send, then recorded.
    const first = newPairs(candidates, sent);
    expect(first).toHaveLength(2);
    first.forEach((c) => sent.add(`${c.alertId}:${c.postingId}`));

    // Second sweep, same candidates: none are new → no duplicate emails.
    const second = newPairs(candidates, sent);
    expect(second).toHaveLength(0);
  });
});

// Stage 3 lifecycle cases (Requirement 12). A listing Deadline is stored as
// end_date with event_date null; a Community notice may have no date at all.
// The lifecycle end is 23:59:59.999 local time and a posting is active while
// now < end, so the last matching instant is 23:59:59.998 and the end instant
// itself no longer matches.
describe("alert matching: listing Deadline, Community notice, Community event", () => {
  const LA = "America/Los_Angeles";
  const at = (iso: string) => new Date(iso);
  const plus = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms);

  function listing(over: Partial<PostingForMatch>): PostingForMatch {
    return posting({ eventDate: null, endDate: "2025-11-01", endTime: null, timeZone: LA, ...over });
  }

  describe("listing with a Deadline", () => {
    it("matches through the end of the deadline day in its zone and not after (PDT)", () => {
      const p = listing({ endDate: "2025-11-01", expiresAt: "2026-01-01T00:00:00.000Z" });
      const end = "2025-11-02T06:59:59.999Z"; // 23:59:59.999 PDT
      expect(alertMatchesPosting(alert, p, { now: at("2025-11-01T00:00:00.000Z") })).toBe(true);
      expect(alertMatchesPosting(alert, p, { now: plus(end, -1) })).toBe(true);
      expect(alertMatchesPosting(alert, p, { now: at(end) })).toBe(false);
      expect(alertMatchesPosting(alert, p, { now: plus(end, 1) })).toBe(false);
    });

    it("uses the 25-hour fall-back day (deadline 2025-11-02, PST at day end)", () => {
      const p = listing({ endDate: "2025-11-02", expiresAt: "2026-01-01T00:00:00.000Z" });
      const end = "2025-11-03T07:59:59.999Z"; // 23:59:59.999 PST
      expect(alertMatchesPosting(alert, p, { now: plus(end, -1) })).toBe(true);
      expect(alertMatchesPosting(alert, p, { now: at(end) })).toBe(false);
    });

    it("uses the 23-hour spring-forward day (deadline 2025-03-09, PDT at day end)", () => {
      const p = listing({ endDate: "2025-03-09", expiresAt: "2026-01-01T00:00:00.000Z" });
      const end = "2025-03-10T06:59:59.999Z"; // 23:59:59.999 PDT
      expect(alertMatchesPosting(alert, p, { now: plus(end, -1) })).toBe(true);
      expect(alertMatchesPosting(alert, p, { now: at(end) })).toBe(false);
    });

    it("still matches late on the deadline day even though that is already the next UTC day", () => {
      const p = listing({ endDate: "2025-11-01", expiresAt: "2026-01-01T00:00:00.000Z" });
      expect(alertMatchesPosting(alert, p, { now: at("2025-11-02T05:00:00.000Z") })).toBe(true);
    });

    it("never matches past expires_at when expiry is before the deadline", () => {
      const expiresAt = "2025-10-20T12:00:00.000Z";
      const p = listing({ endDate: "2025-11-01", expiresAt });
      expect(alertMatchesPosting(alert, p, { now: plus(expiresAt, -1) })).toBe(true);
      expect(alertMatchesPosting(alert, p, { now: at(expiresAt) })).toBe(false);
      expect(alertMatchesPosting(alert, p, { now: at("2025-10-25T00:00:00.000Z") })).toBe(false);
    });

    it("does not match once the deadline day has ended, even with expiry far ahead", () => {
      const p = listing({ endDate: "2025-11-01", expiresAt: FUTURE });
      expect(alertMatchesPosting(alert, p, { now: at("2025-11-03T00:00:00.000Z") })).toBe(false);
    });
  });

  describe("Community notice with no event date", () => {
    it("matches until expires_at and not at or after it", () => {
      const expiresAt = "2025-12-01T08:00:00.000Z";
      const p = posting({ categorySlug: "music", eventDate: null, endDate: null, endTime: null, timeZone: LA, expiresAt });
      expect(alertMatchesPosting(alert, p, { now: at("2025-06-01T00:00:00.000Z") })).toBe(true);
      expect(alertMatchesPosting(alert, p, { now: plus(expiresAt, -1) })).toBe(true);
      expect(alertMatchesPosting(alert, p, { now: at(expiresAt) })).toBe(false);
    });

    it("is not ended early by a missing time zone", () => {
      const expiresAt = "2025-12-01T08:00:00.000Z";
      const p = posting({ eventDate: null, endDate: null, timeZone: null, expiresAt });
      expect(alertMatchesPosting(alert, p, { now: plus(expiresAt, -1) })).toBe(true);
      expect(alertMatchesPosting(alert, p, { now: at(expiresAt) })).toBe(false);
    });
  });

  describe("Community posting with an event date", () => {
    it("follows the event rule: active through the event day, then off", () => {
      const p = posting({ eventDate: "2025-11-01", endDate: null, endTime: null, timeZone: LA, expiresAt: "2026-01-01T00:00:00.000Z" });
      const end = "2025-11-02T06:59:59.999Z";
      expect(alertMatchesPosting(alert, p, { now: plus(end, -1) })).toBe(true);
      expect(alertMatchesPosting(alert, p, { now: at(end) })).toBe(false);
    });

    it("honours an explicit end time on the event day", () => {
      const p = posting({ eventDate: "2025-11-01", endDate: null, endTime: "18:30", timeZone: LA, expiresAt: "2026-01-01T00:00:00.000Z" });
      const end = "2025-11-02T01:30:00.000Z"; // 18:30 PDT
      expect(alertMatchesPosting(alert, p, { now: plus(end, -1) })).toBe(true);
      expect(alertMatchesPosting(alert, p, { now: at(end) })).toBe(false);
    });

    it("never matches past expires_at when expiry is earlier than the event end", () => {
      const expiresAt = "2025-10-30T00:00:00.000Z";
      const p = posting({ eventDate: "2025-11-01", timeZone: LA, expiresAt });
      expect(alertMatchesPosting(alert, p, { now: at(expiresAt) })).toBe(false);
    });
  });
});
