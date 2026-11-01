"use client";

import { useEffect } from "react";

/**
 * Root error boundary. Catches anything thrown while rendering a route and
 * shows a readable message instead of an unhandled runtime error. The real
 * cause is already logged on the server (see src/lib/postings.ts); here we show
 * the error's message text, which is now always a proper Error.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-md p-6">
      <div className="cork-band rounded-edge p-6">
        <h1 className="text-xl font-bold text-paper">Something went wrong</h1>
      </div>
      <div className="mt-4 rounded-card border border-board bg-card p-4">
        <p className="font-bold text-ink">We couldn&apos;t load this page.</p>
        <p className="mt-1 text-sm text-ink/80">{error.message}</p>
        <button
          onClick={reset}
          className="mt-4 rounded-control bg-dark-red px-5 py-3 font-bold text-white"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
