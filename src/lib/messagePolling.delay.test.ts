import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_POLL, pollDelayMs } from "./messagePolling";

// Feature: board-usability-improvements, Property 21: Poll delay is bounded and backs off
// **Validates: Requirements 17.1, 17.2, 17.4**

const rand = fc.double({ min: 0, max: 1, noNaN: true }).filter((r) => r < 1);
const failures = fc.integer({ min: -1000, max: 1000 });
const quiet = fc.oneof(
  fc.integer({ min: -1_000_000, max: 10_000_000 }),
  fc.constant(Number.MAX_SAFE_INTEGER),
  fc.constant(Number.POSITIVE_INFINITY),
);

const clamp = (n: number) => Math.max(1000, Math.min(60000, n));

describe("pollDelayMs (Property 21)", () => {
  it("uses 5 s ±15% before 120 s quiet and 15 s ±15% after, with 0 failures", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 119_999 }), rand, (q, r) => {
        const d = pollDelayMs({ failures: 0, msSinceNew: q }, DEFAULT_POLL, r);
        expect(d).toBeGreaterThanOrEqual(5000 * 0.85 - 1);
        expect(d).toBeLessThanOrEqual(5000 * 1.15 + 1);
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 120_000, max: 10_000_000 }), rand, (q, r) => {
        const d = pollDelayMs({ failures: 0, msSinceNew: q }, DEFAULT_POLL, r);
        expect(d).toBeGreaterThanOrEqual(15000 * 0.85 - 1);
        expect(d).toBeLessThanOrEqual(15000 * 1.15 + 1);
      }),
    );
  });

  it("equals base × 2^min(f,10) with jitter applied before clamping to [1 s, 60 s]", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), quiet, rand, (f, q, r) => {
        const base = q >= 120_000 ? 15000 : 5000;
        const expected = clamp(Math.round(base * 2 ** Math.min(f, 10) * (1 + 0.15 * (2 * r - 1))));
        expect(pollDelayMs({ failures: f, msSinceNew: q }, DEFAULT_POLL, r)).toBe(expected);
      }),
    );
  });

  it("stays within [1 s, 60 s] for any inputs", () => {
    fc.assert(
      fc.property(failures, quiet, rand, (f, q, r) => {
        const d = pollDelayMs({ failures: f, msSinceNew: q }, DEFAULT_POLL, r);
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThanOrEqual(60000);
      }),
    );
  });

  it("is monotone non-decreasing in failures for a fixed random value", () => {
    fc.assert(
      fc.property(failures, fc.integer({ min: 0, max: 1000 }), quiet, rand, (f, extra, q, r) => {
        const a = pollDelayMs({ failures: f, msSinceNew: q }, DEFAULT_POLL, r);
        const b = pollDelayMs({ failures: f + extra, msSinceNew: q }, DEFAULT_POLL, r);
        expect(b).toBeGreaterThanOrEqual(a);
      }),
    );
  });
});
