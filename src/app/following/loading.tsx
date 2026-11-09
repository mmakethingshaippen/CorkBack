import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";

/** Loading state for the Following feed (streamed while the server reads follows and postings). */
export default function FollowingLoading() {
  return (
    <main className="min-h-screen pb-24">
      {/* No TopBar here: it reads the session, which would delay this fallback. */}
      <div className="h-16" aria-hidden="true" />
      <div className="space-y-4 px-4 pt-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Following</h1>
        </CorkBand>
        <p role="status" aria-live="polite" className="text-ink/70">
          Loading postings from posters you follow…
        </p>
        <div aria-hidden="true" className="grid gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-card border border-board bg-white" />
          ))}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
