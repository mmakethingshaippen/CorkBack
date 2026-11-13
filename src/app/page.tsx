import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { CorkBand } from "@/components/ui/CorkBand";
import { BottomNav } from "@/components/ui/BottomNav";
import { MapView } from "@/components/map/MapView";
import { HomeMap } from "@/components/map/HomeMap";
import { redirect } from "next/navigation";
import { attachViewerLikes, listActivePostings } from "@/lib/postings";
import { getViewer, getViewerHomePoint } from "@/lib/auth";
import { viewerFollowedCategorySlugs } from "@/lib/categoryFollows";
import { AuthHashForwarder } from "@/components/auth/AuthHashForwarder";

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

  let postings: Awaited<ReturnType<typeof listActivePostings>> = [];
  let loadError: string | null = null;
  try {
    // The viewer's own saved likes, for the card Like buttons.
    postings = await attachViewerLikes(await listActivePostings(), viewer?.id ?? null);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load postings.";
  }

  // Signed-in viewer's alert home point — used only as a map-centering fallback
  // when device location is unavailable. Never shown publicly.
  const homePoint = viewer ? await getViewerHomePoint() : null;
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
          <p className="mt-1 text-paper/90">Paper flyers. Real places. What&apos;s happening around you.</p>
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
          <HomeMap postings={postings} homePoint={homePoint} signedIn={viewer !== null} followedCategories={followedCategories} />
        )}
      </section>

      {/* Secondary: the world map, not the starting view. */}
      <section className="px-4 pt-8">
        <h2 className="mb-2 text-sm font-bold text-ink/70">Explore the world</h2>
        <div className="h-64 overflow-hidden rounded-card border border-board">
          <MapView postings={postings} />
        </div>
      </section>

      <BottomNav />
    </main>
  );
}
