"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NavyLink } from "./actions";

/**
 * Follow / Unfollow a poster. One-way: it adds their active postings to your
 * Following feed and never makes you friends (Connect is separate).
 * - Initial state comes from a server read, so it survives refresh/sign-in.
 * - The click updates immediately; extra clicks are ignored while a save is in
 *   flight; a failed save rolls back with a message.
 * - Hidden on your own profile/postings (no self-follow).
 */
export function FollowButton({
  username,
  initialFollowing,
  signedIn,
  isSelf,
}: {
  username: string;
  initialFollowing: boolean;
  signedIn: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialFollowing);
  const [view, setView] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  if (isSelf) return null;

  if (!signedIn) {
    return (
      <p className="text-sm text-ink/70">
        <NavyLink href="/sign-in">Sign in</NavyLink> to follow @{username}.
      </p>
    );
  }

  async function toggle() {
    if (inFlight.current) return;
    inFlight.current = true;
    const next = !view;
    setPending(true);
    setMessage(null);
    setView(next);
    try {
      const res = await fetch(`/api/follows/${encodeURIComponent(username)}`, {
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
    <div className="space-y-1" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-disabled={pending}
          className={`inline-flex items-center gap-1 rounded-control border-2 px-5 py-2 font-bold ${
            view ? "border-board bg-board/40 text-ink" : "border-deep-navy bg-white text-deep-navy"
          } ${pending ? "cursor-wait opacity-70" : ""}`}
        >
          {view ? "Unfollow" : "Follow"}
          <span className="sr-only"> @{username}</span>
        </button>
        {view ? <span className="text-sm font-bold text-ink">You follow @{username}</span> : null}
      </div>
      <p className="text-xs text-ink/60">
        Following adds their active postings to your Following page. It&apos;s one-way and doesn&apos;t make you friends.
      </p>
      <p role="status" aria-live="polite" className="min-h-[1rem] text-sm text-ink/70">
        {pending ? "Saving…" : message}
      </p>
    </div>
  );
}
