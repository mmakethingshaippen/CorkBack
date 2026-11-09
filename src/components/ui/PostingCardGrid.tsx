import { PostingCard } from "./PostingCard";
import { tiltFor } from "./Card";
import type { Posting } from "@/lib/types";

/**
 * A list of tilted posting cards. Rotation lifts a card's corners by about
 * (width x sin(tilt)) / 2, so a full-width desktop card would rise over the
 * content above it. Responsive columns keep each card narrow (about 400 px or
 * less) so the lift stays within the spacing at every viewport width.
 */
export function PostingCardGrid({ postings }: { postings: Posting[] }) {
  let prev: number | null = null;
  const cards = postings.map((p) => {
    const entry = { posting: p, prevTilt: prev };
    prev = tiltFor(p.id, prev);
    return entry;
  });
  return (
    <div className="grid gap-x-6 gap-y-6 pt-2 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(({ posting, prevTilt }) => (
        <PostingCard key={posting.id} posting={posting} tiltId={posting.id} prevTilt={prevTilt} />
      ))}
    </div>
  );
}
