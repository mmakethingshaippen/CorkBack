import { notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth";
import { viewerIsAdmin } from "@/lib/moderationData";
import { QUEUE_PAGE_SIZE, fetchLog, fetchQueue, lookupAvatarPaths, parseQueueStatus, parseReasonFilter } from "@/lib/adminData";
import { Avatar } from "@/components/ui/Avatar";
import { REPORT_REASONS, REPORT_REASON_LABEL } from "@/lib/moderation";
import { AdminQueue } from "./AdminQueue";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " UTC";

/**
 * Admin moderation dashboard. Authorization is enforced HERE on the server
 * (is_admin() in the database) and again inside every database function; the
 * "Admin" link on a profile is only a convenience. Anyone who isn't an admin,
 * signed-out visitors included, gets the standard not-found page.
 * Shows usernames only (never emails) and never reads private messages.
 */
export default async function AdminPage({ searchParams }: { searchParams: Promise<{ status?: string; reason?: string; offset?: string }> }) {
  const sp = await searchParams;
  const viewer = await getViewer();
  if (!viewer) notFound();
  const supabase = await createClient();
  if (!(await viewerIsAdmin(supabase))) notFound();

  const status = parseQueueStatus(sp.status);
  const reason = parseReasonFilter(sp.reason);
  const offset = Math.max(0, Number.parseInt(sp.offset ?? "0", 10) || 0);
  const [queue, log] = await Promise.all([fetchQueue(supabase, { status, reason, offset }), fetchLog(supabase, null, 30)]);
  if (!queue.ok) notFound();
  const avatars = await lookupAvatarPaths(supabase, [
    ...queue.value.items.flatMap((i) => [i.reporterUsername, i.postingAuthorUsername, i.resolvedByUsername]),
    ...(log.ok ? log.value.map((l) => l.adminUsername) : []),
  ]);

  const href = (over: { status?: string; reason?: string | null; offset?: number }) => {
    const q = new URLSearchParams();
    const s = over.status ?? status;
    const r = over.reason === undefined ? reason : over.reason;
    if (s !== "pending") q.set("status", s);
    if (r) q.set("reason", r);
    if (over.offset) q.set("offset", String(over.offset));
    const qs = q.toString();
    return qs ? `/admin?${qs}` : "/admin";
  };
  const tab = (key: "pending" | "resolved" | "all", label: string) => (
    <Link
      key={key}
      href={href({ status: key, offset: 0 })}
      aria-current={status === key ? "page" : undefined}
      className={`inline-flex min-h-[44px] items-center rounded-control border-2 px-4 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy ${
        status === key ? "border-deep-navy bg-deep-navy text-white" : "border-deep-navy bg-white text-deep-navy"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="mx-auto max-w-6xl space-y-4 px-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Moderation</h1>
          <p className="mt-1 text-paper/90">Reports from neighbours. Nothing is hidden automatically; every action is logged.</p>
        </CorkBand>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-label="Reports">
            <nav aria-label="Report status" className="flex flex-wrap items-center gap-2">
              {tab("pending", "Pending")}
              {tab("resolved", "Resolved")}
              {tab("all", "All")}
            </nav>
            <nav aria-label="Filter by reason" className="mt-2 flex flex-wrap gap-2">
              <Link href={href({ reason: null, offset: 0 })} aria-current={reason === null ? "true" : undefined} className={`inline-flex min-h-[44px] items-center rounded-control border px-3 text-sm ${reason === null ? "border-deep-navy font-bold text-deep-navy" : "border-board text-ink"}`}>
                Any reason
              </Link>
              {REPORT_REASONS.map((r) => (
                <Link key={r} href={href({ reason: r, offset: 0 })} aria-current={reason === r ? "true" : undefined} className={`inline-flex min-h-[44px] items-center rounded-control border px-3 text-sm ${reason === r ? "border-deep-navy font-bold text-deep-navy" : "border-board text-ink"}`}>
                  {REPORT_REASON_LABEL[r]}
                </Link>
              ))}
            </nav>
            <div className="mt-3">
              <AdminQueue items={queue.value.items} avatars={avatars} />
            </div>
            <div className="mt-3 flex gap-3">
              {offset > 0 ? <Link href={href({ offset: Math.max(0, offset - QUEUE_PAGE_SIZE) })} className="inline-flex min-h-[44px] items-center font-bold text-deep-navy underline-offset-2 hover:underline">Newer</Link> : null}
              {queue.value.hasMore ? <Link href={href({ offset: offset + QUEUE_PAGE_SIZE })} className="inline-flex min-h-[44px] items-center font-bold text-deep-navy underline-offset-2 hover:underline">Older</Link> : null}
            </div>
          </section>

          <aside aria-labelledby="recent-actions" className="h-fit rounded-card border border-board bg-white p-4">
            <h2 id="recent-actions" className="text-lg font-bold text-ink">Recent actions</h2>
            {log.ok && log.value.length ? (
              <ul className="mt-2 divide-y divide-board text-sm">
                {log.value.map((l) => (
                  <li key={l.id} className="py-2 text-ink">
                    <span className="font-bold">{l.action === "hide_posting" ? "Hid" : l.action === "restore_posting" ? "Restored" : "Dismissed a report on"}</span>{" "}
                    <span className="break-words">{l.postingTitle ?? "a removed posting"}</span>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-ink/60"><Avatar username={l.adminUsername} path={avatars[l.adminUsername] ?? null} size={18} />@{l.adminUsername} · {when(l.createdAt)}</span>
                    {l.reason ? <span className="block break-words text-xs text-ink/80">{l.reason}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink/60">No actions yet.</p>
            )}
          </aside>
        </div>
      </div>
      <BottomNav />
    </main>
  );
}
