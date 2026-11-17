/**
 * Geocoder query helpers for the server route and tests. Uses `node:crypto`,
 * so client code imports `prepareGeocodeQuery` from `geocodeQueryPrepare.ts`.
 */
import { createHmac } from "node:crypto";

export {
  MAX_QUERY_CHARS,
  MIN_QUERY_CHARS,
  prepareGeocodeQuery,
  type PreparedQuery,
} from "./geocodeQueryPrepare";

/** The upstream URL. The only free text is `q`; other parameters are fixed, plus the optional provider key. */
export function buildGeocodeUrl(
  base: string,
  query: string,
  key?: { param: string; value: string },
): string {
  const url = new URL(base);
  url.search = "";
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  url.searchParams.set("dedupe", "1");
  if (key && key.param && key.param !== "q") url.searchParams.set(key.param, key.value);
  return url.toString();
}

/** Normalization used for the cache key only: NFC, lowercase, whitespace collapsed. */
export function normalizeForCache(query: string): string {
  return query.normalize("NFC").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Hex HMAC-SHA256 over `${providerHost}\n${normalizeForCache(query)}` with the server secret. Never contains the query. */
export function cacheKey(query: string, providerHost: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${providerHost}\n${normalizeForCache(query)}`, "utf8")
    .digest("hex");
}
