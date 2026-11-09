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
import { getPosting, getProfileByUsername } from "@/lib/postings";
import { isFollowing } from "@/lib/follows";
import { FollowButton } from "@/components/ui/FollowButton";
import { getViewer } from "@/lib/auth";
import { MessagePoster } from "@/components/ui/MessagePoster";
import { PromoteToggle } from "@/components/ui/PromoteToggle";
import { ShareButton } from "@/components/ui/ShareButton";
import { isPostingActive } from "@/lib/lifecycle";
import { createClient } from "@/lib/supabase/server";
import { getFriendPlans, getViewerReaction } from "@/lib/reactions";
import { isUuid } from "@/lib/reactionState";
import type { PlanKind } from "@/lib/types";

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
  const active = isPostingActive(posting);

  // The viewer's own like/plan and friends' plans come from server reads (RLS
  // decides visibility), so the page shows saved state after refresh/sign-in.
  let mine: { liked: boolean; plan: PlanKind | null } = { liked: false, plan: null };
  let friendPlans: { username: string; kind: PlanKind }[] = [];
  let followingAuthor = false;
  if (viewer && isUuid(posting.id)) {
    const supabase = await createClient();
    const author = isOwnPosting ? null : await getProfileByUsername(posting.authorUsername);
    [mine, friendPlans, followingAuthor] = await Promise.all([
      getViewerReaction(supabase, posting.id, viewer.id),
      active ? getFriendPlans(supabase, posting.id, viewer.id) : Promise.resolve([]),
      author ? isFollowing(supabase, viewer.id, author.id) : Promise.resolve(false),
    ]);
  }

  // event_date is a calendar date: format it without shifting time zones.
  const formatDate = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const dateLabel = posting.eventDate ? formatDate(posting.eventDate) : null;
  const endParts: string[] = [];
  if (posting.endDate && posting.endDate !== posting.eventDate) endParts.push(formatDate(posting.endDate));
  if (posting.endTime) endParts.push(`${endParts.length ? "at " : ""}${posting.endTime.slice(0, 5)}`);
  const endLabel = endParts.length ? `Ends ${endParts.join(" ")}` : null;

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />

      <article className="space-y-4 px-4">
        {!active ? (
          <div role="status" className="rounded-card border-2 border-board bg-board/40 p-4">
            <p className="font-bold text-ink">This posting has ended</p>
            <p className="mt-1 text-sm text-ink/70">
              It is no longer on the map. Details and final counts are kept here. Likes and plans are
              closed, and you can still message the poster.
            </p>
          </div>
        ) : null}

        {posting.isPromoted && active ? (
          <p className="text-xs font-bold uppercase tracking-wide text-ink/50">Promoted</p>
        ) : null}

        <div className="flex items-center justify-between">
          <CategoryChip label={categoryLabel(posting.categorySlug)} as="span" />
          <span className="text-sm">
            <ShareButton title={posting.title} variant="link" />
          </span>
        </div>

        <h1 className="text-3xl font-bold leading-tight text-ink">{posting.title}</h1>

        {/* Flyer image, shown only when the posting has one. */}
        {posting.flyerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={posting.flyerUrl}
            alt={`Flyer for ${posting.title}`}
            className="w-full rounded-card border border-board"
          />
        ) : null}

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
          {endLabel ? (
            <div className="flex items-center gap-2">
              <ClockIcon className="text-ink/60" /> <dd>{endLabel}</dd>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <MapPinIcon className="text-ink/60" /> <dd>{posting.placeLabel}</dd>
          </div>
        </dl>

        <p className="whitespace-pre-line leading-relaxed text-ink">{posting.body}</p>

        {posting.rsvpUrl && active ? (
          <a
            href={posting.rsvpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-control bg-dark-red px-5 py-3 font-bold text-white"
          >
            RSVP <ExternalLinkIcon />
          </a>
        ) : null}

        <PostingActions
          postingId={posting.id}
          signedIn={signedIn}
          ended={!active}
          initial={{
            ...mine,
            counts: { likes: posting.likeCount, going: posting.goingCount, interested: posting.interestedCount },
          }}
          friendPlans={friendPlans}
        />

        <div className="rounded-card border border-board bg-board/30 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-ink/70">Posted by</span>
            <NavyLink href={`/u/${posting.authorUsername}`}>View profile</NavyLink>
          </div>
          <div className="mt-1">
            <PosterHandle username={posting.authorUsername} />
          </div>
          <div className="mt-3">
            <FollowButton
              username={posting.authorUsername}
              initialFollowing={followingAuthor}
              signedIn={signedIn}
              isSelf={isOwnPosting}
            />
          </div>
          <div className="mt-3">
            <MessagePoster
              posterUsername={posting.authorUsername}
              postingId={posting.id}
              signedIn={signedIn}
              isOwnPosting={isOwnPosting}
            />
          </div>
          {/* Owner-only promotion control. */}
          {isOwnPosting && active ? (
            <div className="mt-3">
              <PromoteToggle postingId={posting.id} initialPromoted={posting.isPromoted} />
            </div>
          ) : null}
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
