import { NextResponse } from "next/server";
import { guardReaction, reactionSnapshot, writeError } from "@/lib/reactionRoute";
import { parseLikeBody } from "@/lib/reactionState";

/**
 * PUT /api/postings/[id]/like  { liked: boolean }
 * Sets the viewer's like to the DESIRED state (idempotent; repeats are no-ops).
 * One like per user per posting is guaranteed by the (posting_id, user_id) key.
 * Responds with the viewer's state and fresh public counts.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guardReaction(req, id);
  if (!g.ok) return g.res;

  const parsed = parseLikeBody(g.body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "Send { liked: true | false }.", code: "invalid" }, { status: 400 });
  }

  const { error } = parsed.liked
    ? await g.supabase
        .from("likes")
        .upsert({ posting_id: id, user_id: g.user.id }, { onConflict: "posting_id,user_id", ignoreDuplicates: true })
    : await g.supabase.from("likes").delete().eq("posting_id", id).eq("user_id", g.user.id);
  if (error) return writeError(error);

  return reactionSnapshot(g.supabase, id, g.user.id);
}
