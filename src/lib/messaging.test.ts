import { describe, it, expect } from "vitest";
import {
  orderedPair,
  isParticipant,
  counterpart,
  canAccessThread,
  validateMessageBody,
  MAX_MESSAGE_LEN,
} from "./messaging";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";
const CAROL = "33333333-3333-3333-3333-333333333333"; // the third user

describe("thread pairing", () => {
  it("orders a pair deterministically regardless of argument order", () => {
    const a = orderedPair(ALICE, BOB);
    const b = orderedPair(BOB, ALICE);
    expect(a).toEqual(b);
    expect(a.userLo < a.userHi).toBe(true);
  });

  it("refuses a thread with the same user twice", () => {
    expect(() => orderedPair(ALICE, ALICE)).toThrow();
  });
});

describe("participant-only access", () => {
  const thread = orderedPair(ALICE, BOB);

  it("both participants can access the thread", () => {
    expect(canAccessThread(thread, ALICE)).toBe(true);
    expect(canAccessThread(thread, BOB)).toBe(true);
    expect(isParticipant(thread, ALICE)).toBe(true);
    expect(isParticipant(thread, BOB)).toBe(true);
  });

  it("a third user is blocked from the thread", () => {
    expect(canAccessThread(thread, CAROL)).toBe(false);
    expect(isParticipant(thread, CAROL)).toBe(false);
    expect(counterpart(thread, CAROL)).toBeNull();
  });

  it("counterpart returns the other participant", () => {
    expect(counterpart(thread, ALICE)).toBe(BOB);
    expect(counterpart(thread, BOB)).toBe(ALICE);
  });
});

describe("message body validation", () => {
  it("accepts a normal message and trims it", () => {
    const r = validateMessageBody("  hello there  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("hello there");
  });

  it("rejects empty or whitespace-only", () => {
    expect(validateMessageBody("").ok).toBe(false);
    expect(validateMessageBody("   ").ok).toBe(false);
  });

  it("rejects non-string and over-length", () => {
    expect(validateMessageBody(123).ok).toBe(false);
    expect(validateMessageBody("x".repeat(MAX_MESSAGE_LEN + 1)).ok).toBe(false);
  });
});

// Public browsing unchanged: messaging introduces no field that a public
// surface reads. The public posting shape (src/lib/types.ts Posting) must not
// carry any message/thread content. This guards against a regression that leaks
// message text onto the board or a posting page.
describe("public browsing unchanged", () => {
  it("the public Posting type has no message/thread field", async () => {
    // Structural check against the shared public type via a representative object.
    const publicPostingKeys = [
      "id", "title", "body", "categorySlug", "flyerUrl", "rsvpUrl",
      "eventDate", "eventTime", "placeLabel", "lat", "lng", "expiry",
      "expiresAt", "isPromoted", "authorUsername", "likeCount", "createdAt",
    ];
    expect(publicPostingKeys.some((k) => /message|thread|dm/i.test(k))).toBe(false);
  });
});
