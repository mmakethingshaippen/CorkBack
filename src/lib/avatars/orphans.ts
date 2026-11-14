import { ORPHAN_AGE_MS } from "./constants";

export type StoredObject = { name: string; created_at?: string | null };

/**
 * Files in a user's folder that may be swept: not the current photo, and older
 * than the orphan age (so an upload still in flight in another tab is never
 * removed). Unknown or invalid timestamps are kept, to be safe.
 */
export function selectOrphans(objects: StoredObject[], currentName: string | null, now: number): string[] {
  const out: string[] = [];
  for (const o of objects) {
    if (!o.name || o.name === currentName) continue;
    const t = o.created_at ? Date.parse(o.created_at) : NaN;
    if (!Number.isFinite(t)) continue;
    if (now - t >= ORPHAN_AGE_MS) out.push(o.name);
  }
  return out;
}