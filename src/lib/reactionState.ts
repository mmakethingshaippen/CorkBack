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

/**
 * Accessible name for a Like toggle (approved wording). It names the action the
 * button performs and keeps the count; selection itself is `aria-pressed`.
 */
export function likeButtonLabel(liked: boolean, likes: number): string {
  return `${liked ? "Unlike" : "Like"} this posting. ${countLabel(likes, "like", "likes")}`;
}

/** Readable text for a failed like save, from the like route's `code`. */
export function likeErrorMessage(code: string | undefined, error: string | undefined): string {
  if (code === "signed_out") return "Your session has ended. Sign in again to save this.";
  if (code === "ended") return "This posting has ended. Likes are closed.";
  if (code === "not_found") return "This posting is no longer available.";
  return error ?? "Could not save. Try again.";
}

/**
 * Accessible name for a Going / Interested toggle. Names the action and keeps
 * the total; selection itself is `aria-pressed`.
 */
export function planButtonLabel(kind: PlanKind, selected: boolean, count: number): string {
  const word = kind === "going" ? "Going" : "Interested";
  const verb = selected ? `Clear ${word}` : `Mark ${word}`;
  return `${verb}. ${count} ${kind === "going" ? "going" : "interested"}`;
}

/** Readable text for a failed plan save, from the plan route's `code`. */
export function planErrorMessage(code: string | undefined, error: string | undefined): string {
  if (code === "ended") return "This posting has ended. Plans are closed.";
  return likeErrorMessage(code, error);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}
