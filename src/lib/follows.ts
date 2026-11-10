import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { buildFollowingFeed } from "./followState";
import { listPostingRowsByAuthorIds } from "./postings";
import type { Posting } from "./types";

/**
 * Server reads for Follow. Uses the caller's session; RLS ("follows self read")
 * lets a user see only edges where they are the follower or the followee.
 * Follow is independent of friendship: nothing here touches connections.
 */

export async function isFollowing(supabase: SupabaseClient, followerId: string, followeeId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("follows")
    .select("followee_id")
    .eq("follower_id", followerId)
    .eq("followee_id", followeeId)
    .maybeSingle();
  if (error) throw new Error(`Could not load follow state (${error.code ?? "unknown"}).`);
  return Boolean(data);
}

/** Usernames and ids of the profiles the viewer follows (oldest follow first). */
export async function listFollowees(supabase: SupabaseClient, followerId: string): Promise<{ id: string; username: string }[]> {
  const { data, error } = await supabase
    .from("follows")
    .select("followee_id, created_at, profiles!follows_followee_id_fkey(username)")
    .eq("follower_id", followerId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`Could not load who you follow (${error.code ?? "unknown"}).`);
  return (data ?? []).map((r) => ({
    id: String(r.followee_id),
    username: (r as { profiles?: { username?: string } | null }).profiles?.username ?? "",
  })).filter((r) => r.username);
}

export async function getFollowingFeed(viewerId: string, now = new Date()): Promise<{
  followees: { id: string; username: string }[];
  postings: Posting[];
}> {
  const supabase = await createClient();
  const followees = await listFollowees(supabase, viewerId);
  const rows = await listPostingRowsByAuthorIds(followees.map((f) => f.id), now);
  return { followees, postings: buildFollowingFeed(rows, new Set(followees.map((f) => f.id)), now) };
}
