import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReplyView } from "./replies";

/**
 * Server reads for stage 8, all as the signed-in viewer (RLS and function
 * checks decide what comes back). Nothing here uses the service-role key.
 */

/** Is the current viewer an admin? False when signed out or on any error. */
export async function viewerIsAdmin(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin");
  return !error && data === true;
}

/**
 * The author's view of their own moderated posting: when it was hidden and the
 * moderator's stated reason. Empty for everyone else (including admins), and
 * never reveals reporters or report details.
 */
export async function getHiddenNotice(
  supabase: SupabaseClient,
  postingId: string,
): Promise<{ hiddenAt: string; reason: string | null } | null> {
  const { data, error } = await supabase.rpc("my_hidden_posting_notice", { p_posting_id: postingId });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { hidden_at: string; reason: string | null };
  return { hiddenAt: String(row.hidden_at), reason: row.reason ?? null };
}

/** Does the viewer have a PENDING report on this posting? (They can read their own reports only.) */
export async function hasPendingReport(supabase: SupabaseClient, postingId: string, viewerId: string): Promise<boolean> {
  const { data } = await supabase
    .from("posting_reports")
    .select("id")
    .eq("posting_id", postingId)
    .eq("status", "pending")
    .limit(1);
  void viewerId; // RLS already limits rows to the viewer's own reports
  return (data?.length ?? 0) > 0;
}

/** Replies on a visible posting, oldest first (RLS returns none for deleted or hidden postings). */
export async function listReplies(supabase: SupabaseClient, postingId: string): Promise<ReplyView[]> {
  const { data, error } = await supabase
    .from("replies")
    .select("id, body, created_at, author_id, profiles!replies_author_id_fkey(username)")
    .eq("posting_id", postingId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(200);
  if (error) {
    console.error("[CorkBack] replies read failed:", { code: error.code, message: error.message });
    return [];
  }
  return (data ?? []).map((r) => {
    const row = r as unknown as { id: string; body: string; created_at: string; author_id: string; profiles: { username?: string } | null };
    return {
      id: String(row.id),
      body: String(row.body),
      createdAt: String(row.created_at),
      authorId: String(row.author_id),
      authorUsername: row.profiles?.username ?? "unknown",
    };
  });
}
