// Feature: board-usability-improvements, Property 22 (pure; fake clock, no network).
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createPoller, pollDelayMs, type PollConfig, type PollOutcome } from "./messagePolling";

// Huge idleAfterMs keeps the quiet interval at baseMs, so delay depends only on failures.
const CFG: PollConfig = { baseMs: 5000, idleMs: 15000, idleAfterMs: 1e12, maxMs: 60000, jitter: 0.15 };

type Ev =
  | { t: "advance"; ms: number }
  | { t: "show" }
  | { t: "hide" }
  | { t: "poke" }
  | { t: "complete"; kind: "ok" | "retry" | "stop"; added: number };

const evArb: fc.Arbitrary<Ev> = fc.oneof(
  { weight: 4, arbitrary: fc.integer({ min: 0, max: 70000 }).map((ms): Ev => ({ t: "advance", ms })) },
  { weight: 2, arbitrary: fc.constant<Ev>({ t: "show" }) },
  { weight: 2, arbitrary: fc.constant<Ev>({ t: "hide" }) },
  { weight: 2, arbitrary: fc.constant<Ev>({ t: "poke" }) },
  {
    weight: 4,
    arbitrary: fc.record({
      t: fc.constant("complete" as const),
      kind: fc.oneof(
        { weight: 5, arbitrary: fc.constant<"ok">("ok") },
        { weight: 5, arbitrary: fc.constant<"retry">("retry") },
        { weight: 1, arbitrary: fc.constant<"stop">("stop") },
      ),
      added: fc.integer({ min: 0, max: 3 }),
    }),
  },
);

const flush = () => new Promise<void>((r) => setImmediate(r));

async function simulate(startHidden: boolean, events: Ev[]) {
  let time = 0;
  let hidden = startHidden;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const pending: Array<(o: PollOutcome) => void> = [];
  let inFlight = 0;
  let runs = 0;
  let stoppedByOutcome = false;
  let modelFailures = 0;
  const violations: string[] = [];

  const poller = createPoller({
    run: () => {
      if (hidden) violations.push("run while hidden");
      if (inFlight > 0) violations.push("overlapping run");
      if (stoppedByOutcome) violations.push("run after stop outcome");
      inFlight++;
      runs++;
      return new Promise<PollOutcome>((res) => pending.push(res));
    },
    isHidden: () => hidden,
    now: () => time,
    setTimer: (fn, ms) => {
      if (hidden) violations.push("timer scheduled while hidden");
      const expected = pollDelayMs({ failures: modelFailures, msSinceNew: 0 }, CFG, 0.5);
      if (ms !== expected) violations.push(`delay ${ms} != expected ${expected} (failures ${modelFailures})`);
      const id = nextId++;
      timers.set(id, { at: time + ms, fn });
      return id;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
    random: () => 0.5,
    cfg: CFG,
  });

  poller.start();
  await flush();

  async function advance(ms: number) {
    const target = time + ms;
    for (;;) {
      let bestId = -1;
      let bestAt = Infinity;
      for (const [id, t] of timers) if (t.at <= target && t.at < bestAt) (bestId = id), (bestAt = t.at);
      if (bestId < 0) break;
      const t = timers.get(bestId)!;
      timers.delete(bestId);
      time = Math.max(time, t.at);
      t.fn();
      await flush();
    }
    time = target;
  }

  for (const ev of events) {
    if (ev.t === "advance") await advance(ev.ms);
    else if (ev.t === "hide") hidden = true;
    else if (ev.t === "show") {
      hidden = false;
      const before = runs;
      const canRun = inFlight === 0 && !stoppedByOutcome;
      poller.poke(); // ThreadView pokes on visibilitychange
      await flush();
      if (canRun && runs !== before + 1) violations.push(`visible poke produced ${runs - before} runs`);
      if (!canRun && runs !== before) violations.push("visible poke ran despite in-flight/stopped");
    } else if (ev.t === "poke") {
      const before = runs;
      const mayRun = inFlight === 0 && !stoppedByOutcome && !hidden;
      poller.poke();
      await flush();
      if (mayRun && runs !== before + 1) violations.push(`poke produced ${runs - before} runs`);
      if (!mayRun && runs !== before) violations.push("poke ran when it must be a no-op");
    } else {
      const res = pending.shift();
      if (!res) continue;
      inFlight--;
      if (ev.kind === "stop") {
        stoppedByOutcome = true;
        res({ kind: "stop" });
      } else if (ev.kind === "ok") {
        modelFailures = 0;
        res({ kind: "ok", added: ev.added });
      } else {
        modelFailures++;
        res({ kind: "retry" });
      }
      await flush();
    }
    if (inFlight > 1) violations.push("more than one run in flight");
    if (stoppedByOutcome && timers.size > 0) violations.push("timer pending after stop outcome");
  }

  // After a stop outcome, no amount of further time or pokes produces a run.
  if (stoppedByOutcome) {
    const before = runs;
    poller.poke();
    await advance(10 * 60000);
    if (runs !== before) violations.push("run after stop outcome (drain)");
  }
  poller.stop();
  return violations;
}

describe("createPoller (Property 22)", () => {
  /** **Validates: Requirements 17.3, 17.5, 17.6, 17.7** */
  it("never overlaps, never runs hidden, one run on visible poke, stops for good, backs off and resets", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.array(evArb, { maxLength: 40 }), async (startHidden, events) => {
        const v = await simulate(startHidden, events);
        expect(v).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it("failures lengthen the next delay and an ok resets it", async () => {
    const delays: number[] = [];
    let time = 0;
    const pending: Array<(o: PollOutcome) => void> = [];
    const fired: Array<() => void> = [];
    const p = createPoller({
      run: () => new Promise<PollOutcome>((r) => pending.push(r)),
      isHidden: () => false,
      now: () => time,
      setTimer: (fn, ms) => (delays.push(ms), fired.push(fn), fired.length),
      clearTimer: () => {},
      random: () => 0.5,
      cfg: CFG,
    });
    p.start();
    for (const kind of ["retry", "retry", "ok"] as const) {
      fired.pop()!();
      pending.shift()!(kind === "ok" ? { kind: "ok", added: 0 } : { kind: "retry" });
      await flush();
    }
    expect(delays).toEqual([5000, 10000, 20000, 5000]);
  });
});
