import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { totalUnread } from "@/lib/unread";

const NO_STORE = { "Cache-Control": "no-store" };
/** Postgres / PostgREST codes meaning the unread table or function is not installed. */
const UNSUPPORTED_CODES = new Set(["42P01", "PGRST202", "PGRST205"]);

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * GET - unread message counts for the signed-in user, from cb_unread_counts().
 * Returns { supported, total, byThread }. When the migration is not applied,
 * returns { supported: false } with 200 so the client can stop polling.
 */
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return json({ error: "Messaging is not configured in this environment.", code: "not_configured" }, 501);
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Your session has ended. Sign in again.", code: "signed_out" }, 401);

  const { data, error } = await supabase.rpc("cb_unread_counts");
  if (error) {
    if (error.code && UNSUPPORTED_CODES.has(error.code)) return json({ supported: false });
    console.error("[CorkBack] unread failed:", { code: error.code, message: error.message });
    return json({ error: "Couldn't load unread counts.", code: "load_failed" }, 500);
  }

  const byThread: Record<string, number> = {};
  for (const row of (data ?? []) as { thread_id: string; unread: number }[]) {
    const n = Number(row.unread);
    byThread[row.thread_id] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return json({ supported: true, total: totalUnread(byThread), byThread });
}
