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
