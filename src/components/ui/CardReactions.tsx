"use client";

import { HeartIcon } from "@/components/icons";
import { NavyLink } from "./actions";
import { countLabel, likeButtonLabel, planButtonLabel } from "@/lib/reactionState";
import { useCardReactions } from "./useCardReactions";
import type { PlanKind, ReactionCounts } from "@/lib/types";

const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy focus-visible:ring-offset-1";

/**
 * Like / Going / Interested controls in a posting card's footer. They sit
 * beside (never inside) the card's title and author links, so pressing one
 * never opens the posting, whether by pointer or by keyboard (they are real
 * buttons: Enter and Space activate them, Tab reaches them).
 * - Signed in: three toggle buttons with aria-pressed and an accessible name
 *   that includes the total; each at least 44 px tall. Going and Interested are
 *   exclusive; tapping the selected one clears it.
 * - Signed out: the public totals and a "Sign in to react" link.
 * Card lists only show active postings; if one ends or becomes unavailable
 * while the page is open, the server refuses and the controls close.
 */
export function CardReactions({
  postingId,
  counts,
  liked,
  plan,
  signedIn,
  stateAt,
}: {
  postingId: string;
  counts: ReactionCounts;
  liked: boolean;
  plan: PlanKind | null;
  signedIn: boolean;
  stateAt?: string;
}) {
  if (!signedIn) {
    return (
      <div className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1 text-ink/60" role="img" aria-label={countLabel(counts.likes, "like", "likes")}>
          <HeartIcon aria-hidden="true" /> {counts.likes}
        </span>
        <span className="text-ink/60">{counts.going} going</span>
        <span className="text-ink/60">{counts.interested} interested</span>
        <NavyLink href="/sign-in" className="inline-flex min-h-[44px] items-center px-1">
          Sign in to react
        </NavyLink>
      </div>
    );
  }
  return <SignedInReactions postingId={postingId} counts={counts} liked={liked} plan={plan} stateAt={stateAt} />;
}

function SignedInReactions({
  postingId,
  counts,
  liked,
  plan,
  stateAt,
}: {
  postingId: string;
  counts: ReactionCounts;
  liked: boolean;
  plan: PlanKind | null;
  stateAt?: string;
}) {
  const { view, pending, message, closed, toggleLike, choosePlan } = useCardReactions(
    postingId,
    { liked, plan, counts },
    stateAt,
  );
  const state = `${pending ? "cursor-wait opacity-70" : ""} ${closed ? "cursor-not-allowed opacity-60" : ""}`;
  const base = `inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-control border px-3 text-sm ${FOCUS} ${state}`;

  const planButton = (kind: PlanKind, label: string) => {
    const selected = view.plan === kind;
    const n = kind === "going" ? view.counts.going : view.counts.interested;
    return (
      <button
        type="button"
        onClick={() => choosePlan(kind)}
        aria-pressed={selected}
        aria-disabled={pending || closed}
        aria-label={planButtonLabel(kind, selected, n)}
        className={`${base} ${selected ? "border-deep-navy bg-deep-navy font-bold text-white" : "border-board text-ink/70"}`}
      >
        <span aria-hidden="true">
          {label} {n}
        </span>
      </button>
    );
  };

  return (
    <div className="min-w-0" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Your reactions to this posting">
        <button
          type="button"
          onClick={toggleLike}
          aria-pressed={view.liked}
          aria-disabled={pending || closed}
          aria-label={likeButtonLabel(view.liked, view.counts.likes)}
          className={`${base} ${view.liked ? "border-dark-red text-dark-red" : "border-board text-ink/70"}`}
        >
          <HeartIcon aria-hidden="true" fill={view.liked ? "currentColor" : "none"} />
          <span aria-hidden="true">{view.counts.likes}</span>
        </button>
        {planButton("going", "Going")}
        {planButton("interested", "Interested")}
      </div>
      {message ? (
        <p role="alert" className="mt-1 text-xs text-dark-red">
          {message}
        </p>
      ) : null}
    </div>
  );
}
