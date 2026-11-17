/**
 * Browser-safe part of the geocoder query handling. No node imports, so the
 * location picker can use it. `geocodeQuery.ts` re-exports it.
 */
import { findContactDetails } from "./contactDetails";

export const MAX_QUERY_CHARS = 200;
export const MIN_QUERY_CHARS = 3;

export type PreparedQuery =
  | { ok: true; query: string }
  | { ok: false; reason: "too_short" | "contains_contact" };

/**
 * The one function that produces the text that leaves the app: trim, collapse
 * whitespace runs to one space, cut to 200 characters. Refuses text that is too
 * short or that contains a phone number or email address. Never throws.
 */
export function prepareGeocodeQuery(raw: string): PreparedQuery {
  const text = typeof raw === "string" ? raw : "";
  const query = text.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_CHARS);
  if (query.length < MIN_QUERY_CHARS) return { ok: false, reason: "too_short" };
  if (findContactDetails(query).length > 0) return { ok: false, reason: "contains_contact" };
  return { ok: true, query };
}
