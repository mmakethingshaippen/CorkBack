import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { resolveGeocoderConfig } from "@/lib/geocoderConfig";
import { prepareGeocodeQuery, buildGeocodeUrl, cacheKey } from "@/lib/geocodeQuery";
import { createGeocoderStore, type GeocoderStore } from "@/lib/geocoderStore";
import { createUserCap } from "@/lib/geocodeUserCap";
import { normalizeNominatim, type PlaceMatch } from "@/lib/geocode";

/**
 * GET /api/geocode?q=...  Signed-in place search in front of the geocoder.
 * Order: auth, config, query, user cap, cache read, shared throttle, one upstream
 * fetch, normalize, cache write. Nothing here logs the query, results, key or secrets.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_SLOT_WAIT_MS = 3000;

// Per server instance, best effort. The shared throttle enforces the policy limit.
const userCap = createUserCap({ max: 20, windowMs: 10 * 60 * 1000, now: () => Date.now() });

type State = "ok" | "unavailable" | "busy" | "user_limit" | "query_refused" | "bad_query" | "signed_out";

function respond(
  state: State,
  status: number,
  extra: { error?: string; matches?: PlaceMatch[] } = {},
  headers?: Record<string, string>,
) {
  // Log only the state and status.
  console.info(`[geocode] ${state} ${status}`);
  return NextResponse.json({ state, ...extra }, { status, headers });
}

function unavailable(status = 503) {
  return respond("unavailable", status, { error: "Place search is unavailable right now." });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function GET(req: Request) {
  // 1. Auth. Without Supabase (demo mode) the geocoder cannot be configured either.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return unavailable();
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return respond("signed_out", 401, { error: "Sign in to search for a place." });

  // 2. Config. Disabled means no store call and no upstream call.
  const config = resolveGeocoderConfig(process.env);
  if (!config.enabled) return unavailable();

  // 3. Query.
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const prepared = prepareGeocodeQuery(q);
  if (!prepared.ok) {
    if (prepared.reason === "contains_contact") {
      return respond("query_refused", 422, {
        error:
          "That search includes a phone number or email address, so it was not sent. Search with just the street address or the place name.",
      });
    }
    return respond("bad_query", 400, { error: "Type at least 3 characters to search." });
  }
  const query = prepared.query;

  // 4. Per-user cap.
  if (!userCap.take(userId)) {
    return respond("user_limit", 429, { error: "Too many searches. Try again in a few minutes." });
  }

  let store: GeocoderStore;
  try {
    store = createGeocoderStore(createAdminClient());
  } catch {
    return unavailable();
  }

  // 5. Cache read. An error means the shared cache cannot be trusted.
  const key = cacheKey(query, config.host, config.cacheSecret);
  try {
    const cached = await store.cacheGet(key);
    if (cached) return respond("ok", 200, { matches: cached });
  } catch {
    return unavailable();
  }

  // 6. Shared throttle.
  let wait: number | null;
  try {
    wait = await store.takeSlot(MAX_SLOT_WAIT_MS);
  } catch {
    return unavailable();
  }
  if (wait === null) {
    return respond("busy", 429, { error: "Place search is busy. Try again in a moment." }, { "Retry-After": "2" });
  }
  if (wait > 0) await sleep(Math.min(wait, MAX_SLOT_WAIT_MS));

  // 7. Upstream: one fetch, fixed headers, no cookies.
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
    if (res.status !== 200) return unavailable(502);
    rows = await res.json();
  } catch {
    return unavailable(502);
  }

  // 8. Normalize and store. A failed write does not change the answer.
  const matches = normalizeNominatim(rows);
  const put = await store.cachePut(key, matches).catch(() => ({ ok: false, code: "exception" as string | undefined }));
  if (!put.ok) console.info(`[geocode] cache_write_failed ${put.code ?? "unknown"}`);

  // 9.
  return respond("ok", 200, { matches });
}
