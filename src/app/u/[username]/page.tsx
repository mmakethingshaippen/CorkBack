import { notFound } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { PosterHandle } from "@/components/ui/PosterHandle";
import { PostingCard } from "@/components/ui/PostingCard";
import { tiltFor } from "@/components/ui/Card";
import { getProfileByUsername, listPostingsByUsername } from "@/lib/postings";

/**
 * Poster profile — the target of the navy @handle link. Shows the real username
 * and the user's active postings. A username with no profile row renders the
 * not-found state (not a generic page). Follow and Connect are not part of this
 * release, so no control is shown.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const postings = await listPostingsByUsername(profile.username);
  let prev: number | null = null;
  const withTilt = postings.map((p) => {
    const t = tiltFor(p.id, prev);
    const entry = { posting: p, prevTilt: prev };
    prev = t;
    return entry;
  });

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="space-y-4 px-4">
        <PosterHandle username={profile.username} className="text-2xl" />
        <p className="text-ink/70">Neighbour on CorkBack.</p>
        <p className="text-sm text-ink/60">
          Follow is one-way and never mutual. Connect is a separate friend request. Changing one never changes the
          other. Following and Connect are not part of this release.
        </p>

        <section className="pt-2">
          <h2 className="mb-3 text-lg font-bold text-ink">Postings</h2>
          {withTilt.length === 0 ? (
            <p className="text-sm text-ink/60">No active postings from @{profile.username} right now.</p>
          ) : (
            <div className="grid gap-4">
              {withTilt.map(({ posting, prevTilt }) => (
                <PostingCard key={posting.id} posting={posting} tiltId={posting.id} prevTilt={prevTilt} />
              ))}
            </div>
          )}
        </section>
      </div>
      <BottomNav />
    </main>
  );
}
