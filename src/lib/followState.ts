import { isPostingActive } from "./lifecycle";
import type { Posting } from "./types";

/**
 * Pure follow rules. Follow is ONE-WAY and independent of friendship
 * (connections): nothing here reads or writes connections.
 */

/** Requests carry the DESIRED state (idempotent), never a toggle. */
export function parseFollowBody(b: unknown): { ok: true; following: boolean } | { ok: false } {
  if (!b || typeof b !== "object") return { ok: false };
  const following = (b as Record<string, unknown>).following;
  return typeof following === "boolean" ? { ok: true, following } : { ok: false };
}

/** A user can never follow themselves (also enforced by the no_self_follow CHECK). */
export function canFollow(viewerId: string | null, targetId: string): boolean {
  return Boolean(viewerId) && viewerId !== targetId;
}

/**
 * The Following feed: active postings by followed authors, newest first.
 * Each row pairs a posting with its author id (author ids are never sent to
 * the client; only the public username is on the posting).
 */
export function buildFollowingFeed(
  rows: { posting: Posting; authorId: string }[],
  followedIds: ReadonlySet<string>,
  now: Date = new Date(),
): Posting[] {
  return rows
    .filter((r) => followedIds.has(r.authorId) && isPostingActive(r.posting, now))
    .map((r) => r.posting)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
}

/**
 * Following feed with category follows: people-follow postings plus active
 * postings in followed categories, de-duplicated by id, newest first.
 */
export function mergeCategoryPostings(
  people: Posting[],
  active: Posting[],
  followedSlugs: ReadonlySet<string>,
  now: Date = new Date(),
): Posting[] {
  const byId = new Map<string, Posting>();
  for (const p of people) byId.set(p.id, p);
  for (const p of active) {
    if (followedSlugs.has(p.categorySlug) && isPostingActive(p, now)) byId.set(p.id, byId.get(p.id) ?? p);
  }
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
}
