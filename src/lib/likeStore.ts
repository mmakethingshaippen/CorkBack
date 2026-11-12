/**
 * Last CONFIRMED like state per posting, for this browser tab only (memory).
 *
 * Pages are server-rendered with the viewer's saved state, so a fresh load is
 * right. But back/forward navigation can show a page from the client router
 * cache, rendered before a like was changed elsewhere (card vs detail page).
 *
 * Both sides carry SERVER timestamps: a store entry records when the like
 * route confirmed it (`at` in its response), and a page records when it read
 * the data (`stateAt`). An entry wins only if it is newer than the render, so
 * a fresh render (which may include other people's likes since) always wins,
 * and a cached older render shows the newer confirmed state. A full refresh
 * clears the store.
 */
export interface LikeEntry {
  liked: boolean;
  likes: number;
}

interface StoredLike extends LikeEntry {
  at: number; // server time (ms) the like route confirmed it
}

const store = new Map<string, StoredLike>();

const toMs = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

export function setConfirmedLike(postingId: string, entry: LikeEntry, serverAt: string | null | undefined): void {
  const at = toMs(serverAt);
  const prev = store.get(postingId);
  if (prev && prev.at > at) return; // keep the newer confirmation
  store.set(postingId, { liked: entry.liked, likes: entry.likes, at });
}

/** What to show on mount: the confirmed entry if newer than this render, else the server props. */
export function initialLike(postingId: string, server: LikeEntry, renderedAt: string | null | undefined): LikeEntry {
  const e = store.get(postingId);
  if (e && e.at > toMs(renderedAt)) return { liked: e.liked, likes: e.likes };
  return server;
}

/**
 * Same idea for the viewer's Going/Interested plan. The entry carries the
 * plan and both public plan totals (a plan change moves both).
 */
export interface PlanEntry {
  plan: "going" | "interested" | null;
  going: number;
  interested: number;
}

interface StoredPlan extends PlanEntry {
  at: number;
}

const planStore = new Map<string, StoredPlan>();

export function setConfirmedPlan(postingId: string, entry: PlanEntry, serverAt: string | null | undefined): void {
  const at = toMs(serverAt);
  const prev = planStore.get(postingId);
  if (prev && prev.at > at) return;
  planStore.set(postingId, { ...entry, at });
}

export function initialPlan(postingId: string, server: PlanEntry, renderedAt: string | null | undefined): PlanEntry {
  const e = planStore.get(postingId);
  if (e && e.at > toMs(renderedAt)) return { plan: e.plan, going: e.going, interested: e.interested };
  return server;
}

/** Test helper. */
export function clearLikeStore(): void {
  store.clear();
  planStore.clear();
}
