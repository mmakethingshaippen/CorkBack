import { notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";
import { getLocationPrecision, getPosting } from "@/lib/postings";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/reactionState";
import type { StoredPrecision } from "@/lib/postingLocation";
import { getViewer } from "@/lib/auth";
import { isPostingActive, postingTakedown } from "@/lib/lifecycle";
import { EditPostingForm } from "./EditPostingForm";

export const dynamic = "force-dynamic";

/**
 * Owner edit. Server-checked: only the author, only an active and visible
 * posting. Anyone else (including signed-out visitors) gets the standard
 * not-found page, so the route doesn't reveal that a posting exists. The
 * database enforces the same rules on save.
 */
export default async function EditPostingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [posting, viewer] = await Promise.all([getPosting(id), getViewer()]);
  if (!posting || !viewer || viewer.username !== posting.authorUsername) notFound();
  // Separate read; failure logs the code and reads as "unreviewed". Seed postings have no column.
  const precision: StoredPrecision = isUuid(posting.id) && isPostingActive(posting)
    ? await getLocationPrecision(await createClient(), posting.id)
    : "unreviewed";
  if (!isPostingActive(posting)) {
    return (
      <main className="min-h-screen pb-24">
        <TopBar back={{ href: `/p/${posting.id}`, label: "Back to posting" }} />
        <div className="mx-auto max-w-xl space-y-3 px-4">
          <div role="status" className="rounded-card border-2 border-board bg-board/40 p-4">
            <p className="font-bold text-ink">This posting has ended</p>
            <p className="mt-1 text-sm text-ink/70">Ended postings can&apos;t be edited. You can still delete it from its page.</p>
            <Link href={`/p/${posting.id}`} className="mt-2 inline-block font-bold text-deep-navy underline-offset-2 hover:underline">Back to the posting</Link>
          </div>
        </div>
        <BottomNav />
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: `/p/${posting.id}`, label: "Back to posting" }} />
      <div className="mx-auto max-w-xl space-y-4 px-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Edit posting</h1>
        </CorkBand>
        <EditPostingForm
          postingId={posting.id}
          lifecycle={{
            expiresAt: posting.expiresAt,
            timeZone: posting.timeZone ?? null,
            lat: posting.lat,
            lng: posting.lng,
            takedownAt: postingTakedown(posting).toISOString(),
          }}
          pin={{ lat: posting.lat, lng: posting.lng, precision }}
          initial={{
            title: posting.title,
            body: posting.body,
            categorySlug: posting.categorySlug,
            rsvpUrl: posting.rsvpUrl ?? "",
            eventDate: posting.eventDate ?? "",
            eventTime: posting.eventTime ?? "",
            endDate: posting.endDate ?? "",
            endTime: (posting.endTime ?? "").slice(0, 5),
            placeLabel: posting.placeLabel,
          }}
        />
      </div>
      <BottomNav />
    </main>
  );
}
