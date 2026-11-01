import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isParticipant, validateMessageBody } from "@/lib/messaging";

/**
 * Reply inside an existing thread by threadId. Signed-in participants only.
 * RLS already blocks non-participants from reading the thread or inserting a
 * message; this route adds an explicit participant check for a readable error.
 */
export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Messaging is not configured in this environment." }, { status: 501 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to reply." }, { status: 401 });

  const b = await req.json();
  const threadId = b.threadId;
  if (typeof threadId !== "string" || !threadId) {
    return NextResponse.json({ error: "Missing threadId." }, { status: 400 });
  }
  const bodyCheck = validateMessageBody(b.body);
  if (!bodyCheck.ok) return NextResponse.json({ error: bodyCheck.error }, { status: 400 });

  // RLS returns the thread only if the caller participates; a third user gets null.
  const { data: thread } = await supabase
    .from("message_threads")
    .select("user_lo, user_hi")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread || !isParticipant({ userLo: thread.user_lo, userHi: thread.user_hi }, user.id)) {
    return NextResponse.json({ error: "You are not a participant in this thread." }, { status: 403 });
  }

  const { error } = await supabase
    .from("messages")
    .insert({ thread_id: threadId, sender_id: user.id, body: bodyCheck.value });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
