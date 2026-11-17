// Server only. The shared geocoder lookup core used by the route wrapper and by the
// alerts path. It runs the private-home guard, the shared cache read, the shared
// throttle, one upstream fetch, normalization and the cache write — but never the
// HTTP/auth/rate-limit decisions, which stay in the route wrapper.
//
// Nothing here logs the query, the results, the cache key or any secret. A store
// read or throttle error is surfaced as `unavailable` so the wrapper can fail closed
// without the upstream provider ever being reached unthrottled.
import "server-only";
import { buildGeocodeUrl, cacheKey } from "./geocodeQuery";
import { normalizeNominatim, type PlaceMatch } from "./geocode";
import type { GeocoderConfig } from "./geocoderConfig";
import type { GeocoderStore } from "./geocoderStore";

/**
 * States the core can produce. The wrapper maps these to HTTP status codes.
 * `store_unavailable` (the shared cache or throttle could not be trusted) and
 * `upstream_failed` (the provider call failed) are kept distinct so the wrapper
 * can answer 503 and 502 respectively, as before the extraction.
 */
export type LookupState = "ok" | "busy" | "store_unavailable" | "upstream_failed" | "private_home_refused";

export interface LookupResult {
  state: LookupState;
  matches?: PlaceMatch[];
}

const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_SLOT_WAIT_MS = 3000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * config → private-home guard → cache read → shared throttle → one upstream fetch →
 * normalize → cache write. The caller provides an enabled config and a store built
 * from a service-role client.
 */
export async function runGeocodeLookup(args: {
  query: string;
  privateHome: boolean;
  config: Extract<GeocoderConfig, { enabled: true }>;
  store: GeocoderStore;
}): Promise<LookupResult> {
  const { query, privateHome, config, store } = args;

  // Private-home guard. A private residence is never handed to public Nominatim.
  // The decision is from config alone, so a bypassed client cannot leak it.
  if (privateHome && config.publicNominatim) {
    return { state: "private_home_refused" };
  }

  const key = cacheKey(query, config.host, config.cacheSecret);

  // Cache read. An error means the shared cache cannot be trusted.
  try {
    const cached = await store.cacheGet(key);
    if (cached) return { state: "ok", matches: cached };
  } catch {
    return { state: "store_unavailable" };
  }

  // Shared throttle.
  let wait: number | null;
  try {
    wait = await store.takeSlot(MAX_SLOT_WAIT_MS);
  } catch {
    return { state: "store_unavailable" };
  }
  if (wait === null) return { state: "busy" };
  if (wait > 0) await sleep(Math.min(wait, MAX_SLOT_WAIT_MS));

  // Upstream: one fetch, fixed headers, no cookies.
  let rows: unknown;
  try {
    const headers: Record<string, string> = {
      "User-Agent": config.userAgent,
      "Accept-Language": "en",
    };
    if (config.referer) headers["Referer"] = config.referer;
    const res = await fetch(buildGeocodeUrl(config.endpoint, query, config.apiKey ?? undefined), {
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status !== 200) return { state: "upstream_failed" };
    rows = await res.json();
  } catch {
    return { state: "upstream_failed" };
  }

  // Normalize and store. A failed write does not change the answer.
  const matches = normalizeNominatim(rows);
  const put = await store.cachePut(key, matches).catch(() => ({ ok: false, code: "exception" as string | undefined }));
  if (!put.ok) console.info(`[geocode] cache_write_failed ${put.code ?? "unknown"}`);

  return { state: "ok", matches };
}
