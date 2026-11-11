import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { REPLY_MAX, addReply, replyErrorResponse, sortReplies, validateReplyBody } from "./replies";

describe("validateReplyBody", () => {
  it("accepts 1 to 1000 characters and trims", () => {
    expect(validateReplyBody("  hello  ")).toEqual({ ok: true, value: "hello" });
    expect(validateReplyBody("x".repeat(REPLY_MAX)).ok).toBe(true);
    expect(validateReplyBody("x".repeat(REPLY_MAX + 1)).ok).toBe(false);
  });
  it("rejects blank and whitespace-only text, including Unicode spaces", () => {
    for (const s of ["", " ", "\n\t ", "\u00a0", "\u3000\ufeff", "\u2003\u2028"]) expect(validateReplyBody(s).ok).toBe(false);
    expect(validateReplyBody(5).ok).toBe(false);
    expect(validateReplyBody(null).ok).toBe(false);
  });
  it("agrees with String.trim(): a body is blank exactly when trim() is empty", () => {
    fc.assert(fc.property(fc.string({ maxLength: 40 }), (s) => validateReplyBody(s).ok === (s.trim().length > 0)));
  });
});

describe("replyErrorResponse", () => {
  it("maps each database error to a readable response that keeps the draft", () => {
    expect(replyErrorResponse("42501").status).toBe(401);
    expect(replyErrorResponse("CB404").status).toBe(404);
    expect(replyErrorResponse("CB409").status).toBe(409);
    expect(replyErrorResponse("CB413").status).toBe(413);
    expect(replyErrorResponse("CB422").status).toBe(400);
    expect(replyErrorResponse("CB429").status).toBe(429);
    expect(replyErrorResponse("CB429").error).toMatch(/draft is kept/);
    expect(replyErrorResponse("weird").status).toBe(500);
  });
});

describe("reply list", () => {
  const r = (id: string, createdAt: string) => ({ id, createdAt, body: id, authorId: "a", authorUsername: "u" });
  it("is oldest first with a stable tie-break", () => {
    const list = sortReplies([r("b", "2026-11-10T10:00:00Z"), r("c", "2026-11-10T09:00:00Z"), r("a", "2026-11-10T10:00:00Z")]);
    expect(list.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("adding the same reply twice (a retry) never duplicates it", () => {
    const one = r("a", "2026-11-10T10:00:00Z");
    expect(addReply(addReply([], one), one)).toHaveLength(1);
  });
});
