import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { orderedPair, validateMessageBody } from "@/lib/messaging";

/**
 * Stage 3 messaging API — signed-in participants only.
 *
 * POST  { postingId?, toUserId, body }  → find-or-create the 1:1 thread with
 *                                         toUserId and send a message. Returns
 *                                         { threadId }.
 * GET   ?threadId=...                    → messages in a thread the caller
 *                                         participates in (RLS-enforced).
 *
 * RLS (stage3_messaging.sql) is the real guard; these checks are defense in
 * depth and give readable errors. A third user cannot read or post.
 */

function notConfigured() {
  return NextResponse.json({ error: "Messaging is not configured in this environment." }, { status: 501 });
}

export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return notConfigured();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to send a message." }, { status: 401 });

  const b = await req.json();

  // Resolve the recipient by username (public name) so user ids stay off the
  // public posting page. `toUserId` is also accepted for internal callers.
  let toUserId: string | null = typeof b.toUserId === "string" && b.toUserId ? b.toUserId : null;
  if (!toUserId && typeof b.toUsername === "string" && b.toUsername) {
    const { data: prof } = await supabase.from("profiles").select("id").eq("username", b.toUsername).maybeSingle();
    toUserId = prof?.id ?? null;
    if (!toUserId) return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
  }
  if (!toUserId) {
    return NextResponse.json({ error: "A recipient is required." }, { status: 400 });
  }
  if (toUserId === user.id) {
    return NextResponse.json({ error: "You cannot message yourself." }, { status: 400 });
  }
  const bodyCheck = validateMessageBody(b.body);
  if (!bodyCheck.ok) return NextResponse.json({ error: bodyCheck.error }, { status: 400 });

  const postingId = typeof b.postingId === "string" && b.postingId ? b.postingId : null;
  const { userLo, userHi } = orderedPair(user.id, toUserId);

  // Find an existing thread for this pair + posting context, else create one.
  let findQuery = supabase
    .from("message_threads")
    .select("id")
    .eq("user_lo", userLo)
    .eq("user_hi", userHi);
  findQuery = postingId === null ? findQuery.is("posting_id", null) : findQuery.eq("posting_id", postingId);
  const existing = await findQuery.maybeSingle();

  let threadId: string | null = existing.data?.id ?? null;
  if (!threadId) {
    const { data: created, error: cErr } = await supabase
      .from("message_threads")
      .insert({ posting_id: postingId, user_lo: userLo, user_hi: userHi })
      .select("id")
      .single();
    if (cErr) {
      // Likely a unique-constraint race: another request created it. Re-fetch.
      let retryQuery = supabase
        .from("message_threads")
        .select("id")
        .eq("user_lo", userLo)
        .eq("user_hi", userHi);
      retryQuery = postingId === null ? retryQuery.is("posting_id", null) : retryQuery.eq("posting_id", postingId);
      const retry = await retryQuery.maybeSingle();
      if (!retry.data?.id) return NextResponse.json({ error: cErr.message }, { status: 400 });
      threadId = retry.data.id;
    } else {
      threadId = created.id;
    }
  }

  const { error: mErr } = await supabase
    .from("messages")
    .insert({ thread_id: threadId, sender_id: user.id, body: bodyCheck.value });
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 400 });

  return NextResponse.json({ threadId });
}

export async function GET(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return notConfigured();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to read messages." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");
  if (!threadId) return NextResponse.json({ error: "Missing threadId." }, { status: 400 });

  // RLS returns rows only if the caller is a participant; a third user gets [].
  const { data, error } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ messages: data ?? [] });
}
