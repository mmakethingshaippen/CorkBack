import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createUserCap } from "./geocodeUserCap";

const MAX = 20;
const WINDOW = 600000;

describe("createUserCap", () => {
  // Feature: posting-location-confirmation, Property 15: The per-user cap never exceeds its limit
  // **Validates: Requirements 4.14**
  it("grants at most max calls per user in any window and counts users separately", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            user: fc.constantFrom("a", "b", "c"),
            dt: fc.integer({ min: 0, max: 120000 }),
          }),
          { maxLength: 150 },
        ),
        (calls) => {
          let clock = 0;
          const cap = createUserCap({ max: MAX, windowMs: WINDOW, now: () => clock });
          const granted = new Map<string, number[]>();
          for (const c of calls) {
            clock += c.dt;
            const ok = cap.take(c.user);
            const list = granted.get(c.user) ?? [];
            const live = list.filter((t) => t > clock - WINDOW).length;
            // Expected decision from the model: under the cap in the window -> granted.
            expect(ok).toBe(live < MAX);
            if (ok) list.push(clock);
            granted.set(c.user, list);
          }
          // No window of length WINDOW holds more than MAX grants for one user.
          for (const list of granted.values()) {
            for (let i = 0; i + MAX < list.length; i++) {
              expect(list[i + MAX] - list[i]).toBeGreaterThanOrEqual(WINDOW);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("grants again once the window has passed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (start) => {
        let clock = start;
        const cap = createUserCap({ max: MAX, windowMs: WINDOW, now: () => clock });
        for (let i = 0; i < MAX; i++) expect(cap.take("u")).toBe(true);
        expect(cap.take("u")).toBe(false);
        expect(cap.take("other")).toBe(true);
        clock += WINDOW;
        expect(cap.take("u")).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
