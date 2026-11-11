"use client";

import { HeartIcon } from "@/components/icons";
import { NavyLink } from "./actions";
import { countLabel, likeButtonLabel } from "@/lib/reactionState";
import { useLike } from "./useLike";

/**
 * Like control in a posting card's footer. It sits beside (never inside) the
 * card's title and author links, so pressing it never opens the posting.
 * - Signed in: a toggle button (filled heart when liked, aria-pressed, the
 *   approved "Like/Unlike this posting. N likes" name), at least 44 px tall.
 * - Signed out: the public total and a "Sign in to like" link.
 * Card lists only show active postings; if one ends or becomes unavailable
 * while the page is open, the server refuses and the control closes.
 */
export function CardLike({
  postingId,
  likes,
  liked,
  signedIn,
  stateAt,
}: {
  postingId: string;
  likes: number;
  liked: boolean;
  signedIn: boolean;
  stateAt?: string;
}) {
  if (!signedIn) {
    return (
      <span className="flex min-h-[44px] items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1 text-ink/60" role="img" aria-label={countLabel(likes, "like", "likes")}>
          <HeartIcon aria-hidden="true" /> {likes}
        </span>
        <NavyLink href="/sign-in" className="inline-flex min-h-[44px] items-center px-1">
          Sign in to like
        </NavyLink>
      </span>
    );
  }
  return <SignedInLike postingId={postingId} likes={likes} liked={liked} stateAt={stateAt} />;
}

function SignedInLike({ postingId, likes, liked, stateAt }: { postingId: string; likes: number; liked: boolean; stateAt?: string }) {
  const { view, pending, message, closed, toggle } = useLike(postingId, { liked, likes }, stateAt);
  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={view.liked}
        aria-disabled={pending || closed}
        aria-label={likeButtonLabel(view.liked, view.likes)}
        className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-control border px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy ${
          view.liked ? "border-dark-red text-dark-red" : "border-board text-ink/70"
        } ${pending ? "cursor-wait opacity-70" : ""} ${closed ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <HeartIcon aria-hidden="true" fill={view.liked ? "currentColor" : "none"} />
        <span aria-hidden="true">{view.likes}</span>
      </button>
      {message ? (
        <span role="alert" className="mt-1 max-w-[14rem] text-right text-xs text-dark-red">
          {message}
        </span>
      ) : null}
    </span>
  );
}
