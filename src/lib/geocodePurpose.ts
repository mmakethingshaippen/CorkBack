/**
 * Purpose resolution and the anonymous client-id helper for the shared geocoder
 * route. `anonymousClientId` reuses `cacheKey` (HMAC-SHA256 via `node:crypto`),
 * so this module is server and test only — the browser never imports it.
 *
 * The raw client IP is used only to compute the Anonymous_Client_Id. It is never
 * returned, stored or logged by anything here: `anonymousClientId` returns the
 * HMAC, and the IP stays a local variable.
 */
import { cacheKey } from "./geocodeQuery";

export type GeocodePurpose = "place" | "posting";

/** The fixed fallback used when no forwarded client IP can be read, so a request
 *  with no IP shares one anonymous bucket and never bypasses the limit. */
export const NO_IP_FALLBACK = "no-forwarded-ip";

/** The host label the anonymous id HMAC is namespaced under (distinct from any
 *  real provider host used by the cache key). */
export const ANON_ID_LABEL = "anon";

/**
 * Resolve the `purpose` query parameter. Only the exact value `place` resolves to
 * `"place"`; any other value, including `null` or an absent parameter, resolves to
 * `"posting"` (Requirement 21.1).
 */
export function resolvePurpose(raw: string | null): GeocodePurpose {
  return raw === "place" ? "place" : "posting";
}

/**
 * A minimal header reader. A Web `Request`'s `Headers`, a plain record, or any
 * object with a `get` method all satisfy this. Lookup is case-insensitive for the
 * record form; `Headers.get` is already case-insensitive.
 */
export interface HeaderLookup {
  get(name: string): string | null;
}

function toLookup(headers: HeaderLookup | Record<string, string | undefined>): HeaderLookup {
  if (typeof (headers as HeaderLookup).get === "function") {
    return headers as HeaderLookup;
  }
  const record = headers as Record<string, string | undefined>;
  const lower: Record<string, string | undefined> = {};
  for (const key of Object.keys(record)) lower[key.toLowerCase()] = record[key];
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

/**
 * Read the client IP from a trusted forwarded header: the first entry of
 * `x-forwarded-for`, else `x-real-ip`, else the fixed fallback (Requirement
 * 21.11). The returned value is used only to compute the anonymous id; callers
 * must never store or log it.
 */
export function readClientIp(headers: HeaderLookup | Record<string, string | undefined>): string {
  const lookup = toLookup(headers);

  const forwarded = lookup.get("x-forwarded-for");
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = lookup.get("x-real-ip");
  if (typeof realIp === "string") {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }

  return NO_IP_FALLBACK;
}

/**
 * Derive the Anonymous_Client_Id from an IP string: the hex HMAC-SHA256 under the
 * fixed `"anon"` host label with the cache secret (Requirement 21.8). Never
 * contains the IP. Equal for the same IP and secret; differs for a different IP
 * or secret.
 */
export function anonymousClientIdFromIp(ip: string, secret: string): string {
  return cacheKey(ip, ANON_ID_LABEL, secret);
}

/**
 * Read the client IP from the request headers and return its Anonymous_Client_Id.
 * The IP is a local variable only: it is never returned, stored or logged
 * (Requirements 21.8, 21.11).
 */
export function anonymousClientId(
  headers: HeaderLookup | Record<string, string | undefined>,
  secret: string,
): string {
  return anonymousClientIdFromIp(readClientIp(headers), secret);
}
