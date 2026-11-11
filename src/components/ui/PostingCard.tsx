import Link from "next/link";
import { Card } from "./Card";
import { CategoryChip } from "./CategoryChip";
import { PosterHandle } from "./PosterHandle";
import { CardLike } from "./CardLike";
import { OwnerControls } from "./OwnerControls";
import { categoryLabel } from "@/lib/categories";
import type { Posting } from "@/lib/types";

/**
 * A posting summary card (home rail, Following, profiles). Tilt comes from
 * Choice B via Card. The card itself is not a link: the title and the author
 * handle are links, and the Like control is a separate button beside them.
 */
export function PostingCard({
  posting,
  tiltId,
  prevTilt = null,
  signedIn = false,
  isOwner = false,
}: {
  posting: Posting;
  tiltId: string;
  prevTilt?: number | null;
  signedIn?: boolean;
  /** The viewer is this posting's author: show Edit and Delete (own profile only). */
  isOwner?: boolean;
}) {
  // event_date is a calendar date: format it without shifting time zones.
  const dateLabel = posting.eventDate
    ? new Date(`${posting.eventDate}T00:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
      })
    : null;
  return (
    <Card tiltId={tiltId} prevTilt={prevTilt}>
      <div className="mb-2 flex items-center justify-between">
        <CategoryChip label={categoryLabel(posting.categorySlug)} as="span" />
        {posting.isPromoted ? (
          <span className="text-xs font-bold uppercase tracking-wide text-ink/50">Promoted</span>
        ) : null}
      </div>
      <Link href={`/p/${posting.id}`} className="block">
        <h3 className="break-words text-lg font-bold leading-tight text-ink">{posting.title}</h3>
      </Link>
      <p className="mt-1 break-words text-sm text-ink/70">
        {dateLabel ? `${dateLabel} · ` : ""}
        {posting.placeLabel}
      </p>
      <div className="mt-3 flex items-start justify-between gap-2 text-sm">
        <span className="flex min-h-[44px] items-center">
          <PosterHandle username={posting.authorUsername} />
        </span>
        <CardLike
          postingId={posting.id}
          likes={posting.likeCount}
          liked={posting.viewerLiked ?? false}
          signedIn={signedIn}
          stateAt={posting.viewerStateAt}
        />
      </div>
      {isOwner ? (
        <OwnerControls postingId={posting.id} title={posting.title} canEdit variant="card" after={{ kind: "refresh" }} />
      ) : null}
    </Card>
  );
}
