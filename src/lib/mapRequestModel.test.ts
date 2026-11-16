/**
 * Property 35: Stale responses never overwrite newer ones.
 * Feature: board-usability-improvements
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { buildMapRequest, createMapRequestModel } from "./mapRequestModel";

const BOUNDS = { west: -122.4, south: 37.8, east: -122.2, north: 37.9 };
const req = (category: string | null) => buildMapRequest({ bounds: BOUNDS, category, mode: "pins" });
const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

type Op =
  | { t: "begin"; cat: string | null }
  | { t: "desire"; cat: string | null }
  | { t: "deliver"; i: number; outcome: "ok" | "fail" | "abort" };

const catArb = fc.constantFrom<string | null>(null, "music", "housing");
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ t: fc.constant("begin" as const), cat: catArb }),
  fc.record({ t: fc.constant("desire" as const), cat: catArb }),
  fc.record({
    t: fc.constant("deliver" as const),
    i: fc.nat(30),
    outcome: fc.constantFrom<"ok" | "fail" | "abort">("ok", "fail", "abort"),
  }),
);

describe("Property 35: Stale responses never overwrite newer ones", () => {
  // **Validates: Requirements 15.4, 15.5, 6.7**
  it("state equals the latest request's result; superseded, category-mismatched and aborted responses change nothing", () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        const model = createMapRequestModel<number>();
        const begun: { seq: number; cat: string | null; aborted: boolean; settled?: boolean }[] = [];
        let desired: string | null = null;
        // Reference state, computed independently.
        let items: number[] = [];
        let status: "idle" | "loading" | "ready" | "error" = "idle";

        for (const op of ops) {
          if (op.t === "begin") {
            const entry = { seq: 0, cat: op.cat, aborted: false };
            entry.seq = model.begin(req(op.cat), () => {
              entry.aborted = true;
            });
            begun.push(entry);
            desired = op.cat;
            status = "loading";
          } else if (op.t === "desire") {
            model.setDesiredCategory(op.cat);
            desired = op.cat;
          } else if (begun.length > 0) {
            const idx = op.i % begun.length;
            const b = begun[idx];
            const before = model.getState();
            const isLatest = idx === begun.length - 1;
            const accepted = isLatest && b.cat === desired;
            if (op.outcome === "ok") {
              const value = [idx];
              expect(model.succeed(b.seq, b.cat, { items: value, truncated: false })).toBe(accepted);
              if (accepted) {
                b.settled = true;
                items = value;
                status = "ready";
              }
            } else if (op.outcome === "fail") {
              expect(model.fail(b.seq, b.cat, new Error("boom"))).toBe(accepted);
              if (accepted) {
                b.settled = true;
                status = "error";
              }
            } else {
              // Aborted-by-replacement is never an error, whatever its sequence.
              expect(model.fail(b.seq, b.cat, abortError())).toBe(false);
              expect(model.getState()).toEqual(before);
            }
          }
          const s = model.getState();
          expect(s.items).toEqual(items);
          expect(s.status).toBe(status);
        }
        // Every replaced, unsettled request was told to abort.
        begun.slice(0, -1).forEach((b) => expect(b.aborted).toBe(!b.settled));
      }),
      { numRuns: 300 },
    );
  });

  it("example: slow old response arriving after a newer one is dropped", () => {
    const m = createMapRequestModel<string>();
    const s1 = m.begin(req(null));
    const s2 = m.begin(req(null));
    expect(m.succeed(s2, null, { items: ["new"], truncated: false })).toBe(true);
    expect(m.succeed(s1, null, { items: ["old"], truncated: true })).toBe(false);
    expect(m.getState().items).toEqual(["new"]);
    expect(m.fail(s1, null, abortError())).toBe(false);
    expect(m.getState().status).toBe("ready");
    expect(m.getState().error).toBeNull();
  });
});

