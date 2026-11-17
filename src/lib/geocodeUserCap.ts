/**
 * Per-user sliding-window cap for geocoder requests (server only).
 *
 * Per server instance, so best effort: it limits one signed-in user's repeated
 * taps. The application-wide 1 request/second policy limit is enforced by the
 * shared Supabase throttle (geocoderStore / cb_geocoder_take_slot), not here.
 */

export interface UserCap {
  /** Returns true and records the call when the user is under the cap, else false. */
  take(userId: string): boolean;
}

export function createUserCap(opts: {
  max: number;
  windowMs: number;
  now: () => number;
}): UserCap {
  const { max, windowMs, now } = opts;
  // Timestamps of granted calls per user, oldest first.
  const grants = new Map<string, number[]>();

  return {
    take(userId: string): boolean {
      const t = now();
      const cutoff = t - windowMs;
      const live = (grants.get(userId) ?? []).filter((ts) => ts > cutoff);

      if (live.length >= max) {
        grants.set(userId, live);
        return false;
      }

      live.push(t);
      grants.set(userId, live);

      // Drop users whose calls have all expired so the map does not grow forever.
      if (grants.size > 1000) {
        for (const [id, list] of grants) {
          if (list.length === 0 || list[list.length - 1] <= cutoff) grants.delete(id);
        }
      }
      return true;
    },
  };
}
