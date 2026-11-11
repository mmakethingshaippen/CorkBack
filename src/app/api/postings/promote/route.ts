import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Mark/unmark a posting as promoted. OWNER ONLY.
 *
 * POST { postingId, promoted: boolean } → public.set_posting_promoted(), the one
 * authorized operation (stage 8): author only, visible postings only, and
 * promoting only while the posting is active (un-promoting is always allowed).
 * Phase B of the stage 8 SQL removes clients' direct UPDATE of is_promoted, so
 * this must not write the column itself. No payment, no price — label +
 * placement only.
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

  // Authorization lives in the database: public.set_posting_promoted allows only the
  // author, only on a visible posting, and promoting only while it is active.
  const { data, error } = await supabase.rpc("set_posting_promoted", { p_posting_id: postingId, p_promoted: promoted });
  if (error) {
    console.error("[CorkBack] promote failed:", { code: error.code, message: error.message });
    switch (error.code) {
      case "42501": return NextResponse.json({ error: "Sign in to manage promotion." }, { status: 401 });
      case "CB404": return NextResponse.json({ error: "Posting not found, or it isn't yours." }, { status: 404 });
      case "CB409": return NextResponse.json({ error: "This posting has ended; promotion only applies while it is live." }, { status: 409 });
      case "22P02": return NextResponse.json({ error: "Missing postingId." }, { status: 400 });
      default: return NextResponse.json({ error: "Could not update promotion." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, promoted: data === "promoted" });
}