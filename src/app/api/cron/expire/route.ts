import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Expiry sweep (Vercel cron). Hides postings whose preset expiry has passed, or
 * whose event date is in the past. Uses the service-role key (server only) so it
 * can act across all rows; guarded by CRON_SECRET.
 *
 * The map query already filters by expires_at and event date, so this sweep is a
 * durable backstop that soft-deletes stale rows.
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

  const { error } = await supabase
    .from("postings")
    .update({ deleted_at: nowIso })
    .is("deleted_at", null)
    .or(`expires_at.lte.${nowIso},event_date.lt.${today}`);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sweptAt: nowIso });
}
