import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildFollowingFeed, canFollow, mergeCategoryPostings, parseFollowBody } from "./followState";
import type { Posting } from "./types";

const now = new Date("2026-11-08T20:00:00Z");
function post(id: string, over: Partial<Posting> = {}): Posting {
  return {
    id, title: id, body: "", categorySlug: "community", flyerUrl: null, rsvpUrl: null,
    eventDate: null, eventTime: null, timeZone: "America/Los_Angeles", placeLabel: "",
    lat: 37.87, lng: -122.27, expiry: "1w", expiresAt: "2026-11-15T00:00:00Z", isPromoted: false,
    authorUsername: "u", likeCount: 0, goingCount: 0, interestedCount: 0,
    createdAt: "2026-11-01T00:00:00Z", ...over,
  };
}

describe("follow request parsing", () => {
  it("accepts only a boolean desired state", () => {
    expect(parseFollowBody({ following: true })).toEqual({ ok: true, following: true });
    expect(parseFollowBody({ following: false })).toEqual({ ok: true, following: false });
    expect(parseFollowBody({ following: "yes" })).toEqual({ ok: false });
    expect(parseFollowBody({})).toEqual({ ok: false });
    expect(parseFollowBody(null)).toEqual({ ok: false });
  });
});

describe("self-follow", () => {
  it("is never allowed; signed-out cannot follow", () => {
    expect(canFollow("a", "a")).toBe(false);
    expect(canFollow(null, "a")).toBe(false);
    expect(canFollow("a", "b")).toBe(true);
  });
});

describe("Following feed", () => {
  it("keeps only active postings by followed authors, newest first", () => {
    const rows = [
      { authorId: "f1", posting: post("old", { createdAt: "2026-11-01T00:00:00Z" }) },
      { authorId: "f1", posting: post("new", { createdAt: "2026-11-07T00:00:00Z" }) },
      { authorId: "f2", posting: post("ended", { eventDate: "2026-11-05" }) },
      { authorId: "f2", posting: post("expired", { expiresAt: "2026-11-08T19:00:00Z" }) },
      { authorId: "x", posting: post("notfollowed", { createdAt: "2026-11-08T00:00:00Z" }) },
    ];
    expect(buildFollowingFeed(rows, new Set(["f1", "f2"]), now).map((p) => p.id)).toEqual(["new", "old"]);
  });

  it("is empty when following no one", () => {
    expect(buildFollowingFeed([{ authorId: "a", posting: post("p") }], new Set(), now)).toEqual([]);
  });

  it("never includes an unfollowed author or an inactive posting (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({
          authorId: fc.constantFrom("a", "b", "c"),
          day: fc.integer({ min: 1, max: 20 }),
          expired: fc.boolean(),
        }), { maxLength: 20 }),
        fc.subarray(["a", "b", "c"]),
        (specs, followed) => {
          const rows = specs.map((s, i) => ({
            authorId: s.authorId,
            posting: post(`p${i}`, {
              createdAt: `2026-11-${String(s.day).padStart(2, "0")}T00:00:00Z`,
              expiresAt: s.expired ? "2026-11-08T00:00:00Z" : "2026-12-01T00:00:00Z",
            }),
          }));
          const feed = buildFollowingFeed(rows, new Set(followed), now);
          const byId = new Map(rows.map((r) => [r.posting.id, r]));
          const sorted = feed.every((p, i) => i === 0 || feed[i - 1].createdAt >= p.createdAt);
          return sorted && feed.every((p) => followed.includes(byId.get(p.id)!.authorId) && p.expiresAt > now.toISOString());
        },
      ),
    );
  });
});

describe("mergeCategoryPostings", () => {
  it("adds active postings in followed categories, de-duplicates, newest first", () => {
    const a = post("a", { createdAt: "2026-11-02T00:00:00Z" });
    const b = post("b", { categorySlug: "music", createdAt: "2026-11-03T00:00:00Z" });
    const c = post("c", { categorySlug: "jobs", createdAt: "2026-11-04T00:00:00Z" });
    const out = mergeCategoryPostings([a, b], [a, b, c], new Set(["music"]), now);
    expect(out.map((p) => p.id)).toEqual(["b", "a"]);
  });
});
