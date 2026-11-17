/**
 * Pure helpers behind the location picker's handlers. No React, no map, no
 * board modules. A lookup starts only from the "Find on map" and search-submit
 * handlers, never while typing.
 */
import type { PlaceMatch } from "@/lib/geocode";
import { prepareGeocodeQuery } from "@/lib/geocodeQueryPrepare";
import { publishableLocation, type LocationDraft, type LocationEvent, type LocationPayload } from "@/lib/postingLocation";

export type SearchFailKind = "unavailable" | "busy" | "refused";

export const MESSAGES = {
  refused:
    "That search includes a phone number or email address, so it was not sent. Search with just the street address or the place name.",
  busy: "Place search is busy. Try again in a moment.",
  unavailable: "Place search is unavailable right now. You can still place the pin on the map.",
  userLimit: "Too many searches. Try again in a few minutes.",
  signedOut: "Sign in to search for a place.",
  tooShort: "Type at least 3 characters to search.",
  sendNote: "Searching sends only this address text to a public map search service.",
  saveFailed: "Your other changes were saved, but the location was not.",
} as const;

export interface SearchFailure {
  kind: SearchFailKind;
  message: string;
}

export type LookupPlan =
  | { ok: true; url: string; query: string }
  | { ok: false; reason: "too_short" | "contains_contact"; failure: SearchFailure | null; message: string };

/** Build the lookup request from typed or candidate text. Sends only `q`. */
export function buildLookup(raw: string): LookupPlan {
  const prepared = prepareGeocodeQuery(raw);
  if (prepared.ok) {
    return { ok: true, query: prepared.query, url: `/api/geocode?q=${encodeURIComponent(prepared.query)}` };
  }
  if (prepared.reason === "contains_contact") {
    return { ok: false, reason: prepared.reason, failure: { kind: "refused", message: MESSAGES.refused }, message: MESSAGES.refused };
  }
  return { ok: false, reason: prepared.reason, failure: null, message: MESSAGES.tooShort };
}

/** A new lookup may start only when none is in flight. */
export function canStartLookup(inFlight: boolean): boolean {
  return !inFlight;
}

/** Map a route state (or a failed request) to a `search_failed` kind and its message. `ok` returns null. */
export function failureForState(state: string | null | undefined): SearchFailure | null {
  switch (state) {
    case "ok":
      return null;
    case "busy":
      return { kind: "busy", message: MESSAGES.busy };
    case "user_limit":
      return { kind: "busy", message: MESSAGES.userLimit };
    case "query_refused":
      return { kind: "refused", message: MESSAGES.refused };
    case "signed_out":
      return { kind: "unavailable", message: MESSAGES.signedOut };
    default:
      return { kind: "unavailable", message: MESSAGES.unavailable };
  }
}

export function searchFailedEvent(failure: SearchFailure): LocationEvent {
  return { type: "search_failed", kind: failure.kind };
}

export type LookupOutcome =
  | { status: "skipped" }
  | { status: "invalid"; message: string; failure: SearchFailure | null }
  | { status: "failed"; failure: SearchFailure }
  | { status: "ok"; matches: PlaceMatch[] };

/**
 * Run one lookup. Skips when one is in flight, refuses a bad query without a
 * `fetch`, and turns every failure into a `SearchFailure`. Never throws.
 */
export async function runLookup(
  raw: string,
  inFlight: boolean,
  fetchImpl: (url: string) => Promise<{ json(): Promise<unknown> }>,
): Promise<LookupOutcome> {
  if (!canStartLookup(inFlight)) return { status: "skipped" };
  const plan = buildLookup(raw);
  if (!plan.ok) return { status: "invalid", message: plan.message, failure: plan.failure };
  try {
    const res = await fetchImpl(plan.url);
    const body = (await res.json()) as { state?: string; matches?: unknown };
    const failure = failureForState(body?.state);
    if (failure) return { status: "failed", failure };
    return { status: "ok", matches: Array.isArray(body.matches) ? (body.matches as PlaceMatch[]) : [] };
  } catch {
    return { status: "failed", failure: failureForState(undefined)! };
  }
}

/** The Retry request body: only the `location` block built from the kept draft, or null when nothing is confirmed. */
export function buildRetryBody(draft: LocationDraft): { location: LocationPayload } | null {
  const location = publishableLocation(draft);
  return location ? { location } : null;
}
