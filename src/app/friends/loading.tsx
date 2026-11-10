import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";

/** Loading state for Friends (streamed while the server reads connections and plans). */
export default function FriendsLoading() {
  return (
    <main className="min-h-screen pb-24">
      {/* No TopBar here: it reads the session, which would delay this fallback. */}
      <div className="h-16" aria-hidden="true" />
      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Friends</h1>
        </CorkBand>
        <p role="status" aria-live="polite" className="text-ink/70">
          Loading your friends…
        </p>
        <div aria-hidden="true" className="grid gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-card border border-board bg-white" />
          ))}
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
