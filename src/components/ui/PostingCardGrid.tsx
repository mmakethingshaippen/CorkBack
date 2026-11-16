import { PostingCard } from "./PostingCard";
import { tiltFor } from "./Card";
import type { Posting } from "@/lib/types";

/**
 * A list of tilted posting cards (home rail, profiles, Following). Vertical
 * clearance for the rotated corners comes from Card (it scales with each
 * card's width and tilt). Responsive columns keep cards about 400 px wide on
 * desktop, and the wider column gap clears the sideways swing of the corners.
 */
export function PostingCardGrid({
  postings,
  signedIn = false,
  ownerView = false,
  distanceLabels,
}: {
  postings: Posting[];
  signedIn?: boolean;
  /** Every posting here is the viewer's own (their profile): cards get Edit and Delete. */
  ownerView?: boolean;
  /** Optional pre-formatted distance labels keyed by posting id (nearby list only). */
  distanceLabels?: Record<string, string>;
}) {
  let prev: number | null = null;
  const cards = postings.map((p) => {
    const entry = { posting: p, prevTilt: prev };
    prev = tiltFor(p.id, prev);
    return entry;
  });
  return (
    <div className="grid gap-x-10 gap-y-4 pt-2 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(({ posting, prevTilt }) => (
        <PostingCard key={posting.id} posting={posting} tiltId={posting.id} prevTilt={prevTilt} signedIn={signedIn} isOwner={ownerView} distanceLabel={distanceLabels?.[posting.id]} />
      ))}
    </div>
  );
}
