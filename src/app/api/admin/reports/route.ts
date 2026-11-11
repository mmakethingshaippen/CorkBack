import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminErrorResponse } from "@/lib/moderation";
import { fetchQueue, parseQueueStatus, parseReasonFilter } from "@/lib/adminData";

/**
 * GET ?status=pending|resolved|all&reason=&offset= — the report queue.
 * Admins only: the database function checks is_admin() itself, and anyone else
 * (signed out included) gets the same 404 as a route that does not exist.
 */
const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

export async function GET(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return notFound();
  const q = new URL(req.url).searchParams;
  const offset = Math.max(0, Number.parseInt(q.get("offset") ?? "0", 10) || 0);
  const r = await fetchQueue(supabase, { status: parseQueueStatus(q.get("status")), reason: parseReasonFilter(q.get("reason")), offset });
  if (!r.ok) {
    const f = adminErrorResponse(r.code);
    return NextResponse.json({ error: f.error, code: f.code }, { status: f.status });
  }
  return NextResponse.json(r.value);
}
