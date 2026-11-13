import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";
import { PostingCardGrid } from "@/components/ui/PostingCardGrid";
import { PosterHandle } from "@/components/ui/PosterHandle";
import { SignInToTakePart } from "@/components/ui/SignInToTakePart";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { CategoryFollowButton } from "@/components/ui/CategoryFollowButton";
import { categoryLabel } from "@/lib/categories";
import { getViewer } from "@/lib/auth";
import { getFollowingFeed } from "@/lib/follows";
import { attachViewerLikes } from "@/lib/postings";
import type { Posting } from "@/lib/types";

/**
 * Following: active postings from posters you follow, newest first.
 * Follow is one-way and independent of friendship; this page never reads
 * connections. States: signed out, error, not following anyone, following but
 * nothing active, and the feed. Loading is app/following/loading.tsx.
 */
export const dynamic = "force-dynamic";

export default async function FollowingPage() {
  const viewer = await getViewer();

  let feed: { followees: { id: string; username: string }[]; categories: string[]; postings: Posting[] } | null = null;
  let loadError: string | null = null;
  if (viewer) {
    try {
      const f = await getFollowingFeed(viewer.id);
      feed = { ...f, postings: await attachViewerLikes(f.postings, viewer.id) };
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Could not load your Following feed.";
    }
  }

  const cards = feed?.postings ?? [];

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="space-y-4 px-4 pt-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Following</h1>
          <p className="mt-1 text-paper/90">
            Active postings from posters you follow, newest first. Following is one-way and doesn&apos;t make you
            friends.
          </p>
        </CorkBand>

        {!viewer ? (
          <SignInToTakePart action="follow posters and see their postings here" />
        ) : loadError ? (
          <div role="alert" className="rounded-card border-2 border-dark-red bg-white p-4">
            <p className="font-bold text-ink">Your Following feed couldn&apos;t load.</p>
            <p className="mt-1 text-sm text-ink/70">{loadError}</p>
            <Link href="/following" className="mt-3 inline-block font-bold text-deep-navy underline-offset-2 hover:underline">
              Try again
            </Link>
          </div>
        ) : feed && feed.followees.length === 0 && feed.categories.length === 0 ? (
          <CorkBand>
            <p className="font-bold text-paper">You&apos;re not following anyone yet.</p>
            <p className="mt-1 text-paper/90">
              Open a poster&apos;s profile or one of their postings and choose Follow, or follow a category on the
              map. Their active postings will show up here.
            </p>
            <Link href="/" className="mt-3 inline-block font-bold text-paper underline underline-offset-2">
              Browse the map
            </Link>
          </CorkBand>
        ) : feed && cards.length === 0 ? (
          <CorkBand>
            <p className="font-bold text-paper">Nothing active right now.</p>
            <p className="mt-1 text-paper/90">
              Nothing you follow has an active posting. Check back later.
            </p>
          </CorkBand>
        ) : (
          <section aria-labelledby="following-feed">
            <h2 id="following-feed" className="sr-only">
              Postings from posters you follow
            </h2>
            <PostingCardGrid postings={feed?.postings ?? []} signedIn />
          </section>
        )}

        {viewer && feed && feed.categories.length > 0 ? (
          <section className="pt-2">
            <h2 className="mb-2 text-lg font-bold text-ink">Categories you follow</h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {feed.categories.map((slug) => (
                <li key={slug} className="inline-flex items-center gap-1">
                  <CategoryChip label={categoryLabel(slug)} as="span" />
                  <CategoryFollowButton slug={slug} label={categoryLabel(slug)} initialFollowing signedIn />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {viewer && feed && feed.followees.length > 0 ? (
          <section className="pt-2">
            <h2 className="mb-2 text-lg font-bold text-ink">You follow</h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {feed.followees.map((f) => (
                <li key={f.id}>
                  <PosterHandle username={f.username} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <BottomNav />
    </main>
  );
}
