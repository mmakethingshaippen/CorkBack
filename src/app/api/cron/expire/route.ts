import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Expiry sweep (Vercel cron). READ-ONLY: it no longer soft-deletes anything.
 *
 * Ended postings keep a read-only detail page, so they must not be deleted
 * automatically. Expired and past-event postings are already kept off the map
 * by the read queries, which filter by expires_at and event date. `deleted_at`
 * is now set only when an author deletes a posting.
 *
 * The job keeps its CRON_SECRET guard and configuration check, and reports how
 * many non-deleted postings are past expiry or past their event date (the rows
 * it used to delete), for monitoring.
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Not configured." }, { status: 501 });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { cookies: { getAll: () => [], setAll: () => {} } },
  );

  const nowIso = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const { count, error } = await supabase
    .from("postings")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or(`expires_at.lte.${nowIso},event_date.lt.${today}`);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sweptAt: nowIso, deleted: 0, pastTakedown: count ?? 0 });
}
