import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/messaging";

const NO_STORE = { "Cache-Control": "no-store" };
const UNSUPPORTED_CODES = new Set(["42P01", "PGRST202", "PGRST205"]);
const MAX_UPTO_LENGTH = 40;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const fail = (status: number, code: string, error: string) => json({ error, code }, status);

/**
 * POST { threadId, upTo } - mark a conversation read up to `upTo`.
 * cb_mark_thread_read never lowers the marker, caps it at server time, and only
 * touches the caller's own marker. Non-participants get the same 404 as a missing thread.
 */
export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Messaging is not configured in this environment.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Your session has ended. Sign in again.");

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "invalid", "Invalid request.");
  }
  if (!b || typeof b !== "object") return fail(400, "invalid", "Invalid request.");
  if (!isUuid(b.threadId)) return fail(400, "invalid", "Invalid conversation.");
  if (typeof b.upTo !== "string" || b.upTo.length === 0 || b.upTo.length > MAX_UPTO_LENGTH || Number.isNaN(Date.parse(b.upTo))) {
    return fail(400, "invalid", "Invalid timestamp.");
  }

  const { error } = await supabase.rpc("cb_mark_thread_read", { p_thread: b.threadId, p_upto: b.upTo });
  if (error) {
    if (error.code === "42501") return fail(404, "not_found", "Conversation not found.");
    if (error.code === "22023" || error.code === "22007" || error.code === "22008") return fail(400, "invalid", "Invalid request.");
    if (error.code && UNSUPPORTED_CODES.has(error.code)) return json({ supported: false });
    console.error("[CorkBack] mark read failed:", { code: error.code, message: error.message });
    return fail(500, "mark_failed", "Couldn't mark the conversation read.");
  }
  return json({ ok: true });
}
