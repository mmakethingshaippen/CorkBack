import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isUuid, mergeMessages, MESSAGE_WHITESPACE_CLASS, nextClientKey, sortMessages, validateMessageBody } from "./messaging";

let n = 0;
const make = () => `k${++n}`;

describe("send idempotency key", () => {
  it("reuses the key while retrying the same draft", () => {
    const first = nextClientKey(null, "hello", make);
    expect(nextClientKey(first, "hello", make)).toBe(first);
  });

  it("uses a new key when the text changes", () => {
    const first = nextClientKey(null, "hello", make);
    expect(nextClientKey(first, "hello!", make).key).not.toBe(first.key);
  });

  it("uses a new key after a successful send (previous cleared), even for the same words", () => {
    const first = nextClientKey(null, "hello", make);
    const afterSuccess = nextClientKey(null, "hello", make);
    expect(afterSuccess.key).not.toBe(first.key);
  });
});

describe("message ordering", () => {
  const m = (id: string, created_at: string) => ({ id, created_at, sender_id: "s", body: id });

  it("orders by server time, then id", () => {
    const list = [m("b", "2026-11-08T10:00:00Z"), m("a", "2026-11-08T10:00:00Z"), m("c", "2026-11-08T09:00:00Z")];
    expect(sortMessages(list).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("merging never duplicates and stays ordered (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: fc.constantFrom("a", "b", "c", "d", "e"), t: fc.integer({ min: 0, max: 5 }) }), { maxLength: 12 }),
        fc.array(fc.record({ id: fc.constantFrom("a", "b", "c", "d", "e"), t: fc.integer({ min: 0, max: 5 }) }), { maxLength: 12 }),
        (xs, ys) => {
          const toMsg = (r: { id: string; t: number }) => m(r.id, `2026-11-08T10:0${r.t}:00Z`);
          const dedupe = (rs: { id: string; t: number }[]) => [...new Map(rs.map((r) => [r.id, r])).values()];
          const merged = mergeMessages(dedupe(xs).map(toMsg), dedupe(ys).map(toMsg));
          const ids = merged.map((x) => x.id);
          const ordered = merged.every((x, i) => i === 0 || merged[i - 1].created_at <= x.created_at);
          return new Set(ids).size === ids.length && ordered;
        },
      ),
    );
  });
});

describe("validation", () => {
  it("accepts uuids only as ids", () => {
    expect(isUuid("6c5e0000-0000-4000-8000-00000000004a")).toBe(true);
    expect(isUuid("../etc")).toBe(false);
  });
  it("matches the database body check (trimmed 1..2000)", () => {
    expect(validateMessageBody("   ").ok).toBe(false);
    expect(validateMessageBody("x".repeat(2000)).ok).toBe(true);
    expect(validateMessageBody("x".repeat(2001)).ok).toBe(false);
  });

  it("rejects whitespace-only bodies made of tabs, newlines, and Unicode spaces", () => {
    for (const blank of ["\t", "\n", "\r\n", " \t\n ", "\u00a0", "\u3000", "\u2028", "\ufeff", "\v\f"]) {
      expect(validateMessageBody(blank).ok).toBe(false);
    }
    // Zero-width space is not whitespace to trim() (or to the DB class): allowed in both.
    expect(validateMessageBody("\u200b").ok).toBe(true);
  });

  it("the shared whitespace class is exactly what trim() removes, for every BMP character", () => {
    // Same class text the database check uses; JS regex reads the same escapes.
    const ws = new RegExp(`^[${MESSAGE_WHITESPACE_CLASS}]$`);
    const mismatches: string[] = [];
    for (let c = 0; c <= 0xffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue; // lone surrogates are not characters
      const ch = String.fromCharCode(c);
      if ((ch.trim() === "") !== ws.test(ch)) mismatches.push(c.toString(16));
    }
    expect(mismatches).toEqual([]);
  });

  it("the class text is the one written in the migration", () => {
    expect(MESSAGE_WHITESPACE_CLASS).toBe(" \\t\\n\\v\\f\\r\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff");
  });
});
