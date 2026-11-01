import type { Posting } from "./types";

/**
 * Stage 4 — promoted postings. Label + placement only (no payment/billing).
 *
 * Placement rule: within the same area and category, a promoted posting sorts
 * ahead of ordinary postings. Ordinary ordering is otherwise unchanged — this
 * is a STABLE partition, so among promoted (and among ordinary) the original
 * relative order is preserved. Promotion changes nothing else (no alert email,
 * no messaging/Follow/Connect/Like effect).
 *
 * "Area" is derived from a coarse geographic bucket so that promotion only
 * jumps a posting ahead of its local, same-category peers — not globally.
 */

/** Coarse area bucket from lat/lng (~11 km cells). Promotion is scoped to this. */
export function areaKey(p: { lat: number; lng: number }): string {
  const lat = Math.round(p.lat * 10) / 10;
  const lng = Math.round(p.lng * 10) / 10;
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

function groupKey(p: Posting): string {
  return `${areaKey(p)}|${p.categorySlug}`;
}

/**
 * Promotion only applies while a posting is live. The caller passes only active
 * (non-expired, non-deleted) postings; this treats isPromoted as effective only
 * for those. A helper for the single-posting case:
 */
export function isEffectivelyPromoted(
  p: { isPromoted: boolean },
  active: boolean,
): boolean {
  return active && p.isPromoted;
}

/**
 * Order postings so that, within each (area, category) group, promoted ones come
 * first. Across groups and within the promoted/ordinary partition, the input
 * order is preserved (stable). Input is assumed to be active postings.
 */
export function orderWithPromoted(postings: Posting[]): Posting[] {
  // Record the original index to make the sort stable and group-local.
  const indexed = postings.map((p, i) => ({ p, i }));

  // For each group, is there promotion? We only reorder *within* a group: a
  // promoted posting moves ahead of ordinary peers in the SAME group, without
  // disturbing the global order of groups or the order of items in other groups.
  //
  // Implementation: stable sort by (group's first-seen order, promoted-first,
  // original index). This keeps each group's block contiguous in its original
  // position and only flips promoted ahead of ordinary inside that block.
  const groupFirstSeen = new Map<string, number>();
  indexed.forEach(({ p, i }) => {
    const k = groupKey(p);
    if (!groupFirstSeen.has(k)) groupFirstSeen.set(k, i);
  });

  return indexed
    .slice()
    .sort((a, b) => {
      const ga = groupFirstSeen.get(groupKey(a.p))!;
      const gb = groupFirstSeen.get(groupKey(b.p))!;
      if (ga !== gb) return ga - gb; // keep groups in their original appearance order
      // same group: promoted first
      if (a.p.isPromoted !== b.p.isPromoted) return a.p.isPromoted ? -1 : 1;
      return a.i - b.i; // stable within the partition
    })
    .map((x) => x.p);
}
