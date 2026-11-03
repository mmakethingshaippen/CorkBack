import Link from "next/link";

/**
 * Themed 404 — shown for unknown routes and for notFound() calls (e.g. a
 * username with no profile row, or a missing posting).
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-md p-6">
      <div className="cork-band rounded-edge p-6">
        <h1 className="text-xl font-bold text-paper">Not found</h1>
      </div>
      <div className="mt-4 rounded-card border border-board bg-card p-4">
        <p className="font-bold text-ink">We couldn&apos;t find that.</p>
        <p className="mt-1 text-sm text-ink/80">
          The page or profile you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-control bg-dark-red px-5 py-3 font-bold text-white"
        >
          Back to the map
        </Link>
      </div>
    </main>
  );
}
