import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Stage 4 — mark/unmark a posting as promoted. OWNER ONLY.
 *
 * POST { postingId, promoted: boolean } → set is_promoted on the caller's own,
 * live (non-deleted) posting. A non-owner is blocked (RLS: the postings update
 * policy only allows auth.uid() = author_id; we also check explicitly for a
 * readable 403). No payment, no price — label + placement only.
 *
 * Promotion is effective only while the posting is live: it ends at expiry and
 * ends on delete. We do not clear the flag at expiry (ordering already ignores
 * expired/deleted rows since they are not in the active list), but we refuse to
 * promote an already-expired or deleted posting.
 */
export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Not configured." }, { status: 501 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage promotion." }, { status: 401 });

  const b = await req.json();
  const postingId = b.postingId;
  const promoted = b.promoted;
  if (typeof postingId !== "string" || !postingId) {
    return NextResponse.json({ error: "Missing postingId." }, { status: 400 });
  }
  if (typeof promoted !== "boolean") {
    return NextResponse.json({ error: "promoted must be true or false." }, { status: 400 });
  }

  // Ownership + liveness check (readable errors; RLS is the real guard).
  const { data: posting } = await supabase
    .from("postings")
    .select("id, author_id, deleted_at, expires_at")
    .eq("id", postingId)
    .maybeSingle();
  if (!posting) return NextResponse.json({ error: "Posting not found." }, { status: 404 });
  if (posting.author_id !== user.id) {
    return NextResponse.json({ error: "You can only promote your own posting." }, { status: 403 });
  }
  if (posting.deleted_at) {
    return NextResponse.json({ error: "This posting is deleted." }, { status: 400 });
  }
  if (promoted && new Date(posting.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "This posting has expired; promotion only applies while it is live." }, { status: 400 });
  }

  const { error } = await supabase
    .from("postings")
    .update({ is_promoted: promoted })
    .eq("id", postingId)
    .eq("author_id", user.id); // defense in depth alongside RLS
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, promoted });
}
