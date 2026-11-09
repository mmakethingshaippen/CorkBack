import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { alertMatchesPosting, type AlertRule, type PostingForMatch } from "@/lib/alerts";
import { sendAlertEmail, resendConfigured } from "@/lib/email";

/**
 * Alert sweep (Vercel cron). Matches recent active postings to alerts and emails
 * the alert owner once per (alert, posting) pair. Guarded by CRON_SECRET.
 *
 * Rules enforced here + in alertMatchesPosting:
 *  - same category, inside radius, active (not expired/past-event/deleted),
 *  - not hidden by the alert owner, never the poster's own posting,
 *  - exactly one email per (alert, posting) pair (sent_alerts ledger).
 *
 * Uses the service-role key (server only) to read across users. The key and the
 * RESEND key are never logged.
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: "Supabase service role not configured." }, { status: 501 });
  }
  if (!resendConfigured()) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured." }, { status: 501 });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { cookies: { getAll: () => [], setAll: () => {} } },
  );

  const now = new Date();
  const nowIso = now.toISOString();

  // Active postings only (not deleted, not expired). Past-event is filtered in match.
  const { data: postingRows, error: pErr } = await supabase
    .from("postings")
    .select("id, author_id, lat, lng, expires_at, event_date, end_date, end_time, time_zone, deleted_at, title, event_time, place_label, categories(slug)")
    .is("deleted_at", null)
    .gt("expires_at", nowIso);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const { data: alertRows, error: aErr } = await supabase
    .from("alerts")
    .select("id, user_id, center_lat, center_lng, radius_miles, categories(slug)");
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  const alerts: (AlertRule & { userId: string })[] = (alertRows ?? []).map((a) => {
    const cat = a.categories as unknown as { slug?: string } | null;
    return {
      id: String(a.id),
      ownerId: String(a.user_id),
      userId: String(a.user_id),
      categorySlug: cat?.slug ?? "",
      centerLat: Number(a.center_lat),
      centerLng: Number(a.center_lng),
      radiusMiles: a.radius_miles == null ? null : Number(a.radius_miles),
    };
  });

  type Row = Record<string, unknown>;
  const postings = (postingRows ?? []).map((p: Row) => {
    const cat = p.categories as unknown as { slug?: string } | null;
    return {
      match: {
        id: String(p.id),
        authorId: String(p.author_id),
        categorySlug: cat?.slug ?? "",
        lat: Number(p.lat),
        lng: Number(p.lng),
        expiresAt: String(p.expires_at),
        eventDate: (p.event_date as string) ?? null,
        endDate: (p.end_date as string) ?? null,
        endTime: (p.end_time as string) ?? null,
        timeZone: (p.time_zone as string) ?? null,
        deletedAt: (p.deleted_at as string) ?? null,
      } satisfies PostingForMatch,
      email: {
        id: String(p.id),
        title: String(p.title),
        eventDate: (p.event_date as string) ?? null,
        eventTime: (p.event_time as string) ?? null,
        placeLabel: String(p.place_label ?? ""),
        categorySlug: cat?.slug ?? "",
      },
    };
  });

  let sent = 0;
  let skippedAlreadySent = 0;
  const errors: string[] = [];

  for (const alert of alerts) {
    // The owner's hidden set (so we never notify about a posting they hid).
    const { data: hiddenRows } = await supabase
      .from("hidden_postings")
      .select("posting_id")
      .eq("user_id", alert.userId);
    const hidden = new Set((hiddenRows ?? []).map((h) => String(h.posting_id)));

    // The owner's email (private — used only to send to themselves).
    const { data: userRes } = await supabase.auth.admin.getUserById(alert.userId);
    const toEmail = userRes?.user?.email;

    for (const p of postings) {
      if (!alertMatchesPosting(alert, p.match, { hidden: hidden.has(p.match.id), now })) continue;

      // Dedupe: skip if this (alert, posting) pair was already sent.
      const { data: already } = await supabase
        .from("sent_alerts")
        .select("alert_id")
        .eq("alert_id", alert.id)
        .eq("posting_id", p.match.id)
        .maybeSingle();
      if (already) { skippedAlreadySent++; continue; }

      if (!toEmail) { errors.push(`No email for alert ${alert.id} owner`); continue; }

      const res = await sendAlertEmail({ to: toEmail, posting: p.email });
      if (!res.ok) { errors.push(`send failed for ${alert.id}/${p.match.id}: ${res.error}`); continue; }

      // Record the pair so it is never emailed again.
      const { error: insErr } = await supabase
        .from("sent_alerts")
        .insert({ alert_id: alert.id, posting_id: p.match.id });
      if (insErr) errors.push(`ledger insert failed for ${alert.id}/${p.match.id}: ${insErr.message}`);
      else sent++;
    }
  }

  return NextResponse.json({ ok: true, sweptAt: nowIso, sent, skippedAlreadySent, errors });
}
