import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThreadMessage } from "./messaging";

/**
 * Insert one message idempotently. `clientId` identifies the send attempt: a
 * retry or double submit with the same key hits the unique
 * (thread_id, sender_id, client_id) index and inserts nothing; the existing
 * message is returned instead. RLS ("messages participant insert") still
 * decides whether the caller may post in this thread.
 */
export async function sendMessageOnce(
  supabase: SupabaseClient,
  threadId: string,
  senderId: string,
  body: string,
  clientId: string,
): Promise<{ ok: true; message: ThreadMessage; duplicate: boolean } | { ok: false; code: string | undefined; message: string }> {
  const ins = await supabase
    .from("messages")
    .upsert(
      { thread_id: threadId, sender_id: senderId, body, client_id: clientId },
      { onConflict: "thread_id,sender_id,client_id", ignoreDuplicates: true },
    )
    .select("id, sender_id, body, created_at");
  if (ins.error) return { ok: false, code: ins.error.code, message: ins.error.message };
  if (ins.data && ins.data.length === 1) return { ok: true, message: ins.data[0] as ThreadMessage, duplicate: false };

  // Nothing inserted: this key was already used. Return the saved message.
  const existing = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("thread_id", threadId)
    .eq("sender_id", senderId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (existing.error || !existing.data) {
    return { ok: false, code: existing.error?.code, message: existing.error?.message ?? "Message was not saved." };
  }
  return { ok: true, message: existing.data as ThreadMessage, duplicate: true };
}

/** Map a database error from a send to a status and readable text. */
export function sendErrorResponse(code: string | undefined): { status: number; error: string; code: string } {
  if (code === "42501") return { status: 403, error: "You can't send messages in this conversation.", code: "forbidden" };
  if (code === "23514") return { status: 400, error: "Messages must be 1 to 2000 characters.", code: "invalid_body" };
  return { status: 500, error: "Your message wasn't sent. Your draft is kept, so you can try again.", code: "send_failed" };
}
