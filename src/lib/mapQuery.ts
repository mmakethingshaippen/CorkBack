import "server-only";
import { createClient } from "./supabase/server";
import { isPostingActive } from "./lifecycle";
import {
  MAP_CAPS,
  selectForBounds,
  snapBoundsOutward,
  type Bounds,
  type MapPin,
  type MapQueryResult,
} from "./mapBounds";
import { POSTING_COLUMNS, rowToPosting, supabaseConfigured, toReadableError, withCounts } from "./postings";
import { SEED_POSTINGS } from "./seed";
import type { Posting } from "./types";

export type MapMode = "pins" | "cards";

/** Rows read per round trip. Ended events are dropped after the read, so we may page. */
const MAX_PAGES = 4;

function toPin(p: Posting): MapPin {
  return { id: p.id, title: p.title, lat: p.lat, lng: p.lng, categorySlug: p.categorySlug };
}

/**
 * Capped, bounds-limited read of active postings for the maps.
 *
 * - The box is snapped outward here too, so a client box is only ever
 *   expanded, never shrunk. The lat/lng filter is inclusive (gte/lte).
 * - Order: promoted first, newest, then id descending (a total order, so
 *   paging is stable).
 * - The SQL cannot express the event-end rule (PostgREST cannot filter on
 *   posting_takedown_at). Rows are read in pages of cap + 1, ended events are
 *   dropped with isPostingActive, and paging continues until cap + 1 ACTIVE
 *   rows are found or the table runs out. So ended events never cause a short
 *   page while more active rows exist. If the page limit is reached while more
 *   rows remain, `truncated` is reported as true (conservative, never silent).
 * - Counts are attached only for the returned rows, and only in cards mode.
 *   Viewer likes are NOT attached here (the route does that for cards), so the
 *   result is viewer-independent.
 */
export async function queryPostingsInBounds(
  q: { bounds: Bounds; category: string | null; mode: MapMode },
  now: Date = new Date(),
): Promise<MapQueryResult<MapPin | Posting>> {
  const cap = MAP_CAPS[q.mode];
  const bounds = snapBoundsOutward(q.bounds);

  if (!supabaseConfigured()) {
    const active = SEED_POSTINGS.filter((p) => isPostingActive(p, now));
    const r = selectForBounds(active, { bounds, category: q.category, cap });
    return { ...r, items: q.mode === "pins" ? r.items.map(toPin) : r.items };
  }

  const supabase = await createClient();
  const columns = q.category ? POSTING_COLUMNS.replace("categories(slug)", "categories!inner(slug)") : POSTING_COLUMNS;
  const pageSize = cap + 1;
  const active: Posting[] = [];
  let moreRows = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    let query = supabase
      .from("postings")
      .select(columns)
      .is("deleted_at", null)
      .is("moderation_hidden_at", null)
      .gt("expires_at", now.toISOString())
      .gte("lat", bounds.south)
      .lte("lat", bounds.north)
      .gte("lng", bounds.west)
      .lte("lng", bounds.east);
    if (q.category) query = query.eq("categories.slug", q.category);
    const { data, error } = await query
      .order("is_promoted", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw toReadableError("queryPostingsInBounds", error);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const r of rows) {
      const p = rowToPosting(r);
      if (isPostingActive(p, now)) active.push(p);
    }
    const full = rows.length === pageSize;
    if (active.length > cap || !full) {
      moreRows = false;
      break;
    }
    moreRows = true; // a full page was read and we still need more active rows
  }

  const truncated = active.length > cap || moreRows;
  const kept = active.slice(0, cap);
  if (q.mode === "pins") return { items: kept.map(toPin), truncated, cap };
  return { items: await withCounts(supabase, kept), truncated, cap };
}
