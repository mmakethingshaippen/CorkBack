import Link from "next/link";
import { Card } from "./Card";
import { CategoryChip } from "./CategoryChip";
import { PosterHandle } from "./PosterHandle";
import { HeartIcon } from "@/components/icons";
import { categoryLabel } from "@/lib/categories";
import type { Posting } from "@/lib/types";

/** A posting summary card for the home rails. Tilt comes from Choice B via Card. */
export function PostingCard({
  posting,
  tiltId,
  prevTilt = null,
}: {
  posting: Posting;
  tiltId: string;
  prevTilt?: number | null;
}) {
  // event_date is a calendar date: format it without shifting time zones.
  const dateLabel = posting.eventDate
    ? new Date(`${posting.eventDate}T00:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
      })
    : null;
  const likeText = `${posting.likeCount} ${posting.likeCount === 1 ? "like" : "likes"}`;

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
      <div className="mt-3 flex items-center justify-between text-sm">
        <PosterHandle username={posting.authorUsername} />
        <span className="inline-flex items-center gap-1 text-ink/60" aria-label={likeText} role="img">
          <HeartIcon /> {posting.likeCount}
        </span>
      </div>
    </Card>
  );
}
