import { notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { PosterHandle } from "@/components/ui/PosterHandle";
import { PostingActions } from "@/components/ui/PostingActions";
import { NavyLink } from "@/components/ui/actions";
import { CalendarIcon, ClockIcon, MapPinIcon, ExternalLinkIcon } from "@/components/icons";
import { categoryLabel } from "@/lib/categories";
import { getPosting } from "@/lib/postings";
import { getViewer } from "@/lib/auth";
import { MessagePoster } from "@/components/ui/MessagePoster";

export default async function PostingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [posting, viewer] = await Promise.all([getPosting(id), getViewer()]);
  if (!posting) notFound();
  const signedIn = viewer !== null;
  const isOwnPosting = viewer?.username === posting.authorUsername;

  const dateLabel = posting.eventDate
    ? new Date(posting.eventDate).toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />

      <article className="space-y-4 px-4">
        {posting.isPromoted ? (
          <p className="text-xs font-bold uppercase tracking-wide text-ink/50">Promoted</p>
        ) : null}

        <div className="flex items-center justify-between">
          <CategoryChip label={categoryLabel(posting.categorySlug)} as="span" />
          <span className="inline-flex items-center gap-3 text-sm text-deep-navy">
            <span className="inline-flex items-center gap-1">Share</span>
            <span className="inline-flex items-center gap-1">Report</span>
          </span>
        </div>

        <h1 className="text-3xl font-bold leading-tight text-ink">{posting.title}</h1>

        <dl className="space-y-1 text-ink">
          {dateLabel ? (
            <div className="flex items-center gap-2">
              <CalendarIcon className="text-ink/60" /> <dd>{dateLabel}</dd>
            </div>
          ) : null}
          {posting.eventTime ? (
            <div className="flex items-center gap-2">
              <ClockIcon className="text-ink/60" /> <dd>{posting.eventTime}</dd>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <MapPinIcon className="text-ink/60" /> <dd>{posting.placeLabel}</dd>
          </div>
        </dl>

        <p className="whitespace-pre-line leading-relaxed text-ink">{posting.body}</p>

        {posting.rsvpUrl ? (
          <a
            href={posting.rsvpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-control bg-dark-red px-5 py-3 font-bold text-white"
          >
            RSVP <ExternalLinkIcon />
          </a>
        ) : null}

        <PostingActions likeCount={posting.likeCount} signedIn={signedIn} />

        <div className="rounded-card border border-board bg-board/30 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-ink/70">Posted by</span>
            <NavyLink href={`/u/${posting.authorUsername}`}>View profile</NavyLink>
          </div>
          <div className="mt-1">
            <PosterHandle username={posting.authorUsername} />
          </div>
          <p className="mt-2 text-sm text-ink/70">
            Follow is instant and one-way. Connect sends a friend request. (Social features ship in a later stage.)
          </p>
          <div className="mt-3">
            <MessagePoster
              posterUsername={posting.authorUsername}
              postingId={posting.id}
              signedIn={signedIn}
              isOwnPosting={isOwnPosting}
            />
          </div>
        </div>

        {/* Replies: public comments. No like on replies (locked). */}
        <section>
          <h2 className="mb-2 text-lg font-bold text-ink">Replies</h2>
          {signedIn ? (
            <p className="text-sm text-ink/60">Be the first to reply.</p>
          ) : (
            <p className="text-sm text-ink/60">
              <NavyLink href="/sign-in">Sign in</NavyLink> to reply. Replies are public comments on this posting.
            </p>
          )}
        </section>

        <p className="pt-2 text-center text-xs text-ink/50">
          <Link href="/" className="text-deep-navy">
            Browse more on the map
          </Link>
        </p>
      </article>

      <BottomNav />
    </main>
  );
}
