import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isParticipant, isUuid, validateMessageBody } from "@/lib/messaging";
import { sendErrorResponse, sendMessageOnce } from "@/lib/messagesServer";

/**
 * POST { threadId, body, clientId } - reply inside an existing conversation.
 * Participants only (RLS). `clientId` makes retries/double submits idempotent.
 * Returns { message, duplicate }.
 */
const fail = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status });

export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Messaging is not configured in this environment.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Your session has ended. Sign in again to send; your draft is kept.");

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "invalid", "Invalid request.");
  }
  if (!isUuid(b.threadId)) return fail(404, "not_found", "Conversation not found.");
  if (!isUuid(b.clientId)) return fail(400, "invalid", "Missing send id. Refresh the page and try again.");
  const bodyCheck = validateMessageBody(b.body);
  if (!bodyCheck.ok) return fail(400, "invalid_body", bodyCheck.error);

  // RLS returns the thread only to a participant; others get the same 404.
  const { data: thread } = await supabase.from("message_threads").select("user_lo, user_hi").eq("id", b.threadId).maybeSingle();
  if (!thread || !isParticipant({ userLo: thread.user_lo, userHi: thread.user_hi }, user.id)) {
    return fail(404, "not_found", "Conversation not found.");
  }

  const sent = await sendMessageOnce(supabase, b.threadId, user.id, bodyCheck.value, b.clientId);
  if (!sent.ok) {
    console.error("[CorkBack] reply failed:", { code: sent.code, message: sent.message });
    const r = sendErrorResponse(sent.code);
    return fail(r.status, r.code, r.error);
  }
  return NextResponse.json({ message: sent.message, duplicate: sent.duplicate });
}
