import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  allowedActions,
  parseConnectionBody,
  prefixPattern,
  relationshipFrom,
  resultingRelationship,
  SEARCH_RE,
  type ConnectionRow,
} from "./connectionState";

const row = (requester_id: string, addressee_id: string, status: ConnectionRow["status"]): ConnectionRow => ({
  requester_id, addressee_id, status,
});

describe("relationship state", () => {
  it("derives none / outgoing / incoming / friends from the viewer's side", () => {
    expect(relationshipFrom([], "me", "x")).toBe("none");
    expect(relationshipFrom([row("me", "x", "pending")], "me", "x")).toBe("outgoing");
    expect(relationshipFrom([row("x", "me", "pending")], "me", "x")).toBe("incoming");
    expect(relationshipFrom([row("x", "me", "accepted")], "me", "x")).toBe("friends");
    expect(relationshipFrom([row("me", "x", "accepted")], "me", "x")).toBe("friends");
    expect(relationshipFrom([row("me", "y", "accepted")], "me", "x")).toBe("none");
  });

  it("only the recipient is offered accept/decline; only the requester can cancel", () => {
    expect(allowedActions("incoming")).toEqual(["accept", "decline"]);
    expect(allowedActions("outgoing")).toEqual(["cancel"]);
    expect(allowedActions("friends")).toEqual(["remove"]);
    expect(allowedActions("none")).toEqual(["send"]);
  });

  it("each offered action leads to a consistent state (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom<"none" | "outgoing" | "incoming" | "friends">("none", "outgoing", "incoming", "friends"), (rel) =>
        allowedActions(rel).every((a) => {
          const next = resultingRelationship(a);
          return next !== rel; // every action changes the state
        }),
      ),
    );
  });
});

describe("request parsing", () => {
  it("accepts only known actions with a username", () => {
    expect(parseConnectionBody({ action: "send", username: "a_b" })).toEqual({ ok: true, action: "send", username: "a_b" });
    expect(parseConnectionBody({ action: "befriend", username: "a" })).toEqual({ ok: false });
    expect(parseConnectionBody({ action: "send" })).toEqual({ ok: false });
    expect(parseConnectionBody(null)).toEqual({ ok: false });
  });
});

describe("username search", () => {
  it("requires 2-20 username characters", () => {
    expect(SEARCH_RE.test("a")).toBe(false);
    expect(SEARCH_RE.test("ab")).toBe(true);
    expect(SEARCH_RE.test("a b")).toBe(false);
    expect(SEARCH_RE.test("a%")).toBe(false);
  });

  it("escapes LIKE wildcards so '_' matches only a literal underscore", () => {
    expect(prefixPattern("cb_s")).toBe("cb\\_s%");
    expect(prefixPattern("ab")).toBe("ab%");
  });
});
