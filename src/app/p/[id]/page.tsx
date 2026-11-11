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
import { OwnerControls } from "@/components/ui/OwnerControls";
import { ReportPosting } from "@/components/ui/ReportPosting";
import { Replies } from "@/components/ui/Replies";
import { CorkBand } from "@/components/ui/CorkBand";
import { getHiddenNotice, hasPendingReport, listReplies } from "@/lib/moderationData";
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
  if (!posting) {
    // Deleted and hidden postings read as not found for everyone. The one exception is the AUTHOR of a
    // posting moderators hid: they are told, given the stated reason, and can still delete it.
    if (viewer && isUuid(id)) {
      const notice = await getHiddenNotice(await createClient(), id);
      if (notice) return <HiddenByModerators id={id} reason={notice.reason} username={viewer.username ?? ""} />;
    }
    notFound();
  }
  const signedIn = viewer !== null;
  const isOwnPosting = viewer?.username === posting.authorUsername;
  const active = isPostingActive(posting);

  // The viewer's own like/plan and friends' plans come from server reads (RLS
  // decides visibility), so the page shows saved state after refresh/sign-in.
  const stateAt = new Date().toISOString(); // server read time, for card/detail like consistency
  let mine: { liked: boolean; plan: PlanKind | null } = { liked: false, plan: null };
  let friendPlans: { username: string; kind: PlanKind }[] = [];
  let followingAuthor = false;
  let alreadyReported = false;
  if (viewer && isUuid(posting.id)) {
    const supabase = await createClient();
    const author = isOwnPosting ? null : await getProfileByUsername(posting.authorUsername);
    [mine, friendPlans, followingAuthor, alreadyReported] = await Promise.all([
      getViewerReaction(supabase, posting.id, viewer.id),
      active ? getFriendPlans(supabase, posting.id, viewer.id) : Promise.resolve([]),
      author ? isFollowing(supabase, viewer.id, author.id) : Promise.resolve(false),
      isOwnPosting ? Promise.resolve(false) : hasPendingReport(supabase, posting.id, viewer.id),
    ]);
  }
  // Public replies (RLS: readable on visible postings, active or ended).
  const replies = isUuid(posting.id) ? await listReplies(await createClient(), posting.id) : [];

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
          stateAt={stateAt}
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
          {/* Owner-only controls: promote, edit, delete. */}
          {isOwnPosting && isUuid(posting.id) ? (
            <>
              {active ? (
                <div className="mt-3">
                  <PromoteToggle postingId={posting.id} initialPromoted={posting.isPromoted} />
                </div>
              ) : null}
              <div className="mt-3">
                <OwnerControls
                  postingId={posting.id}
                  title={posting.title}
                  canEdit={active}
                  variant="page"
                  after={{ kind: "profile", username: posting.authorUsername }}
                />
              </div>
            </>
          ) : null}
        </div>

        {/* Report: signed-in non-authors; signed-out visitors get a sign-in prompt. The author never sees it. */}
        {!isOwnPosting && isUuid(posting.id) ? (
          <ReportPosting postingId={posting.id} signedIn={signedIn} initiallyReported={alreadyReported} />
        ) : null}

        {/* Replies: public comments. No like on replies (locked). */}
        <Replies
          postingId={posting.id}
          initial={replies}
          signedIn={signedIn}
          viewerId={viewer?.id ?? null}
          open={active}
        />

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

/**
 * Shown ONLY to the author of a posting that moderators hid: what happened, the
 * moderator's stated reason, and a way to delete it. It never shows reporters or
 * report details. Everyone else gets the neutral not-found page.
 */
function HiddenByModerators({ id, reason, username }: { id: string; reason: string | null; username: string }) {
  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="mx-auto max-w-xl space-y-4 px-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Hidden by CorkBack moderators</h1>
        </CorkBand>
        <div role="status" className="rounded-card border-2 border-board bg-board/40 p-4">
          <p className="font-bold text-ink">This posting is hidden from the board.</p>
          <p className="mt-1 text-sm text-ink/80">
            CorkBack moderators hid it, so nobody else can see it, and likes, plans, replies and new messages are closed.
          </p>
          <p className="mt-2 text-sm text-ink">
            <span className="font-bold">Reason from the moderators:</span> {reason ?? "No reason was recorded."}
          </p>
        </div>
        <OwnerControls postingId={id} title="your hidden posting" canEdit={false} variant="page" after={{ kind: "profile", username }} />
      </div>
      <BottomNav />
    </main>
  );
}
