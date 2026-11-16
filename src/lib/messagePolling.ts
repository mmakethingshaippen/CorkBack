/**
 * Pure polling scheduler for thread auto-refresh (Stage 5a).
 * No React or DOM dependency; all time and visibility come from injected functions.
 */

export interface PollConfig {
  baseMs: number;
  idleMs: number;
  idleAfterMs: number;
  maxMs: number;
  jitter: number;
}

export const DEFAULT_POLL: PollConfig = {
  baseMs: 5000,
  idleMs: 15000,
  idleAfterMs: 120000,
  maxMs: 60000,
  jitter: 0.15,
};

/** rand01 in [0,1). Result is always within [1000, cfg.maxMs]. */
export function pollDelayMs(
  s: { failures: number; msSinceNew: number },
  cfg: PollConfig,
  rand01: number,
): number {
  const quiet = s.msSinceNew >= cfg.idleAfterMs ? cfg.idleMs : cfg.baseMs;
  const backed = quiet * 2 ** Math.min(Math.max(0, s.failures), 10);
  const spread = 1 + cfg.jitter * (2 * rand01 - 1);
  return Math.max(1000, Math.min(cfg.maxMs, Math.round(backed * spread)));
}

export type PollOutcome =
  | { kind: "ok"; added: number }
  | { kind: "retry" }
  | { kind: "stop" };

export interface Poller {
  start(): void;
  stop(): void;
  poke(): void;
}

export function createPoller(deps: {
  run: () => Promise<PollOutcome>;
  isHidden: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  random: () => number;
  cfg?: PollConfig;
}): Poller {
  const { run, isHidden, now, setTimer, clearTimer, random } = deps;
  const cfg = deps.cfg ?? DEFAULT_POLL;

  let timer: unknown = undefined;
  let hasTimer = false;
  let inFlight = false;
  let failures = 0;
  let lastNewAt = now();
  let stopped = true;

  function cancel() {
    if (hasTimer) {
      clearTimer(timer);
      hasTimer = false;
      timer = undefined;
    }
  }

  function schedule() {
    if (stopped || isHidden()) return;
    cancel();
    timer = setTimer(() => {
      hasTimer = false;
      void tick();
    }, pollDelayMs({ failures, msSinceNew: now() - lastNewAt }, cfg, random()));
    hasTimer = true;
  }

  async function tick(): Promise<void> {
    if (stopped || isHidden() || inFlight) {
      schedule();
      return;
    }
    inFlight = true;
    try {
      const o = await run();
      if (o.kind === "stop") {
        stopped = true;
        cancel();
        return;
      }
      if (o.kind === "ok") {
        failures = 0;
        if (o.added > 0) lastNewAt = now();
      } else {
        failures++;
      }
    } catch {
      failures++;
    } finally {
      inFlight = false;
    }
    schedule();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      failures = 0;
      lastNewAt = now();
      schedule();
    },
    stop() {
      stopped = true;
      cancel();
    },
    poke() {
      if (inFlight || stopped || isHidden()) return;
      cancel();
      void tick();
    },
  };
}
