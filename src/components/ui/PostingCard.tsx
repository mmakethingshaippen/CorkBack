import Link from "next/link";
import { Card } from "./Card";
import { CategoryChip } from "./CategoryChip";
import { PosterHandle } from "./PosterHandle";
import { CardReactions } from "./CardReactions";
import { OwnerControls } from "./OwnerControls";
import { categoryLabel } from "@/lib/categories";
import type { Posting } from "@/lib/types";

/**
 * A posting summary card (home rail, Following, profiles). Tilt comes from
 * Choice B via Card. The title link is stretched over the card so any open
 * area opens the posting. The author handle, the Like / Going / Interested
 * buttons and owner controls sit above it (z-10) as separate controls, so
 * pressing them never opens the posting. Share, Follow, Message and Report
 * live on the full posting page.
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
    <Card tiltId={tiltId} prevTilt={prevTilt} className="relative">
      <div className="mb-2 flex items-center justify-between">
        <CategoryChip label={categoryLabel(posting.categorySlug)} as="span" />
        {posting.isPromoted ? (
          <span className="text-xs font-bold uppercase tracking-wide text-ink/50">Promoted</span>
        ) : null}
      </div>
      <Link
        href={`/p/${posting.id}`}
        className="block rounded-control after:absolute after:inset-0 after:content-[''] focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy"
      >
        <h3 className="break-words text-lg font-bold leading-tight text-ink">{posting.title}</h3>
      </Link>
      <p className="mt-1 break-words text-sm text-ink/70">
        {dateLabel ? `${dateLabel} · ` : ""}
        {posting.placeLabel}
      </p>
      <div className="relative z-10 mt-3 text-sm">
        <span className="flex min-h-[44px] items-center">
          <PosterHandle username={posting.authorUsername} avatarPath={posting.authorAvatarPath ?? null} />
        </span>
        <CardReactions
          postingId={posting.id}
          counts={{ likes: posting.likeCount, going: posting.goingCount, interested: posting.interestedCount }}
          liked={posting.viewerLiked ?? false}
          plan={posting.viewerPlan ?? null}
          signedIn={signedIn}
          stateAt={posting.viewerStateAt}
        />
      </div>
      {isOwner ? (
        <div className="relative z-10">
          <OwnerControls postingId={posting.id} title={posting.title} canEdit variant="card" after={{ kind: "refresh" }} />
        </div>
      ) : null}
    </Card>
  );
}

