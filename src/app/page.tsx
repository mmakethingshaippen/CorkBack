import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { CorkBand } from "@/components/ui/CorkBand";
import { BottomNav } from "@/components/ui/BottomNav";
import { HomeMap } from "@/components/map/HomeMap";
import { redirect } from "next/navigation";
import { attachViewerLikes } from "@/lib/postings";
import { queryPostingsInBounds } from "@/lib/mapQuery";
import { boundsForRadius, snapBoundsOutward } from "@/lib/mapBounds";
import { DEFAULT_RADIUS_MILES } from "@/lib/nearby";
import type { Posting } from "@/lib/types";
import { getViewer, getViewerHomePoint } from "@/lib/auth";
import { viewerFollowedCategorySlugs } from "@/lib/categoryFollows";
import { AuthHashForwarder } from "@/components/auth/AuthHashForwarder";

const BERKELEY_CENTRE = { lat: 37.8715, lng: -122.273 };

// Public home: local-first map + filterable rail. No account wall for browsing.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Supabase Site URL fallback, server half. If an auth email link landed on
  // the homepage (redirect not allowed, or a template that points at the Site
  // URL), send its credentials into the auth routes instead of showing the
  // board. Values are passed through, never logged.
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const code = one("code");
  const tokenHash = one("token_hash");
  const errorCode = one("error_code");
  if (code) {
    redirect(`/auth/callback?code=${encodeURIComponent(code)}`);
  }
  if (tokenHash) {
    const qs = new URLSearchParams({ token_hash: tokenHash, type: one("type") ?? "recovery" });
    const next = one("next");
    if (next) qs.set("next", next);
    redirect(`/auth/confirm?${qs.toString()}`);
  }
  if (errorCode) {
    redirect(`/sign-in?error=${errorCode === "otp_expired" ? "link_expired" : "link_invalid"}`);
  }

  const viewer = await getViewer();

  // Signed-in viewer's alert home point: the centre of the initial board query
  // and a map-centering fallback. Never shown publicly.
  const homePoint = viewer ? await getViewerHomePoint() : null;

  // Initial board: the capped cards-mode query for the snapped box around the
  // alert home point (or Berkeley) at the default radius, no category. The page
  // no longer loads every active posting.
  let postings: Posting[] = [];
  let truncated = false;
  let loadError: string | null = null;
  try {
    const centre = homePoint ?? BERKELEY_CENTRE;
    const result = await queryPostingsInBounds({
      bounds: snapBoundsOutward(boundsForRadius(centre, DEFAULT_RADIUS_MILES)),
      category: null,
      mode: "cards",
    });
    // The viewer's own saved likes, for the card Like buttons.
    postings = await attachViewerLikes(result.items as Posting[], viewer?.id ?? null);
    truncated = result.truncated;
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load postings.";
  }
  const followedCategories = await viewerFollowedCategorySlugs(viewer?.id ?? null);

  return (
    <main className="min-h-screen pb-24">
      <AuthHashForwarder />
      <TopBar />

      {/* Cork header band (Choice A: cork only on header bands / empty states). */}
      <div className="px-4">
        <CorkBand>
          {viewer ? (
            <p className="mb-2 text-sm font-bold text-paper">
              You&apos;re on the board{viewer.username ? `, @${viewer.username}` : ""}.
            </p>
          ) : null}
          <h1 className="text-2xl font-bold text-paper">The world, posted locally.</h1>
          <p className="mt-1 hidden text-paper/90 sm:block">Paper flyers. Real places. What&apos;s happening around you.</p>
        </CorkBand>
      </div>

      {/* Actions — Scan a flyer (dark red), Set an alert (deep navy). */}
      <div className="space-y-3 px-4 pt-4">
        <div className="flex gap-3">
          <Link
            href="/scan"
            className="flex-1 rounded-control bg-dark-red px-5 py-3 text-center font-bold text-white"
          >
            Scan a flyer
          </Link>
          <Link
            href="/alerts"
            className="flex-1 rounded-control bg-deep-navy px-5 py-3 text-center font-bold text-white"
          >
            Set an alert
          </Link>
        </div>
      </div>

      {/* Local-first map + town search + category filter + rail. */}
      <section className="px-4 pt-6">
        {loadError ? (
          <div className="rounded-card border border-dark-red/40 bg-dark-red/5 p-4">
            <p className="font-bold text-dark-red">Postings couldn&apos;t be loaded.</p>
            <p className="mt-1 text-sm text-ink/80">{loadError}</p>
          </div>
        ) : (
          <HomeMap postings={postings} truncated={truncated} homePoint={homePoint} signedIn={viewer !== null} followedCategories={followedCategories} />
        )}
      </section>

      <BottomNav />
    </main>
  );
}
