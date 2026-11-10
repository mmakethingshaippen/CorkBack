import { NextResponse } from "next/server";
import { guardReaction, reactionSnapshot, writeError } from "@/lib/reactionRoute";
import { parsePlanBody } from "@/lib/reactionState";

/**
 * PUT /api/postings/[id]/plan  { kind: "going" | "interested" | null }
 * Sets the viewer's plan to the DESIRED state. Going and Interested are mutually
 * exclusive (one row per user per posting); null clears the plan. Idempotent.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guardReaction(req, id);
  if (!g.ok) return g.res;

  const parsed = parsePlanBody(g.body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'Send { kind: "going" | "interested" | null }.', code: "invalid" },
      { status: 400 },
    );
  }

  const { error } = parsed.kind
    ? await g.supabase
        .from("plans")
        .upsert({ posting_id: id, user_id: g.user.id, kind: parsed.kind }, { onConflict: "posting_id,user_id" })
    : await g.supabase.from("plans").delete().eq("posting_id", id).eq("user_id", g.user.id);
  if (error) return writeError(error);

  return reactionSnapshot(g.supabase, id, g.user.id);
}
