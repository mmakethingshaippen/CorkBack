import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { CorkBand } from "@/components/ui/CorkBand";
import { BottomNav } from "@/components/ui/BottomNav";
import { PostingCard } from "@/components/ui/PostingCard";
import { MapView } from "@/components/map/MapView";
import { listActivePostings } from "@/lib/postings";
import { tiltFor } from "@/components/ui/Card";
import { getViewer } from "@/lib/auth";

// Public home: map + posting rails. No account wall for browsing.
export default async function Home() {
  // The viewer lookup and postings load are independent; don't let a postings
  // failure blank the whole page. Load the viewer first, then try postings and
  // surface a readable banner if that specific query fails.
  const viewer = await getViewer();

  let postings: Awaited<ReturnType<typeof listActivePostings>> = [];
  let loadError: string | null = null;
  try {
    postings = await listActivePostings();
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not load postings.";
  }

  // Map heading: match the map center and the real posting location rather than
  // a hardcoded city. Derive it from the first posting's place label (the map
  // centers on the first posting). No city is invented; with no postings we use
  // a neutral heading.
  const mapHeading =
    postings.length > 0 && postings[0].placeLabel
      ? `Near ${postings[0].placeLabel}`
      : "Near you";

  // Pre-compute tilts so adjacent cards never mirror (Choice B).
  let prev: number | null = null;
  const withTilt = postings.map((p) => {
    const t = tiltFor(p.id, prev);
    const entry = { posting: p, prevTilt: prev };
    prev = t;
    return entry;
  });

  return (
    <main className="min-h-screen pb-24">
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

      {/* Actions */}
      <div className="space-y-3 px-4 pt-4">
        <div className="flex gap-3">
          {/* One dark-red main action per screen: Scan a flyer. */}
          <Link
            href="/scan"
            className="flex-1 rounded-control bg-dark-red px-5 py-3 text-center font-bold text-white"
          >
            Scan a flyer
          </Link>
          {/* Secondary action: navy. */}
          <Link
            href="/alerts"
            className="flex-1 rounded-control bg-deep-navy px-5 py-3 text-center font-bold text-white"
          >
            Set an alert
          </Link>
        </div>
      </div>

      {/* Interactive map */}
      <section className="px-4 pt-6">
        <h2 className="mb-2 text-sm font-bold text-ink/70">{mapHeading}</h2>
        <div className="h-64 overflow-hidden rounded-card border border-board">
          <MapView postings={postings} />
        </div>
      </section>

      {/* Posting rail */}
      <section className="px-4 pt-8">
        <h2 className="mb-3 text-lg font-bold text-ink">On your doorstep</h2>
        {loadError ? (
          <div className="rounded-card border border-dark-red/40 bg-dark-red/5 p-4">
            <p className="font-bold text-dark-red">Postings couldn&apos;t be loaded.</p>
            <p className="mt-1 text-sm text-ink/80">{loadError}</p>
          </div>
        ) : withTilt.length === 0 ? (
          <CorkBand>
            <p className="text-paper">Nothing posted nearby yet. Be the first — scan a flyer.</p>
          </CorkBand>
        ) : (
          <div className="grid gap-4">
            {withTilt.map(({ posting, prevTilt }) => (
              <PostingCard key={posting.id} posting={posting} tiltId={posting.id} prevTilt={prevTilt} />
            ))}
          </div>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
