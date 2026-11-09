import { notFound } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { PosterHandle } from "@/components/ui/PosterHandle";
import { PostingCardGrid } from "@/components/ui/PostingCardGrid";
import { getProfileByUsername, listPostingsByUsername } from "@/lib/postings";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isFollowing } from "@/lib/follows";
import { FollowButton } from "@/components/ui/FollowButton";

/**
 * Poster profile — the target of the navy @handle link. Shows the real username,
 * a Follow control (one-way; independent of Connect), and active postings.
 * A username with no profile row renders the not-found state.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const [postings, viewer] = await Promise.all([listPostingsByUsername(profile.username), getViewer()]);
  const isSelf = viewer?.id === profile.id;
  const following =
    viewer && !isSelf && !profile.id.startsWith("seed-")
      ? await isFollowing(await createClient(), viewer.id, profile.id)
      : false;

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="space-y-4 px-4">
        <PosterHandle username={profile.username} className="text-2xl" />
        <p className="text-ink/70">{isSelf ? "This is your profile." : "Neighbour on CorkBack."}</p>
        <FollowButton
          username={profile.username}
          initialFollowing={following}
          signedIn={viewer !== null}
          isSelf={isSelf}
        />

        <section className="pt-2">
          <h2 className="mb-3 text-lg font-bold text-ink">Postings</h2>
          {postings.length === 0 ? (
            <p className="text-sm text-ink/60">No active postings from @{profile.username} right now.</p>
          ) : (
            <PostingCardGrid postings={postings} />
          )}
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
