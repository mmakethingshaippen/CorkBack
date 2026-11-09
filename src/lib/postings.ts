import "server-only";
import { createClient } from "./supabase/server";
import { isPostingActive } from "./lifecycle";
import { orderWithPromoted } from "./promotion";
import { getReactionCounts } from "./reactions";
import type { Posting } from "./types";
import { SEED_POSTINGS, findSeedPosting } from "./seed";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

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
  if (error.code === "42703") {
    return new Error(
      `Database is missing a column (${error.code}): ${error.message}. ` +
        `Apply supabase/stage6_social_part1.sql in your Supabase project.`,
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

// Disambiguate the embeds by naming the foreign keys: postings reaches profiles
// through several relationships (author_id, likes, plans, hidden_postings), so
// PostgREST needs the exact FK (PGRST201). Counts are NOT embedded: likes rows
// are private, so counts come from posting_reaction_counts.
const POSTING_COLUMNS =
  "id, title, body, flyer_url, rsvp_url, event_date, event_time, end_date, end_time, time_zone, place_label, lat, lng, expiry, expires_at, is_promoted, created_at, profiles!postings_author_id_fkey(username), categories(slug)";

function rowToPosting(r: Record<string, unknown>): Posting {
  const profiles = r.profiles as { username?: string } | null;
  const categories = r.categories as { slug?: string } | null;
  return {
    id: String(r.id),
    title: String(r.title),
    body: String(r.body ?? ""),
    categorySlug: categories?.slug ?? "community",
    flyerUrl: (r.flyer_url as string) ?? null,
    rsvpUrl: (r.rsvp_url as string) ?? null,
    eventDate: (r.event_date as string) ?? null,
    eventTime: (r.event_time as string) ?? null,
    endDate: (r.end_date as string) ?? null,
    endTime: (r.end_time as string) ?? null,
    timeZone: (r.time_zone as string) ?? null,
    placeLabel: String(r.place_label ?? ""),
    lat: Number(r.lat),
    lng: Number(r.lng),
    expiry: r.expiry as Posting["expiry"],
    expiresAt: String(r.expires_at),
    isPromoted: Boolean(r.is_promoted),
    authorUsername: profiles?.username ?? "unknown",
    likeCount: 0,
    goingCount: 0,
    interestedCount: 0,
    createdAt: String(r.created_at),
  };
}

async function withCounts(supabase: SupabaseClient, postings: Posting[]): Promise<Posting[]> {
  const counts = await getReactionCounts(supabase, postings.map((p) => p.id));
  return postings.map((p) => {
    const c = counts.get(p.id);
    return c ? { ...p, likeCount: c.likes, goingCount: c.going, interestedCount: c.interested } : p;
  });
}

/** Active (not expired, not deleted, event not over) postings for the map. */
export async function listActivePostings(now = new Date()): Promise<Posting[]> {
  if (!supabaseConfigured()) {
    return orderWithPromoted(SEED_POSTINGS.filter((p) => isPostingActive(p, now)));
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("postings")
    .select(POSTING_COLUMNS)
    .is("deleted_at", null)
    .gt("expires_at", now.toISOString());
  if (error) throw toReadableError("listActivePostings", error);
  const active = (data ?? [])
    .map((r) => rowToPosting(r as Record<string, unknown>))
    .filter((p) => isPostingActive(p, now));
  return orderWithPromoted(await withCounts(supabase, active));
}

/**
 * A single posting by id, INCLUDING ended postings (the posting page renders
 * them read-only). Deleted postings are not returned. Use `isPostingActive` to
 * decide whether reactions are allowed.
 */
export async function getPosting(id: string): Promise<Posting | null> {
  if (!supabaseConfigured()) {
    return findSeedPosting(id) ?? null;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("postings")
    .select(POSTING_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    // A malformed id is "not found", not a server error.
    if (error.code === "22P02") return null;
    throw toReadableError("getPosting", error);
  }
  if (!data) return null;
  const [posting] = await withCounts(supabase, [rowToPosting(data as Record<string, unknown>)]);
  return posting;
}

/**
 * Look up a public profile by username. Returns null when no profile row exists
 * (so callers can render a not-found state instead of a generic page).
 */
export async function getProfileByUsername(
  username: string,
): Promise<{ id: string; username: string } | null> {
  if (!supabaseConfigured()) {
    // Seed mode: treat the seed posting authors as the only known profiles.
    const known = SEED_POSTINGS.some((p) => p.authorUsername === username);
    return known ? { id: `seed-${username}`, username } : null;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("username", username)
    .maybeSingle();
  if (error) throw toReadableError("getProfileByUsername", error);
  return data ? { id: String(data.id), username: String(data.username) } : null;
}

/** Active postings authored by a given username, promoted-first within groups. */
export async function listPostingsByUsername(
  username: string,
  now = new Date(),
): Promise<Posting[]> {
  if (!supabaseConfigured()) {
    return orderWithPromoted(
      SEED_POSTINGS.filter((p) => p.authorUsername === username && isPostingActive(p, now)),
    );
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("postings")
    .select(POSTING_COLUMNS)
    .eq("profiles.username", username)
    .is("deleted_at", null)
    .gt("expires_at", now.toISOString());
  if (error) throw toReadableError("listPostingsByUsername", error);
  const active = (data ?? [])
    .map((r) => rowToPosting(r as Record<string, unknown>))
    .filter((p) => p.authorUsername === username && isPostingActive(p, now));
  return orderWithPromoted(await withCounts(supabase, active));
}
