import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { counterpart } from "@/lib/messaging";

/**
 * Inbox listing — the signed-in user's own threads ONLY (RLS returns only
 * threads they participate in). Returns the counterpart handle and a preview of
 * the latest message. A third user sees none of someone else's threads.
 */
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Messaging is not configured in this environment." }, { status: 501 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to view your inbox." }, { status: 401 });

  // RLS limits this to threads where the user is a participant.
  const { data: threads, error } = await supabase
    .from("message_threads")
    .select("id, posting_id, user_lo, user_hi, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const result = [];
  for (const t of threads ?? []) {
    const otherId = counterpart({ userLo: t.user_lo, userHi: t.user_hi }, user.id);
    let otherHandle = "unknown";
    if (otherId) {
      const { data: prof } = await supabase.from("profiles").select("username").eq("id", otherId).maybeSingle();
      otherHandle = prof?.username ?? "unknown";
    }
    const { data: last } = await supabase
      .from("messages")
      .select("body, created_at, sender_id")
      .eq("thread_id", t.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    result.push({
      id: t.id,
      postingId: t.posting_id,
      otherHandle,
      lastMessage: last?.body ?? null,
      lastAt: last?.created_at ?? t.created_at,
      lastFromMe: last?.sender_id === user.id,
    });
  }

  return NextResponse.json({ threads: result });
}
