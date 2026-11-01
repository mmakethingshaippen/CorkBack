import { notFound } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { ThreadView } from "./ThreadView";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isParticipant, counterpart } from "@/lib/messaging";
import { SignInToTakePart } from "@/components/ui/SignInToTakePart";

// A single thread. Signed-in participants only. A third user is blocked here and
// by RLS; we render a not-found rather than reveal that the thread exists.
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewer();

  if (!viewer) {
    return (
      <main className="min-h-screen pb-24">
        <TopBar back={{ href: "/inbox", label: "Inbox" }} />
        <div className="mx-auto max-w-md px-4 pt-6">
          <SignInToTakePart action="read your messages" />
        </div>
        <BottomNav />
      </main>
    );
  }

  // RLS returns the thread only to a participant. A third user gets null → 404.
  const supabase = await createClient();
  const { data: thread } = await supabase
    .from("message_threads")
    .select("user_lo, user_hi")
    .eq("id", id)
    .maybeSingle();
  if (!thread || !isParticipant({ userLo: thread.user_lo, userHi: thread.user_hi }, viewer.id)) {
    notFound();
  }

  const otherId = counterpart({ userLo: thread.user_lo, userHi: thread.user_hi }, viewer.id);
  let otherHandle = "unknown";
  if (otherId) {
    const { data: prof } = await supabase.from("profiles").select("username").eq("id", otherId).maybeSingle();
    otherHandle = prof?.username ?? "unknown";
  }

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/inbox", label: "Inbox" }} />
      <div className="mx-auto max-w-md px-4 pt-4">
        <h1 className="mb-3 text-lg font-bold text-ink">@{otherHandle}</h1>
        <ThreadView threadId={id} viewerId={viewer.id} />
      </div>
      <BottomNav />
    </main>
  );
}
