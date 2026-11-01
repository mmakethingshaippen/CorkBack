import "server-only";
import { createClient } from "./supabase/server";
import { isActive } from "./domain";
import type { Posting } from "./types";
import { SEED_POSTINGS, findSeedPosting } from "./seed";
import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Convert a raw Supabase/Postgrest error into a readable Error, logging the
 * real code/message/details/hint to the server terminal first. Throwing a plain
 * object (as Supabase returns) gives an unreadable "Unhandled Runtime Error" in
 * the browser; a real Error with a clear message renders properly.
 */
function toReadableError(context: string, error: PostgrestError): Error {
  // Structured server-side log so the real cause is visible in the terminal.
  console.error(`[CorkBack] Supabase error during ${context}:`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });

  // A missing table/relationship almost always means the schema hasn't been
  // applied. Give that case an actionable message.
  if (error.code === "42P01" || error.code === "PGRST200" || error.code === "PGRST205") {
    return new Error(
      `Database not initialized (${error.code}): ${error.message}. ` +
        `Apply supabase/schema.sql in your Supabase project (see SETUP.md).`,
    );
  }
  return new Error(`Failed to load postings (${error.code ?? "unknown"}): ${error.message}`);
}

/**
 * Posting data access. When Supabase is configured it reads live rows (RLS:
 * public can read non-deleted postings). Without credentials it falls back to
 * seed data so the app is verifiable live during the build.
 */

function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function rowToPosting(r: Record<string, unknown>): Posting {
  const profiles = r.profiles as { username?: string } | null;
  const categories = r.categories as { slug?: string } | null;
  const likes = (r.likes as { count?: number }[] | null) ?? [];
  return {
    id: String(r.id),
    title: String(r.title),
    body: String(r.body ?? ""),
    categorySlug: categories?.slug ?? "community",
    flyerUrl: (r.flyer_url as string) ?? null,
    rsvpUrl: (r.rsvp_url as string) ?? null,
    eventDate: (r.event_date as string) ?? null,
    eventTime: (r.event_time as string) ?? null,
    placeLabel: String(r.place_label ?? ""),
    lat: Number(r.lat),
    lng: Number(r.lng),
    expiry: r.expiry as Posting["expiry"],
    expiresAt: String(r.expires_at),
    isPromoted: Boolean(r.is_promoted),
    authorUsername: profiles?.username ?? "unknown",
    likeCount: likes[0]?.count ?? 0,
    createdAt: String(r.created_at),
  };
}

/** Active (non-expired, non-deleted, event-not-past) postings for the map. */
export async function listActivePostings(now = new Date()): Promise<Posting[]> {
  if (!supabaseConfigured()) {
    return SEED_POSTINGS.filter((p) =>
      isActive(now, new Date(p.expiresAt), p.eventDate ? new Date(p.eventDate) : null, null),
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("postings")
    .select(
      // Disambiguate the embeds by naming the foreign keys: postings reaches
      // profiles through several relationships (author_id, likes, plans,
      // hidden_postings), so PostgREST needs the exact FK (PGRST201).
      "id, title, body, flyer_url, rsvp_url, event_date, event_time, place_label, lat, lng, expiry, expires_at, is_promoted, created_at, profiles!postings_author_id_fkey(username), categories(slug), likes!likes_posting_id_fkey(count)",
    )
    .is("deleted_at", null)
    .gt("expires_at", now.toISOString());
  if (error) throw toReadableError("listActivePostings", error);
  return (data ?? [])
    .map((r) => rowToPosting(r as Record<string, unknown>))
    .filter((p) =>
      isActive(now, new Date(p.expiresAt), p.eventDate ? new Date(p.eventDate) : null, null),
    );
}

export async function getPosting(id: string, now = new Date()): Promise<Posting | null> {
  if (!supabaseConfigured()) {
    const p = findSeedPosting(id);
    return p ?? null;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("postings")
    .select(
      // Same FK disambiguation as listActivePostings (PGRST201).
      "id, title, body, flyer_url, rsvp_url, event_date, event_time, place_label, lat, lng, expiry, expires_at, is_promoted, created_at, deleted_at, profiles!postings_author_id_fkey(username), categories(slug), likes!likes_posting_id_fkey(count)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw toReadableError("getPosting", error);
  if (!data) return null;
  return rowToPosting(data as Record<string, unknown>);
}
