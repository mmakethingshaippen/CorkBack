import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanKind, ReactionCounts } from "./types";

/**
 * Server reads for likes and plans. All reads use the caller's session, so RLS
 * decides what is visible:
 *   - likes rows: only the viewer's own.
 *   - plans rows: the viewer's own, plus accepted friends' on active postings.
 *   - counts: public aggregates via posting_reaction_counts (numbers only).
 */

export const ZERO_COUNTS: ReactionCounts = { likes: 0, going: 0, interested: 0 };

export async function getReactionCounts(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, ReactionCounts>> {
  const out = new Map<string, ReactionCounts>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.rpc("posting_reaction_counts", { p_ids: ids });
  if (error) {
    // Most likely the Stage 6 part 1 migration has not been applied yet. Counts
    // degrade to zero rather than breaking the page.
    console.error("[CorkBack] posting_reaction_counts failed:", { code: error.code, message: error.message });
    return out;
  }
  for (const r of (data ?? []) as {
    posting_id: string;
    like_count: number;
    going_count: number;
    interested_count: number;
  }[]) {
    out.set(String(r.posting_id), {
      likes: Number(r.like_count) || 0,
      going: Number(r.going_count) || 0,
      interested: Number(r.interested_count) || 0,
    });
  }
  return out;
}

/**
 * Which of these postings the viewer has liked. RLS returns only the viewer's
 * own likes rows, so this can never reveal anyone else's. On error, returns an
 * empty set: cards then show "not liked" and the like route corrects it.
 */
export async function getViewerLikedIds(
  supabase: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("likes")
    .select("posting_id")
    .eq("user_id", userId)
    .in("posting_id", ids.slice(0, 500));
  if (error) {
    console.error("[CorkBack] viewer likes failed:", { code: error.code, message: error.message });
    return out;
  }
  for (const r of data ?? []) out.add(String((r as { posting_id: string }).posting_id));
  return out;
}

/**
 * The viewer's own plan (going/interested) for these postings. RLS lets the
 * viewer read their own plan rows; the user_id filter keeps friends' rows out.
 * On error, returns an empty map: cards then show "no plan" and the plan route corrects it.
 */
export async function getViewerPlans(
  supabase: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<Map<string, PlanKind>> {
  const out = new Map<string, PlanKind>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from("plans")
    .select("posting_id, kind")
    .eq("user_id", userId)
    .in("posting_id", ids.slice(0, 500));
  if (error) {
    console.error("[CorkBack] viewer plans failed:", { code: error.code, message: error.message });
    return out;
  }
  for (const r of (data ?? []) as { posting_id: string; kind: PlanKind }[]) {
    out.set(String(r.posting_id), r.kind);
  }
  return out;
}

export async function getViewerReaction(
  supabase: SupabaseClient,
  postingId: string,
  userId: string,
): Promise<{ liked: boolean; plan: PlanKind | null }> {
  const [like, plan] = await Promise.all([
    supabase.from("likes").select("posting_id").eq("posting_id", postingId).eq("user_id", userId).maybeSingle(),
    supabase.from("plans").select("kind").eq("posting_id", postingId).eq("user_id", userId).maybeSingle(),
  ]);
  if (like.error) throw new Error(`Could not load your like (${like.error.code ?? "unknown"}).`);
  if (plan.error) throw new Error(`Could not load your plan (${plan.error.code ?? "unknown"}).`);
  return {
    liked: Boolean(like.data),
    plan: (plan.data?.kind as PlanKind | undefined) ?? null,
  };
}

/**
 * Accepted friends' plans on this posting. Selects only username + kind: never
 * ids, emails, or any location. Visibility is decided by RLS: after part 1,
 * plans are owner-only, so this returns []. Part 3 adds the friends read policy
 * (with the connections fixes) and this starts returning friends' rows.
 */
export async function getFriendPlans(
  supabase: SupabaseClient,
  postingId: string,
  viewerId: string,
): Promise<{ username: string; avatarPath: string | null; kind: PlanKind }[]> {
  const { data, error } = await supabase
    .from("plans")
    .select("kind, profiles!plans_user_id_fkey(username, avatar_path)")
    .eq("posting_id", postingId)
    .neq("user_id", viewerId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    console.error("[CorkBack] friend plans failed:", { code: error.code, message: error.message });
    return [];
  }
  return (data ?? [])
    .map((r) => {
      const prof = (r as { profiles?: { username?: string; avatar_path?: string | null } | null }).profiles;
      return { username: prof?.username ?? "", avatarPath: prof?.avatar_path ?? null, kind: (r as { kind: PlanKind }).kind };
    })
    .filter((r) => r.username);
}

/** Lifecycle fields for one posting, or null if missing/deleted. */
export async function loadPostingLifecycle(supabase: SupabaseClient, postingId: string) {
  const { data, error } = await supabase
    .from("postings")
    .select("id, expires_at, event_date, end_date, end_time, time_zone, lat, lng, deleted_at")
    .eq("id", postingId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`Could not load the posting (${error.code ?? "unknown"}).`);
  if (!data) return null;
  return {
    expiresAt: String(data.expires_at),
    eventDate: (data.event_date as string) ?? null,
    endDate: (data.end_date as string) ?? null,
    endTime: (data.end_time as string) ?? null,
    timeZone: (data.time_zone as string) ?? null,
    lat: Number(data.lat),
    lng: Number(data.lng),
    deletedAt: (data.deleted_at as string) ?? null,
  };
}
