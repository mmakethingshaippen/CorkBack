import Link from "next/link";

/**
 * Shown for a posting that doesn't exist, was deleted, or isn't available.
 * Deliberately neutral: it never reveals WHY (deleted by its author, hidden by
 * moderators, or never existed). The author of a moderated posting sees a
 * separate notice on the posting page itself.
 */
export default function PostingNotAvailable() {
  return (
    <main className="mx-auto max-w-md p-6">
      <div className="cork-band rounded-edge p-6">
        <h1 className="text-xl font-bold text-paper">This posting isn&apos;t available</h1>
      </div>
      <div className="mt-4 rounded-card border border-board bg-card p-4">
        <p className="font-bold text-ink">We couldn&apos;t show that posting.</p>
        <p className="mt-1 text-sm text-ink/80">It may have been removed or the link may be wrong.</p>
        <Link href="/" className="mt-4 inline-block rounded-control bg-dark-red px-5 py-3 font-bold text-white">
          Back to the map
        </Link>
      </div>
    </main>
  );
}
