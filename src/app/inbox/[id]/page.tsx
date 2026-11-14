import { notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { ThreadView } from "./ThreadView";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isParticipant, counterpart, isUuid } from "@/lib/messaging";
import { SignInToTakePart } from "@/components/ui/SignInToTakePart";
import { Avatar } from "@/components/ui/Avatar";

/**
 * One private conversation. Participants only: anyone else gets the same
 * not-found page (we never reveal that the conversation exists).
 */
export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();

  if (!viewer) {
    return (
      <main className="min-h-screen pb-24">
        <TopBar back={{ href: "/inbox", label: "Messages" }} />
        <div className="mx-auto max-w-2xl px-4 pt-6">
          <SignInToTakePart action="read your messages" />
        </div>
        <BottomNav />
      </main>
    );
  }
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const { data: thread } = await supabase
    .from("message_threads")
    .select("user_lo, user_hi, posting_id, postings!message_threads_posting_id_fkey(id, title)")
    .eq("id", id)
    .maybeSingle();
  if (!thread || !isParticipant({ userLo: thread.user_lo, userHi: thread.user_hi }, viewer.id)) notFound();

  const otherId = counterpart({ userLo: thread.user_lo, userHi: thread.user_hi }, viewer.id);
  let otherHandle = "unknown";
  let otherAvatarPath: string | null = null;
  if (otherId) {
    const { data: prof } = await supabase.from("profiles").select("username, avatar_path").eq("id", otherId).maybeSingle();
    otherHandle = prof?.username ?? "unknown";
    otherAvatarPath = (prof?.avatar_path as string | null) ?? null;
  }
  // Many-to-one embed: PostgREST returns an object (typed loosely by the client).
  const posting = (thread as unknown as { postings?: { id: string; title: string } | null }).postings ?? null;

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/inbox", label: "Messages" }} />
      <div className="mx-auto max-w-2xl px-4 pt-4">
        <h1 className="flex items-center gap-2 text-lg font-bold text-ink"><Avatar username={otherHandle} path={otherAvatarPath} size={32} /><span className="min-w-0 break-words">Conversation with @{otherHandle}</span></h1>
        <p className="mb-3 text-sm text-ink/70">
          {posting ? (
            <>
              About{" "}
              <Link href={`/p/${posting.id}`} className="text-deep-navy underline-offset-2 hover:underline">
                {posting.title}
              </Link>
              . Private: only you and @{otherHandle} can read it.
            </>
          ) : (
            <>Private: only you and @{otherHandle} can read it.</>
          )}
        </p>
        <ThreadView threadId={id} viewerId={viewer.id} otherHandle={otherHandle} />
      </div>
      <BottomNav />
    </main>
  );
}
