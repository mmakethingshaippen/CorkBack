import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";
import { PosterHandle } from "@/components/ui/PosterHandle";
import { SignInToTakePart } from "@/components/ui/SignInToTakePart";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listConnections, listFriendActivity, type FriendActivity, type PersonEntry } from "@/lib/connections";
import { FriendsManager } from "./FriendsManager";

/**
 * Friends: search, requests in both directions, accepted friends, and friends'
 * Going/Interested on active postings. Friendship is two-way and independent of
 * Follow. Only usernames and public posting details are shown here.
 * Loading state: app/friends/loading.tsx.
 */
export const dynamic = "force-dynamic";

const fmt = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }) : null;

export default async function FriendsPage() {
  const viewer = await getViewer();
  let lists: { incoming: PersonEntry[]; outgoing: PersonEntry[]; friends: PersonEntry[] } | null = null;
  let activity: FriendActivity[] = [];
  let loadError: string | null = null;
  if (viewer) {
    try {
      const supabase = await createClient();
      const [c, a] = await Promise.all([listConnections(supabase, viewer.id), listFriendActivity(supabase, viewer.id)]);
      lists = c;
      activity = a;
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Could not load your friends.";
    }
  }

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Friends</h1>
          <p className="mt-1 text-paper/90">
            Friends see each other&apos;s Going and Interested on active postings. Everyone else sees only the totals.
            Friendship is separate from Follow.
          </p>
        </CorkBand>

        {!viewer ? (
          <SignInToTakePart action="add friends and see their plans" />
        ) : loadError ? (
          <div role="alert" className="rounded-card border-2 border-dark-red bg-white p-4">
            <p className="font-bold text-ink">Your friends couldn&apos;t load.</p>
            <p className="mt-1 text-sm text-ink/70">{loadError}</p>
            <Link href="/friends" className="mt-3 inline-block font-bold text-deep-navy underline-offset-2 hover:underline">
              Try again
            </Link>
          </div>
        ) : lists ? (
          <>
            <FriendsManager incoming={lists.incoming} outgoing={lists.outgoing} friends={lists.friends} />

            <section aria-labelledby="friends-activity" className="rounded-card border border-board bg-white p-4">
              <h2 id="friends-activity" className="text-lg font-bold text-ink">Friends&apos; plans</h2>
              <p className="text-xs text-ink/60">
                Going and Interested from your friends on postings that are still active. Only usernames, plans, and
                each posting&apos;s public title, date, and place are shown.
              </p>
              {lists.friends.length === 0 ? (
                <p className="mt-2 text-sm text-ink/60">When you have friends, their plans on active postings appear here.</p>
              ) : activity.length === 0 ? (
                <p className="mt-2 text-sm text-ink/60">Your friends have no plans on active postings right now.</p>
              ) : (
                <ul className="mt-2 divide-y divide-board">
                  {activity.map((a) => (
                    <li key={`${a.username}-${a.posting.id}`} className="py-2 text-sm text-ink">
                      <PosterHandle username={a.username} avatarPath={a.avatarPath} />{" "}
                      <span className="font-bold">{a.kind === "going" ? "Going" : "Interested"}</span>
                      {" · "}
                      <Link href={`/p/${a.posting.id}`} className="text-deep-navy underline-offset-2 hover:underline">
                        {a.posting.title}
                      </Link>
                      <span className="text-ink/70">
                        {fmt(a.posting.eventDate) ? ` · ${fmt(a.posting.eventDate)}` : ""}
                        {a.posting.placeLabel ? ` · ${a.posting.placeLabel}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
      <BottomNav />
    </main>
  );
}
