// Feature: board-usability-improvements, Properties 19 and 20 (pure; no network).
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mergeMessages, sortMessages } from "./messaging";

interface Msg {
  id: string;
  created_at: string;
  body: string;
}

// A handful of ISO timestamps so collisions are the norm, not the exception.
const STAMPS = [0, 1, 2, 3, 4].map((i) => `2026-11-08T10:00:0${i}.000000+00:00`);
const idArb = fc.integer({ min: 0, max: 30 }).map((n) => `id-${String(n).padStart(2, "0")}`);
const stampArb = fc.constantFrom(...STAMPS);
// One message per id (a message's content never changes), as on the server.
const pool = fc
  .uniqueArray(fc.record({ id: idArb, created_at: stampArb }), { selector: (m) => m.id, maxLength: 20 })
  .map((rs) => rs.map((r): Msg => ({ ...r, body: `body ${r.id}` })));

const cmp = (a: Msg, b: Msg) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

describe("Property 19: Message merge is idempotent and duplicate-free", () => {
  /** Validates: Requirements 17.9 */
  it("any overlapping, reordered, duplicated batches merge to the sorted union", () => {
    fc.assert(
      fc.property(
        pool,
        fc.array(fc.array(fc.nat({ max: 1000 }), { maxLength: 25 }), { maxLength: 6 }),
        fc.boolean(),
        (all, batchIdx, reverse) => {
          const batches = batchIdx.map((ix) => ix.map((i) => all[i % Math.max(all.length, 1)]).filter(Boolean));
          const ordered = reverse ? [...batches].reverse() : batches;
          const merged = ordered.reduce<Msg[]>((acc, b) => mergeMessages(acc, b), []);

          const union = [...new Map(batches.flat().map((m) => [m.id, m])).values()];
          const once = mergeMessages([], union);

          expect(new Set(merged.map((m) => m.id)).size).toBe(merged.length);
          expect(merged).toEqual([...union].sort(cmp));
          expect(merged).toEqual(once);
          expect(merged).toEqual(sortMessages(merged));
          // Idempotent: merging again with anything already present changes nothing.
          expect(mergeMessages(merged, merged)).toEqual(merged);
          expect(mergeMessages(merged, batches.flat())).toEqual(merged);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("Property 20: Cursor fetch equals full fetch", () => {
  /** Validates: Requirements 17.8 */
  it("repeated after=newest fetches (inclusive, colliding timestamps) equal a full fetch", () => {
    type Op = { kind: "insert"; bump: number } | { kind: "fetch" };
    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({ kind: fc.constant("insert" as const), bump: fc.integer({ min: 0, max: 2 }) }),
      fc.constant({ kind: "fetch" as const }),
    );
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 2 }), { maxLength: 8 }), // initial: non-decreasing steps
        fc.array(opArb, { maxLength: 30 }),
        (initialSteps, ops) => {
          const server: Msg[] = [];
          let clock = 0; // index into time; the DB clock never goes backwards
          let nextId = 0;
          const insert = (bump: number) => {
            clock += bump; // bump 0 => same timestamp as the current newest
            const stamp = `2026-11-08T10:00:00.${String(clock).padStart(6, "0")}+00:00`;
            // Ids are random-ish (uuid-like), not in insertion order.
            const id = `m-${String((nextId++ * 7919) % 1000).padStart(4, "0")}-${nextId}`;
            server.push({ id, created_at: stamp, body: id });
          };
          // Server query: created_at >= after (string compare), ordered by (created_at, id).
          const fetchAfter = (after?: string) =>
            server.filter((m) => after === undefined || m.created_at >= after).sort(cmp);

          initialSteps.forEach(insert);
          let shown: Msg[] = mergeMessages([], fetchAfter());
          const poll = () => {
            const newest = shown.length ? shown[shown.length - 1].created_at : undefined;
            shown = mergeMessages(shown, fetchAfter(newest));
            expect(new Set(shown.map((m) => m.id)).size).toBe(shown.length);
          };
          for (const op of ops) {
            if (op.kind === "insert") insert(op.bump);
            else poll();
          }
          poll(); // final catch-up

          expect(shown).toEqual(fetchAfter());
        },
      ),
      { numRuns: 300 },
    );
  });

  it("an insert sharing the newest timestamp is not lost", () => {
    const a: Msg = { id: "b", created_at: STAMPS[1], body: "" };
    const late: Msg = { id: "a", created_at: STAMPS[1], body: "" };
    const server = [a];
    const fetchAfter = (after: string) => server.filter((m) => m.created_at >= after);
    let shown = mergeMessages<Msg>([], server);
    server.push(late);
    shown = mergeMessages(shown, fetchAfter(shown[shown.length - 1].created_at));
    expect(shown.map((m) => m.id)).toEqual(["a", "b"]);
  });
});
