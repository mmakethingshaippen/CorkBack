import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { counterpart } from "@/lib/messaging";

/**
 * Inbox listing: the signed-in user's own conversations only (RLS). Returns the
 * other person's username, the posting it is about, and the latest message,
 * newest activity first. No ids of other users leave the server.
 */
export async function GET() {
  const fail = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Messaging is not configured in this environment.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Your session has ended. Sign in again to see your messages.");

  const { data: threads, error } = await supabase
    .from("message_threads")
    .select("id, posting_id, user_lo, user_hi, created_at, postings!message_threads_posting_id_fkey(title)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return fail(500, "load_failed", "Couldn't load your messages. Try again.");

  const result = await Promise.all(
    (threads ?? []).map(async (t) => {
      const otherId = counterpart({ userLo: t.user_lo, userHi: t.user_hi }, user.id);
      const [prof, last] = await Promise.all([
        otherId
          ? supabase.from("profiles").select("username").eq("id", otherId).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("messages")
          .select("body, created_at, sender_id")
          .eq("thread_id", t.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        id: t.id,
        postingTitle: (t as { postings?: { title?: string } | null }).postings?.title ?? null,
        otherHandle: (prof.data as { username?: string } | null)?.username ?? "unknown",
        lastMessage: last.data?.body ?? null,
        lastAt: last.data?.created_at ?? t.created_at,
        lastFromMe: last.data?.sender_id === user.id,
      };
    }),
  );
  result.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return NextResponse.json({ threads: result });
}
