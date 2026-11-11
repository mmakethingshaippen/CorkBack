import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { likeButtonLabel, likeErrorMessage, applyLike } from "./reactionState";
import { clearLikeStore, initialLike, setConfirmedLike } from "./likeStore";

describe("like button label (approved wording)", () => {
  it("names the action and keeps the count", () => {
    expect(likeButtonLabel(false, 0)).toBe("Like this posting. 0 likes");
    expect(likeButtonLabel(false, 1)).toBe("Like this posting. 1 like");
    expect(likeButtonLabel(true, 1)).toBe("Unlike this posting. 1 like");
    expect(likeButtonLabel(true, 12)).toBe("Unlike this posting. 12 likes");
  });
});

describe("like error messages", () => {
  it("explains sign-out, ended and unavailable postings; falls back to the server text", () => {
    expect(likeErrorMessage("signed_out", undefined)).toMatch(/session has ended/);
    expect(likeErrorMessage("ended", "x")).toMatch(/has ended/);
    expect(likeErrorMessage("not_found", "x")).toMatch(/no longer available/);
    expect(likeErrorMessage("write_failed", "Could not save. Try again.")).toBe("Could not save. Try again.");
    expect(likeErrorMessage(undefined, undefined)).toBe("Could not save. Try again.");
  });
});

describe("optimistic like count", () => {
  it("never goes negative and is a no-op when unchanged (property)", () => {
    fc.assert(
      fc.property(fc.nat(1000), fc.boolean(), fc.boolean(), (likes, was, now) => {
        const out = applyLike({ likes, going: 0, interested: 0 }, was, now).likes;
        if (was === now) return out === likes;
        return out === (now ? likes + 1 : Math.max(0, likes - 1));
      }),
    );
  });
});

describe("card/detail like consistency store", () => {
  beforeEach(() => clearLikeStore());
  const server = { liked: false, likes: 3 };

  it("uses server props when nothing was confirmed in this tab", () => {
    expect(initialLike("p1", server, "2026-11-10T10:00:00Z")).toEqual(server);
  });

  it("a confirmation NEWER than the render wins (back/forward to a cached page)", () => {
    setConfirmedLike("p1", { liked: true, likes: 4 }, "2026-11-10T10:00:05Z");
    expect(initialLike("p1", server, "2026-11-10T10:00:00Z")).toEqual({ liked: true, likes: 4 });
  });

  it("a FRESH render newer than the confirmation wins (includes other people's likes since)", () => {
    setConfirmedLike("p1", { liked: true, likes: 4 }, "2026-11-10T10:00:05Z");
    const fresh = { liked: true, likes: 9 };
    expect(initialLike("p1", fresh, "2026-11-10T10:01:00Z")).toEqual(fresh);
  });

  it("an older confirmation never replaces a newer one", () => {
    setConfirmedLike("p1", { liked: false, likes: 3 }, "2026-11-10T10:00:09Z");
    setConfirmedLike("p1", { liked: true, likes: 4 }, "2026-11-10T10:00:05Z");
    expect(initialLike("p1", server, "2026-11-10T10:00:00Z")).toEqual({ liked: false, likes: 3 });
  });

  it("entries are per posting", () => {
    setConfirmedLike("p1", { liked: true, likes: 4 }, "2026-11-10T10:00:05Z");
    expect(initialLike("p2", server, "2026-11-10T10:00:00Z")).toEqual(server);
  });
});
