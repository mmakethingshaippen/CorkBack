import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveGeocoderConfig } from "@/lib/geocoderConfig";
import { prepareGeocodeQuery } from "@/lib/geocodeQuery";
import { createGeocoderStore, type GeocoderStore } from "@/lib/geocoderStore";
import { createUserCap } from "@/lib/geocodeUserCap";
import { runGeocodeLookup } from "@/lib/geocodeLookup";
import { resolvePurpose, anonymousClientId, type GeocodePurpose } from "@/lib/geocodePurpose";
import { type PlaceMatch } from "@/lib/geocode";

/**
 * GET /api/geocode?q=...&purpose=place|posting[&home=1]
 *
 * One service for every lookup. `purpose=posting` is the signed-in picker path
 * (401 when signed out, bounded by the per-user cap). `purpose=place` is the
 * public place search for the board and alerts; it serves signed-out viewers and
 * is bounded by the shared anonymous limit (a Supabase-backed count per hashed
 * client IP, additive to the 1 req/s shared throttle).
 *
 * The wrapper owns auth, config, query prep, the private-home guard and the rate
 * limits; the shared lookup core (geocodeLookup.ts) owns the cache read, the
 * shared throttle, the one upstream fetch, normalization and the cache write.
 *
 * Logs only `[geocode] <state> <status> <purpose>` — never the raw client IP, the
 * anonymous id, the query, the cache key or the response body.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per server instance, best effort, for the signed-in posting path. The shared
// throttle enforces the application-wide upstream limit; the anonymous limit
// bounds signed-out place search across instances.
const userCap = createUserCap({ max: 20, windowMs: 10 * 60 * 1000, now: () => Date.now() });

type State =
  | "ok"
  | "unavailable"
  | "busy"
  | "user_limit"
  | "rate_limited"
  | "query_refused"
  | "bad_query"
  | "signed_out"
  | "private_home_refused";

function respond(
  state: State,
  status: number,
  purpose: GeocodePurpose,
  extra: { error?: string; matches?: PlaceMatch[] } = {},
  headers?: Record<string, string>,
) {
  // Log only the state, the status and the purpose.
  console.info(`[geocode] ${state} ${status} ${purpose}`);
  return NextResponse.json({ state, ...extra }, { status, headers });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const purpose = resolvePurpose(url.searchParams.get("purpose"));
  const unavailable = (status = 503) =>
    respond("unavailable", status, purpose, { error: "Place search is unavailable right now." });

  // 1. Supabase present. Without it (demo mode) the geocoder cannot be configured.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return unavailable();

  // 2. Auth by purpose. `posting` requires a signed-in user; `place` serves a
  //    signed-out viewer. The user id only feeds the per-user cap on `posting`.
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }
  if (purpose === "posting" && !userId) {
    return respond("signed_out", 401, purpose, { error: "Sign in to search for a place." });
  }

  // 3. Config. Disabled means no store call and no upstream call.
  const config = resolveGeocoderConfig(process.env);
  if (!config.enabled) return unavailable();

  // 4. Query.
  const prepared = prepareGeocodeQuery(url.searchParams.get("q") ?? "");
  if (!prepared.ok) {
    if (prepared.reason === "contains_contact") {
      return respond("query_refused", 422, purpose, {
        error:
          "That search includes a phone number or email address, so it was not sent. Search with just the street address or the place name.",
      });
    }
    return respond("bad_query", 400, purpose, { error: "Type at least 3 characters to search." });
  }
  const query = prepared.query;

  // 5. Private-home guard. Decided from config alone, so a crafted `home=1` request
  //    can never reach public Nominatim. No store call and no upstream call.
  const privateHome = url.searchParams.get("home") === "1";
  if (privateHome && config.publicNominatim) {
    return respond("private_home_refused", 422, purpose, {
      error: "A private home address is not sent to a public map search service.",
    });
  }

  // 6. Per-user cap for the signed-in posting path, before any store or upstream call.
  if (purpose === "posting" && !userCap.take(userId as string)) {
    return respond("user_limit", 429, purpose, { error: "Too many searches. Try again in a few minutes." });
  }

  let store: GeocoderStore;
  try {
    store = createGeocoderStore(createAdminClient());
  } catch {
    return unavailable();
  }

  // 7. Shared anonymous limit for the public place path, keyed by the HMAC of the
  //    forwarded client IP. The raw IP is never stored or logged; only the anonymous
  //    id reaches the store. Runs before any upstream call.
  if (purpose === "place") {
    const anonId = anonymousClientId(req.headers, config.cacheSecret);
    let within: boolean;
    try {
      within = await store.takeAnonSlot(anonId);
    } catch {
      // Fail closed: a missing or erroring anonymous-limit store never becomes
      // unlimited anonymous traffic. No upstream call.
      return unavailable();
    }
    if (!within) {
      return respond("rate_limited", 429, purpose, {
        error: "Too many searches from this network. Try again in a few minutes.",
      });
    }
  }

  // 8. Shared lookup core: cache read, shared throttle, one fetch, normalize, cache
  //    write. The private-home guard already ran above, so privateHome is false here
  //    whenever we reach the core on public Nominatim.
  const result = await runGeocodeLookup({ query, privateHome, config, store });
  switch (result.state) {
    case "ok":
      return respond("ok", 200, purpose, { matches: result.matches });
    case "busy":
      return respond("busy", 429, purpose, { error: "Place search is busy. Try again in a moment." }, { "Retry-After": "2" });
    case "upstream_failed":
      return unavailable(502);
    case "private_home_refused":
      // The wrapper already refused a public-Nominatim private-home lookup above;
      // a keyed non-public provider never produces this state. Kept exhaustive.
      return respond("private_home_refused", 422, purpose, {
        error: "A private home address is not sent to a public map search service.",
      });
    case "store_unavailable":
    default:
      return unavailable();
  }
}
