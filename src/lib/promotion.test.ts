import { describe, it, expect } from "vitest";
import { orderWithPromoted, isEffectivelyPromoted, areaKey } from "./promotion";
import type { Posting } from "./types";

function post(over: Partial<Posting>): Posting {
  return {
    id: over.id ?? "x",
    title: over.title ?? "t",
    body: "",
    categorySlug: over.categorySlug ?? "music",
    flyerUrl: null,
    rsvpUrl: null,
    eventDate: null,
    eventTime: null,
    placeLabel: "",
    lat: over.lat ?? 51.5,
    lng: over.lng ?? -0.12,
    expiry: "1w",
    expiresAt: "2999-01-01T00:00:00.000Z",
    isPromoted: over.isPromoted ?? false,
    authorUsername: over.authorUsername ?? "u",
    likeCount: 0,
    goingCount: 0,
    interestedCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("promoted placement", () => {
  it("puts a promoted posting first within the same area and category", () => {
    const list = [
      post({ id: "o1", categorySlug: "music", isPromoted: false }),
      post({ id: "o2", categorySlug: "music", isPromoted: false }),
      post({ id: "promo", categorySlug: "music", isPromoted: true }),
    ];
    const ordered = orderWithPromoted(list);
    expect(ordered[0].id).toBe("promo");
    // ordinary postings keep their relative order after the promoted one
    expect(ordered.map((p) => p.id)).toEqual(["promo", "o1", "o2"]);
  });

  it("leaves ordinary ordering unchanged when there is no promotion", () => {
    const list = [
      post({ id: "a", categorySlug: "music" }),
      post({ id: "b", categorySlug: "music" }),
      post({ id: "c", categorySlug: "music" }),
    ];
    expect(orderWithPromoted(list).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("does NOT jump a promoted posting ahead of a different category", () => {
    // Different category = different group; group order is preserved.
    const list = [
      post({ id: "music1", categorySlug: "music", isPromoted: false }),
      post({ id: "sportspromo", categorySlug: "sports", isPromoted: true }),
    ];
    const ordered = orderWithPromoted(list);
    // music group appeared first, so it stays first; the promoted sports posting
    // does not leapfrog the music posting (different category).
    expect(ordered.map((p) => p.id)).toEqual(["music1", "sportspromo"]);
  });

  it("does NOT jump a promoted posting ahead of a different area", () => {
    const london = { lat: 51.5, lng: -0.12 };
    const berlin = { lat: 52.5, lng: 13.4 };
    const list = [
      post({ id: "londonOrdinary", categorySlug: "music", ...london, isPromoted: false }),
      post({ id: "berlinPromo", categorySlug: "music", ...berlin, isPromoted: true }),
    ];
    const ordered = orderWithPromoted(list);
    // Different area = different group; the Berlin promo does not move ahead of
    // the London ordinary posting.
    expect(ordered.map((p) => p.id)).toEqual(["londonOrdinary", "berlinPromo"]);
  });

  it("promotes within a group but keeps other groups' order", () => {
    const london = { lat: 51.5, lng: -0.12 };
    const list = [
      post({ id: "L_o1", categorySlug: "music", ...london }),
      post({ id: "L_promo", categorySlug: "music", ...london, isPromoted: true }),
      post({ id: "L_o2", categorySlug: "music", ...london }),
    ];
    // Within the single London/music group: promo first, ordinary order kept.
    expect(orderWithPromoted(list).map((p) => p.id)).toEqual(["L_promo", "L_o1", "L_o2"]);
  });
});

describe("promotion lifetime", () => {
  it("is effective only while the posting is live/active", () => {
    expect(isEffectivelyPromoted({ isPromoted: true }, true)).toBe(true);
    // expired/inactive → promotion does not apply even if the flag is set
    expect(isEffectivelyPromoted({ isPromoted: true }, false)).toBe(false);
    expect(isEffectivelyPromoted({ isPromoted: false }, true)).toBe(false);
  });
});

describe("area bucketing", () => {
  it("buckets nearby points together and far points apart", () => {
    expect(areaKey({ lat: 51.50, lng: -0.12 })).toBe(areaKey({ lat: 51.51, lng: -0.12 }));
    expect(areaKey({ lat: 51.5, lng: -0.12 })).not.toBe(areaKey({ lat: 52.5, lng: 13.4 }));
  });
});
