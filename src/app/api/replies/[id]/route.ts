import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/reactionState";

/**
 * DELETE — remove your own reply. RLS only lets the author delete (policy
 * "replies author delete"); nobody can delete someone else's. Deleting does not
 * give back reply rate-limit allowance (the ledger is separate).
 */
const fail = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status });

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Replies aren't available in this environment.");
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Sign in to delete your reply.");
  if (!isUuid(id)) return fail(404, "not_found", "That reply was not found.");

  const { data, error } = await supabase.from("replies").delete().eq("id", id).eq("author_id", user.id).select("id");
  if (error) {
    console.error("[CorkBack] reply delete failed:", { code: error.code, message: error.message });
    return fail(500, "failed", "Couldn't delete the reply. Try again.");
  }
  // Idempotent: a reply that is already gone (or isn't yours) reads the same, without confirming it exists.
  if (!data || data.length === 0) return NextResponse.json({ deleted: false });
  return NextResponse.json({ deleted: true });
}
