/**
 * Pure unread helpers (Stage 5b). No React, DOM or clock access.
 * Unread = messages from the OTHER participant created after the viewer's
 * read marker (all of theirs when there is no marker).
 */

export interface UnreadMessage {
  sender_id: string;
  created_at: string;
}

/** Number of messages that are unread for `viewerId` given `marker` (raw created_at or null). */
/**
 * A timestamp as [epoch milliseconds, extra microseconds 0-999], or null when it
 * cannot be read. Postgres stores microseconds and compares created_at > marker
 * at that precision; Date.parse keeps only milliseconds, so two instants in the
 * same millisecond would otherwise look equal and a newer message would never be
 * marked read.
 */
export function parseInstantMicros(s: string | null | undefined): [number, number] | null {
  if (!s) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  const frac = /T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(s);
  const extra = frac ? Number((frac[1] + "000000").slice(3, 6)) : 0;
  return [ms, extra];
}

/** Sign of a - b at microsecond precision; NaN when either side cannot be read. */
export function compareInstants(a: string | null | undefined, b: string | null | undefined): number {
  const x = parseInstantMicros(a), y = parseInstantMicros(b);
  if (!x || !y) return Number.NaN;
  return Math.sign(x[0] - y[0] || x[1] - y[1]);
}

export function unreadCount(
  messages: readonly UnreadMessage[],
  viewerId: string,
  marker: string | null | undefined,
): number {
  const hasMarker = parseInstantMicros(marker) !== null;
  let n = 0;
  for (const m of messages) {
    if (m.sender_id === viewerId) continue;
    if (!hasMarker || compareInstants(m.created_at, marker) > 0) n += 1;
  }
  return n;
}

/** Marking read never moves the marker backwards. Returns the raw timestamp to keep. */
export function advanceMarker(
  current: string | null | undefined,
  upTo: string,
): string {
  if (!current) return upTo;
  if (!parseInstantMicros(upTo)) return current;
  if (!parseInstantMicros(current)) return upTo;
  return compareInstants(upTo, current) > 0 ? upTo : current;
}

/** Sum of per-thread counts. Ignores non-finite and negative values. */
export function totalUnread(byThread: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(byThread)) {
    if (Number.isFinite(v) && v > 0) total += Math.floor(v);
  }
  return total;
}

/** Badge text: null at 0, "1".."9", "9+" at 10 or more. */
export function badgeText(total: number): string | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  const n = Math.floor(total);
  if (n <= 0) return null;
  return n >= 10 ? "9+" : String(n);
}

/** Accessible label for the Messages link, with the exact total. */
export function messagesAriaLabel(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "Messages";
  const n = Math.floor(total);
  return n <= 0 ? "Messages" : `Messages, ${n} unread`;
}

/** Result of one unread fetch, as seen by the client. */
export type UnreadFetchResult =
  | { kind: "ok"; total: number; byThread: Record<string, number> }
  | { kind: "unsupported" }
  | { kind: "unauthorized" }
  | { kind: "failed" };

export interface UnreadClientState {
  supported: boolean | null; // null until known
  stopped: boolean;
  total: number;
  byThread: Record<string, number>;
}

export const INITIAL_UNREAD_STATE: UnreadClientState = {
  supported: null,
  stopped: false,
  total: 0,
  byThread: {},
};

/**
 * Stop rules: stop for good after `supported: false` or a 401. Any other
 * failure keeps the last counts, leaves `supported` as it was and does not stop.
 */
export function applyUnreadResult(
  state: UnreadClientState,
  result: UnreadFetchResult,
): UnreadClientState {
  switch (result.kind) {
    case "ok":
      return {
        supported: true,
        stopped: false,
        total: result.total,
        byThread: result.byThread,
      };
    case "unsupported":
      return { supported: false, stopped: true, total: 0, byThread: {} };
    case "unauthorized":
      return { ...state, stopped: true, total: 0, byThread: {} };
    case "failed":
      return state;
  }
}

/** Classify an HTTP status and parsed body into a fetch result. */
export function classifyUnreadResponse(
  status: number,
  body: unknown,
): UnreadFetchResult {
  if (status === 401) return { kind: "unauthorized" };
  if (status !== 200 || typeof body !== "object" || body === null) {
    return { kind: "failed" };
  }
  const b = body as {
    supported?: unknown;
    total?: unknown;
    byThread?: unknown;
  };
  if (b.supported === false) return { kind: "unsupported" };
  if (
    b.supported === true &&
    typeof b.total === "number" &&
    typeof b.byThread === "object" &&
    b.byThread !== null
  ) {
    return {
      kind: "ok",
      total: b.total,
      byThread: b.byThread as Record<string, number>,
    };
  }
  return { kind: "failed" };
}

/** True when the client should make no further unread requests. */
export function shouldStopUnread(state: UnreadClientState): boolean {
  return state.stopped || state.supported === false;
}
