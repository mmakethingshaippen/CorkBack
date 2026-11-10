import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyLike, applyPlan, isUuid, nextPlan, parseLikeBody, parsePlanBody } from "./reactionState";
import type { PlanKind } from "./types";

const zero = { likes: 0, going: 0, interested: 0 };
const kind = fc.constantFrom<PlanKind | null>("going", "interested", null);

describe("request parsing", () => {
  it("accepts only a boolean desired like state", () => {
    expect(parseLikeBody({ liked: true })).toEqual({ ok: true, liked: true });
    expect(parseLikeBody({ liked: false })).toEqual({ ok: true, liked: false });
    expect(parseLikeBody({ liked: "yes" })).toEqual({ ok: false });
    expect(parseLikeBody({})).toEqual({ ok: false });
    expect(parseLikeBody(null)).toEqual({ ok: false });
  });

  it("accepts going, interested, or null (clear) for plans", () => {
    expect(parsePlanBody({ kind: "going" })).toEqual({ ok: true, kind: "going" });
    expect(parsePlanBody({ kind: "interested" })).toEqual({ ok: true, kind: "interested" });
    expect(parsePlanBody({ kind: null })).toEqual({ ok: true, kind: null });
    expect(parsePlanBody({ kind: "maybe" })).toEqual({ ok: false });
    expect(parsePlanBody({})).toEqual({ ok: false });
  });

  it("validates posting ids", () => {
    expect(isUuid("ffe92f35-622f-490e-a76a-e420088f0c61")).toBe(true);
    expect(isUuid("london-quiet-sounds")).toBe(false);
  });
});

describe("like counts", () => {
  it("like then unlike returns to the start", () => {
    expect(applyLike(applyLike(zero, false, true), true, false)).toEqual(zero);
  });

  it("repeating the same desired state changes nothing (idempotent)", () => {
    const once = applyLike(zero, false, true);
    expect(applyLike(once, true, true)).toEqual(once);
  });

  it("never goes negative", () => {
    expect(applyLike(zero, true, false).likes).toBe(0);
  });
});

describe("plan counts", () => {
  it("switching moves one count from one plan to the other", () => {
    const going = applyPlan(zero, null, "going");
    expect(going).toEqual({ likes: 0, going: 1, interested: 0 });
    expect(applyPlan(going, "going", "interested")).toEqual({ likes: 0, going: 0, interested: 1 });
  });

  it("clicking the selected plan clears it; the other switches", () => {
    expect(nextPlan("going", "going")).toBeNull();
    expect(nextPlan("going", "interested")).toBe("interested");
    expect(nextPlan(null, "going")).toBe("going");
  });

  it("the viewer contributes at most one plan at a time (property)", () => {
    fc.assert(
      fc.property(fc.array(kind, { maxLength: 30 }), (steps) => {
        let counts = zero;
        let current: PlanKind | null = null;
        for (const next of steps) {
          counts = applyPlan(counts, current, next);
          current = next;
        }
        return counts.going + counts.interested === (current ? 1 : 0) &&
          (current === "going" ? counts.going === 1 : counts.going === 0);
      }),
    );
  });
});
