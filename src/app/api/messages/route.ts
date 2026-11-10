import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid, orderedPair, validateMessageBody } from "@/lib/messaging";
import { isValidUsername } from "@/lib/domain";
import { sendErrorResponse, sendMessageOnce } from "@/lib/messagesServer";

/**
 * Private messaging API. Signed-in participants only; RLS is the enforcement
 * (supabase/stage3_messaging.sql + stage6_social_part4.sql).
 *
 * POST { postingId, toUsername, body, clientId }
 *   Start (or reuse) the ONE conversation with the posting's author about that
 *   posting, and send a message. `clientId` (uuid) makes retries idempotent.
 *   Returns { threadId, message, duplicate }.
 * GET  ?threadId=  Messages in a thread the caller participates in, oldest
 *   first. 404 if the thread does not exist or the caller is not a participant.
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
  const bodyCheck = validateMessageBody(b.body);
  if (!bodyCheck.ok) return fail(400, "invalid_body", bodyCheck.error);
  if (!isUuid(b.clientId)) return fail(400, "invalid", "Missing send id. Refresh the page and try again.");
  if (!isUuid(b.postingId)) return fail(400, "invalid", "Messages start from a posting.");
  if (typeof b.toUsername !== "string" || !isValidUsername(b.toUsername)) return fail(404, "not_found", "That poster was not found.");

  // The conversation's context: the posting and its author.
  const { data: posting } = await supabase
    .from("postings")
    .select("id, author_id, profiles!postings_author_id_fkey(username)")
    .eq("id", b.postingId)
    .is("deleted_at", null)
    .maybeSingle();
  const authorName = (posting as { profiles?: { username?: string } | null } | null)?.profiles?.username;
  if (!posting || authorName !== b.toUsername) return fail(404, "not_found", "That posting or poster was not found.");
  const authorId = String(posting.author_id);
  if (authorId === user.id) return fail(400, "self", "You can't message yourself about your own posting.");

  const { userLo, userHi } = orderedPair(user.id, authorId);
  const findThread = () =>
    supabase.from("message_threads").select("id").eq("posting_id", posting.id).eq("user_lo", userLo).eq("user_hi", userHi).maybeSingle();

  let threadId: string | null = (await findThread()).data?.id ?? null;
  if (!threadId) {
    const { data: created, error } = await supabase
      .from("message_threads")
      .insert({ posting_id: posting.id, user_lo: userLo, user_hi: userHi })
      .select("id")
      .single();
    if (created) threadId = created.id;
    else if (error?.code === "23505") threadId = (await findThread()).data?.id ?? null; // a concurrent send created it
    if (!threadId) {
      console.error("[CorkBack] thread create failed:", { code: error?.code, message: error?.message });
      return fail(error?.code === "42501" ? 403 : 500, "thread_failed", "Couldn't start the conversation. Your draft is kept, so you can try again.");
    }
  }

  const sent = await sendMessageOnce(supabase, threadId, user.id, bodyCheck.value, b.clientId);
  if (!sent.ok) {
    console.error("[CorkBack] message send failed:", { code: sent.code, message: sent.message });
    const r = sendErrorResponse(sent.code);
    return fail(r.status, r.code, r.error);
  }
  return NextResponse.json({ threadId, message: sent.message, duplicate: sent.duplicate });
}

export async function GET(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Messaging is not configured in this environment.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Your session has ended. Sign in again to read messages.");

  const threadId = new URL(req.url).searchParams.get("threadId");
  if (!isUuid(threadId)) return fail(404, "not_found", "Conversation not found.");

  // RLS returns the thread only to a participant.
  const { data: thread } = await supabase.from("message_threads").select("id").eq("id", threadId).maybeSingle();
  if (!thread) return fail(404, "not_found", "Conversation not found.");

  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return fail(500, "load_failed", "Couldn't load messages. Try again.");
  return NextResponse.json({ messages: data ?? [] });
}
