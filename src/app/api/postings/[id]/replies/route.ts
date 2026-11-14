import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/reactionState";
import { replyErrorResponse, validateReplyBody } from "@/lib/replies";

/**
 * POST { body, clientId } — add a public reply to a posting.
 * Written ONLY through public.submit_reply (no direct table insert exists for
 * any client role): validates, requires an active visible posting, answers a
 * retry of the same clientId with the original reply (nothing created or
 * counted twice), and enforces 10 replies per 10 minutes with durable
 * accounting that deleting replies cannot reset.
 * Replies have no likes and cannot be edited.
 */
const fail = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Replies aren't available in this environment.");
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Your session has ended. Sign in to reply; your draft is kept.");
  if (!isUuid(id)) return fail(404, "not_found", "This posting isn't available, so it can't take replies.");

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "invalid", "Invalid request.");
  }
  const body = validateReplyBody(b.body);
  if (!body.ok) return fail(400, "invalid_body", body.error);
  if (!isUuid(b.clientId)) return fail(400, "invalid", "Missing send id. Refresh the page and try again.");

  const { data: replyId, error } = await supabase.rpc("submit_reply", {
    p_posting_id: id,
    p_body: body.value,
    p_client_id: b.clientId,
  });
  if (error || typeof replyId !== "string") {
    console.error("[CorkBack] reply failed:", { code: error?.code, message: error?.message });
    const r = replyErrorResponse(error?.code);
    return fail(r.status, r.code, r.error);
  }

  // Read it back as the author (RLS). If it was deleted since a retried key, there is nothing to return.
  const { data: row } = await supabase
    .from("replies")
    .select("id, body, created_at, author_id, profiles!replies_author_id_fkey(username, avatar_path)")
    .eq("id", replyId)
    .maybeSingle();
  if (!row) return NextResponse.json({ id: replyId, reply: null });
  const r = row as unknown as { id: string; body: string; created_at: string; author_id: string; profiles: { username?: string; avatar_path?: string | null } | null };
  return NextResponse.json({
    id: replyId,
    reply: { id: r.id, body: r.body, createdAt: r.created_at, authorId: r.author_id, authorUsername: r.profiles?.username ?? "unknown", authorAvatarPath: r.profiles?.avatar_path ?? null },
  });
}
