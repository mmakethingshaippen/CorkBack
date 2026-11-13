"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
/**
 * Follow / Unfollow a category. A feed follow: it adds that category's active
 * postings to your Following page. It is not email (alerts are separate).
 * - Initial state comes from a server read, so it survives refresh/sign-in.
 * - The click updates immediately; extra clicks are ignored while a save is in
 *   flight; a failed save rolls back with a message.
 * - Signed out: renders nothing, so browsing stays free of prompts.
 */
export function CategoryFollowButton({
  slug,
  label,
  initialFollowing,
  signedIn,
}: {
  slug: string;
  label: string;
  initialFollowing: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialFollowing);
  const [view, setView] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  if (!signedIn) return null;
  async function toggle() {
    if (inFlight.current) return;
    inFlight.current = true;
    const next = !view;
    setPending(true);
    setMessage(null);
    setView(next);
    try {
      const res = await fetch(`/api/category-follows/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ following: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { following?: boolean; error?: string; code?: string };
      if (!res.ok) {
        setView(saved);
        setMessage(
          data.code === "signed_out"
            ? "Your session has ended. Sign in again to save this."
            : data.error ?? "Could not save. Try again.",
        );
        return;
      }
      const confirmed = Boolean(data.following);
      setSaved(confirmed);
      setView(confirmed);
      router.refresh(); // keep server-rendered views (e.g. the Following feed) in sync
    } catch {
      setView(saved);
      setMessage("Could not reach CorkBack. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-1" aria-busy={pending}>
      <button
        type="button"
        onClick={toggle}
        aria-disabled={pending}
        className={`rounded-control border-2 px-2 py-1 text-xs font-bold ${
          view ? "border-board bg-board/40 text-ink" : "border-deep-navy bg-white text-deep-navy"
        } ${pending ? "cursor-wait opacity-70" : ""}`}
      >
        {view ? "Unfollow" : "Follow"}
        <span className="sr-only"> {label}</span>
      </button>
      <span role="status" aria-live="polite" className="text-xs text-dark-red empty:hidden">
        {message}
      </span>
    </span>
  );
}
