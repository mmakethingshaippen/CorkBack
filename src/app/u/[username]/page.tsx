import { notFound } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { PosterHandle } from "@/components/ui/PosterHandle";
import { PostingCardGrid } from "@/components/ui/PostingCardGrid";
import { attachViewerLikes, getProfileByUsername, listPostingsByUsername } from "@/lib/postings";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isFollowing } from "@/lib/follows";
import { FollowButton } from "@/components/ui/FollowButton";
import { EditUsernameForm } from "./EditUsernameForm";
import { NavyLink } from "@/components/ui/actions";
import { viewerIsAdmin } from "@/lib/moderationData";
import { ConnectButton } from "@/components/ui/ConnectButton";
import { getRelationship } from "@/lib/connections";
import type { Relationship } from "@/lib/connectionState";

/**
 * Poster profile — the target of the navy @handle link. Shows the real username,
 * a Follow control (one-way; independent of Connect), and active postings.
 * A username with no profile row renders the not-found state.
 */
export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { username } = await params;
  const { deleted } = await searchParams;

  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const [rawPostings, viewer] = await Promise.all([listPostingsByUsername(profile.username), getViewer()]);
  const postings = await attachViewerLikes(rawPostings, viewer?.id ?? null);
  const isSelf = viewer?.id === profile.id;
  let following = false;
  let relationship: Relationship = "none";
  // The Admin link is a convenience on the admin's OWN profile only; /admin enforces access itself.
  const showAdminLink = isSelf && viewer ? await viewerIsAdmin(await createClient()) : false;
  if (viewer && !isSelf && !profile.id.startsWith("seed-")) {
    const supabase = await createClient();
    // Follow and friendship are read separately: neither implies the other.
    [following, relationship] = await Promise.all([
      isFollowing(supabase, viewer.id, profile.id),
      getRelationship(supabase, viewer.id, profile.id),
    ]);
  }

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="space-y-4 px-4">
        <PosterHandle username={profile.username} className="text-2xl" />
        {isSelf && deleted === "1" ? (
          <p role="status" className="rounded-card border border-board bg-board/40 p-3 font-bold text-ink">
            Your posting was deleted. It&apos;s off the map and your profile.
          </p>
        ) : null}
        <p className="text-ink/70">{isSelf ? "This is your profile." : "Neighbour on CorkBack."}</p>
        {isSelf && !profile.id.startsWith("seed-") ? <EditUsernameForm current={profile.username} /> : null}
        {showAdminLink ? (
          <p>
            <NavyLink href="/admin" className="font-bold">Admin: reports and moderation</NavyLink>
          </p>
        ) : null}
        <FollowButton
          username={profile.username}
          initialFollowing={following}
          signedIn={viewer !== null}
          isSelf={isSelf}
        />
        <ConnectButton
          username={profile.username}
          initialState={relationship}
          signedIn={viewer !== null}
          isSelf={isSelf}
        />

        <section className="pt-2">
          <h2 className="mb-3 text-lg font-bold text-ink">Postings</h2>
          {postings.length === 0 ? (
            <p className="text-sm text-ink/60">No active postings from @{profile.username} right now.</p>
          ) : (
            <PostingCardGrid postings={postings} signedIn={viewer !== null} ownerView={isSelf} />
          )}
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
