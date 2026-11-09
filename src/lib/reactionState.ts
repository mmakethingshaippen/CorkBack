import type { PlanKind, ReactionCounts } from "./types";

/**
 * Pure helpers for likes and plans. Requests carry the DESIRED state (not a
 * toggle), so a retried or repeated request is idempotent.
 */

export const PLAN_KINDS: PlanKind[] = ["going", "interested"];

export function parseLikeBody(b: unknown): { ok: true; liked: boolean } | { ok: false } {
  if (!b || typeof b !== "object") return { ok: false };
  const liked = (b as Record<string, unknown>).liked;
  return typeof liked === "boolean" ? { ok: true, liked } : { ok: false };
}

export function parsePlanBody(b: unknown): { ok: true; kind: PlanKind | null } | { ok: false } {
  if (!b || typeof b !== "object" || !("kind" in b)) return { ok: false };
  const kind = (b as Record<string, unknown>).kind;
  if (kind === null) return { ok: true, kind: null };
  return PLAN_KINDS.includes(kind as PlanKind) ? { ok: true, kind: kind as PlanKind } : { ok: false };
}

const nonNeg = (n: number) => Math.max(0, n);

/** Counts after the viewer moves from `wasLiked` to `liked` (optimistic view). */
export function applyLike(counts: ReactionCounts, wasLiked: boolean, liked: boolean): ReactionCounts {
  if (wasLiked === liked) return counts;
  return { ...counts, likes: nonNeg(counts.likes + (liked ? 1 : -1)) };
}

/** Counts after the viewer's plan moves from `prev` to `next`. Plans are mutually exclusive. */
export function applyPlan(counts: ReactionCounts, prev: PlanKind | null, next: PlanKind | null): ReactionCounts {
  if (prev === next) return counts;
  const out = { ...counts };
  if (prev) out[prev] = nonNeg(out[prev] - 1);
  if (next) out[next] = out[next] + 1;
  return out;
}

/** Choosing the selected plan again clears it; choosing the other one switches. */
export function nextPlan(current: PlanKind | null, clicked: PlanKind): PlanKind | null {
  return current === clicked ? null : clicked;
}

export function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}
