"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HeartIcon } from "@/components/icons";
import { SignInToTakePart } from "./SignInToTakePart";
import { ShareButton } from "./ShareButton";
import { PosterHandle } from "./PosterHandle";
import { applyLike, applyPlan, countLabel, likeButtonLabel, likeErrorMessage, nextPlan } from "@/lib/reactionState";
import { initialLike, initialPlan, setConfirmedLike, setConfirmedPlan } from "@/lib/likeStore";
import type { PlanKind, ReactionCounts } from "@/lib/types";

interface Snapshot {
  liked: boolean;
  plan: PlanKind | null;
  counts: ReactionCounts;
}

/**
 * Like + plan + share controls for a posting page.
 * - Like is for POSTINGS ONLY (locked). No like on replies anywhere.
 * - Going / Interested are mutually exclusive attendance plans.
 * - State is saved on the server; the initial values come from a server read,
 *   so they survive refresh and re-sign-in.
 * - Clicks update the view immediately; while a save is in flight further
 *   clicks are ignored, and a failed save rolls back to the last saved state.
 * - Ended postings show final counts only (the server also rejects changes).
 */
export function PostingActions({
  postingId,
  signedIn,
  ended,
  initial,
  friendPlans = [],
  stateAt,
}: {
  postingId: string;
  signedIn: boolean;
  ended: boolean;
  initial: Snapshot;
  friendPlans?: { username: string; kind: PlanKind }[];
  /** Server time this state was read (ISO); see src/lib/likeStore.ts. */
  stateAt?: string;
}) {
  const router = useRouter();
  // A like confirmed in this tab (e.g. from a card) wins over an older cached render.
  const [start] = useState<Snapshot>(() => {
    const l = initialLike(postingId, { liked: initial.liked, likes: initial.counts.likes }, stateAt);
    const p = initialPlan(
      postingId,
      { plan: initial.plan, going: initial.counts.going, interested: initial.counts.interested },
      stateAt,
    );
    return {
      liked: l.liked,
      plan: p.plan,
      counts: { likes: l.likes, going: p.going, interested: p.interested },
    };
  });
  const [saved, setSaved] = useState<Snapshot>(start);
  const [view, setView] = useState<Snapshot>(start);
  const [pending, setPending] = useState<"like" | "plan" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [closed, setClosed] = useState(ended);
  const inFlight = useRef(false);

  const { counts } = view;
  const likeText = countLabel(counts.likes, "like", "likes");
  const goingText = countLabel(counts.going, "going", "going");
  const interestedText = countLabel(counts.interested, "interested", "interested");

  if (closed) {
    return (
      <div className="space-y-3">
        <p className="text-ink">
          <span className="font-bold">Final count:</span> {likeText} · {goingText} · {interestedText}
        </p>
        <ShareButton variant="button" />
        {message ? (
          <p role="status" className="text-sm text-ink/70">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-4 text-ink/70">
          <span className="inline-flex items-center gap-1">
            <HeartIcon /> <span>{likeText}</span>
          </span>
          <span>{goingText}</span>
          <span>{interestedText}</span>
        </div>
        <ShareButton variant="button" />
        <SignInToTakePart action="like, reply, and set plans" />
      </div>
    );
  }

  async function save(kind: "like" | "plan", next: Snapshot, body: unknown) {
    if (inFlight.current) return; // a save is already in flight: ignore extra clicks
    inFlight.current = true;
    setPending(kind);
    setMessage(null);
    setView(next); // immediate feedback
    try {
      const res = await fetch(`/api/postings/${postingId}/${kind}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<Snapshot> & { at?: string; error?: string; code?: string };
      if (!res.ok) {
        setView(saved); // roll back to the last saved state
        if (data.code === "ended") {
          setClosed(true);
          router.refresh();
        }
        setMessage(likeErrorMessage(data.code, data.error));
        return;
      }
      const confirmed: Snapshot = {
        liked: Boolean(data.liked),
        plan: (data.plan as PlanKind | null) ?? null,
        counts: data.counts ?? next.counts,
      };
      setSaved(confirmed);
      setView(confirmed);
      setConfirmedLike(postingId, { liked: confirmed.liked, likes: confirmed.counts.likes }, data.at);
      setConfirmedPlan(
        postingId,
        { plan: confirmed.plan, going: confirmed.counts.going, interested: confirmed.counts.interested },
        data.at,
      );
    } catch {
      setView(saved);
      setMessage("Could not reach CorkBack. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  function toggleLike() {
    const liked = !view.liked;
    save("like", { ...view, liked, counts: applyLike(view.counts, view.liked, liked) }, { liked });
  }

  function choosePlan(clicked: PlanKind) {
    const plan = nextPlan(view.plan, clicked);
    save("plan", { ...view, plan, counts: applyPlan(view.counts, view.plan, plan) }, { kind: plan });
  }

  const busy = pending !== null;
  const friendsGoing = friendPlans.filter((f) => f.kind === "going");
  const friendsInterested = friendPlans.filter((f) => f.kind === "interested");

  const planButton = (kind: PlanKind, label: string, text: string) => {
    const selected = view.plan === kind;
    return (
      <button
        type="button"
        onClick={() => choosePlan(kind)}
        aria-pressed={selected}
        aria-disabled={busy}
        aria-label={`${label}. ${text}`}
        className={`flex-1 rounded-control px-4 py-2 font-bold ${
          selected ? "bg-deep-navy text-white" : "border border-board text-ink"
        } ${busy ? "cursor-wait opacity-70" : ""}`}
      >
        {label} <span className="font-normal">· {kind === "going" ? counts.going : counts.interested}</span>
      </button>
    );
  };

  return (
    <div className="space-y-3" aria-busy={busy}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={view.liked}
          aria-disabled={busy}
          aria-label={likeButtonLabel(view.liked, counts.likes)}
          className={`inline-flex min-h-[44px] items-center gap-1 rounded-control border px-3 py-2 ${
            view.liked ? "border-dark-red text-dark-red" : "border-board text-ink"
          } ${busy ? "cursor-wait opacity-70" : ""}`}
        >
          <HeartIcon aria-hidden="true" fill={view.liked ? "currentColor" : "none"} /> <span>{view.liked ? "Liked" : "Like"}</span>
          <span className="text-ink/70">· {counts.likes}</span>
        </button>
        <ShareButton variant="button" />
      </div>
      <p className="text-xs text-ink/60">Your likes are private. Others see only the total.</p>

      <div>
        <p className="mb-1 text-sm font-bold text-ink" id={`plans-${postingId}`}>
          Your plans: choose one
        </p>
        <div className="flex gap-3" role="group" aria-labelledby={`plans-${postingId}`}>
          {planButton("going", "Going", goingText)}
          {planButton("interested", "Interested", interestedText)}
        </div>
        <p className="mt-1 text-xs text-ink/60">
          Tap your choice again to clear it. Your friends can see your plan while this posting is active;
          everyone else sees only the totals.
        </p>
      </div>

      {friendsGoing.length || friendsInterested.length ? (
        <div className="rounded-card border border-board p-3 text-sm">
          <p className="font-bold text-ink">Friends</p>
          {friendsGoing.length ? (
            <p className="mt-1 text-ink/80">
              Going:{" "}
              {friendsGoing.map((f, i) => (
                <span key={f.username}>
                  {i ? ", " : ""}
                  <PosterHandle username={f.username} />
                </span>
              ))}
            </p>
          ) : null}
          {friendsInterested.length ? (
            <p className="mt-1 text-ink/80">
              Interested:{" "}
              {friendsInterested.map((f, i) => (
                <span key={f.username}>
                  {i ? ", " : ""}
                  <PosterHandle username={f.username} />
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-ink/70">
        {busy ? "Saving…" : message}
      </p>
    </div>
  );
}
