// Server only. The only file that calls the shared geocoder throttle and cache
// (stage 14: cb_geocoder_take_slot, cb_geocoder_cache, cb_geocoder_purge_cache).
// Pass a service role client; every object is service_role only.
//
// Reads and the throttle THROW on any database error (including stage 14 not
// applied). The route treats a throw as "store unavailable" and answers 503
// without calling Nominatim, so upstream is never reached unthrottled.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaceMatch } from "./geocode";

export interface GeocoderStore {
  /** wait in ms (0 to maxWaitMs), or null when the next slot is further away than maxWaitMs. Throws on a database error. */
  takeSlot(maxWaitMs: number): Promise<number | null>;
  /** Unexpired cached matches for the key, or null. Throws on a database error. */
  cacheGet(key: string): Promise<PlaceMatch[] | null>;
  /** Writes with a 24 h expiry, then calls the purge. Errors are returned to the caller, not thrown. */
  cachePut(key: string, matches: PlaceMatch[]): Promise<{ ok: boolean; code?: string }>;
  purgeExpired(): Promise<number>;
}

/** 24 h minus a minute, so the row stays inside the table check (expires_at <= created_at + 24 h) despite clock skew. */
const TTL_MS = 24 * 60 * 60 * 1000 - 60 * 1000;

function fail(code: string | undefined, what: string): Error {
  return new Error(`geocoder store ${what} failed${code ? ` (${code})` : ""}`);
}

export function createGeocoderStore(client: SupabaseClient): GeocoderStore {
  async function purgeExpired(): Promise<number> {
    const { data, error } = await client.rpc("cb_geocoder_purge_cache");
    if (error) throw fail(error.code, "purge");
    return typeof data === "number" ? data : 0;
  }

  return {
    async takeSlot(maxWaitMs) {
      const { data, error } = await client.rpc("cb_geocoder_take_slot", { p_max_wait_ms: Math.round(maxWaitMs) });
      if (error) throw fail(error.code, "slot");
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      const wait = (row as { wait_ms?: unknown }).wait_ms;
      if (typeof wait !== "number" || !Number.isFinite(wait)) throw fail(undefined, "slot (bad answer)");
      return Math.max(0, wait);
    },

    async cacheGet(key) {
      const { data, error } = await client
        .from("cb_geocoder_cache")
        .select("results")
        .eq("key_hash", key)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (error) throw fail(error.code, "cache read");
      if (!data || !Array.isArray(data.results)) return null;
      return data.results as PlaceMatch[];
    },

    async cachePut(key, matches) {
      try {
        // Replace any older row for this key so created_at and expires_at stay consistent.
        const del = await client.from("cb_geocoder_cache").delete().eq("key_hash", key);
        if (del.error) return { ok: false, code: del.error.code };
        const ins = await client
          .from("cb_geocoder_cache")
          .insert({ key_hash: key, results: matches, expires_at: new Date(Date.now() + TTL_MS).toISOString() });
        if (ins.error) return { ok: false, code: ins.error.code };
      } catch {
        return { ok: false, code: "exception" };
      }
      try {
        await purgeExpired();
      } catch {
        // A failed purge never fails the write; the hourly sweep retries it.
      }
      return { ok: true };
    },

    purgeExpired,
  };
}
