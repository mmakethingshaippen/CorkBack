import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/reactionState";
import { isPostingActive } from "@/lib/lifecycle";
import { validatePostingEdit } from "@/lib/postingInput";
import { categoryKind } from "@/lib/postingKinds";

/**
 * Owner edit and delete of a posting.
 *
 * PATCH  — content update first: title, details, category, RSVP link, event
 *   date/time, end date/time, place label. The content update never includes
 *   lat, lng, time_zone or location_precision; the database grants UPDATE on
 *   exactly the content columns, and the update policy only allows the author
 *   on an active, visible posting. Then, only when the body has a `location`
 *   block, the pin is written by rpc cb_update_posting_location (one atomic
 *   statement). If that fails the previous pin stays and the answer is 500
 *   `location_failed`, so the client can offer a Retry via PATCH .../location.
 *   Expiry, flyer, author, created_at, deletion and moderation state are NOT updatable.
 * DELETE — soft delete through public.delete_own_posting (author only; works on
 *   active, ended and moderated postings; idempotent).
 */
const fail = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Editing isn't available in this environment.");
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Sign in to edit your posting.");
  if (!isUuid(id)) return fail(404, "not_found", "This posting wasn't found.");

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, "invalid", "Invalid request.");
  }

  // Read as the viewer: a deleted or hidden posting is not returned at all.
  const { data: row } = await supabase
    .from("postings")
    .select("id, author_id, expires_at, event_date, event_time, end_date, end_time, rsvp_url, time_zone, lat, lng, deleted_at, category:categories(slug)")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.author_id !== user.id) return fail(404, "not_found", "This posting wasn't found.");
  const lifecycle = {
    expiresAt: String(row.expires_at), eventDate: row.event_date as string | null, endDate: row.end_date as string | null,
    endTime: row.end_time as string | null, timeZone: row.time_zone as string | null, lat: Number(row.lat), lng: Number(row.lng),
    deletedAt: row.deleted_at as string | null,
  };
  if (!isPostingActive(lifecycle)) return fail(409, "ended", "This posting has ended, so it can't be edited. You can still delete it.");

  const v = validatePostingEdit(raw, { expiresAt: lifecycle.expiresAt, timeZone: lifecycle.timeZone, lat: lifecycle.lat, lng: lifecycle.lng, eventDate: lifecycle.eventDate, endDate: lifecycle.endDate, endTime: lifecycle.endTime }, new Date());
  if (!v.ok) return fail(400, "invalid", v.error);
  const e = v.value;

  const { data: cat } = await supabase.from("categories").select("id").eq("slug", e.categorySlug).single();
  if (!cat) return fail(400, "invalid", "Invalid category.");

  // Date columns by kind, in one update. Everything above is validation: a rejection never reaches the update.
  const newKind = categoryKind(e.categorySlug);
  let eventDate = e.eventDate, eventTime = e.eventTime, endDate = e.endDate, endTime = e.endTime;
  if (newKind === "listing") {
    // Listing: only end_date (the deadline). A stored legacy event_date (and its times) stays as stored unless the
    // client reports the replacement notice was shown (`replaceLegacyEventDate: true`); then all three are cleared.
    const storedEventDate = (row.event_date as string | null) ?? null;
    const replace = (raw as Record<string, unknown>).replaceLegacyEventDate === true;
    const oldSlug = (row.category as { slug?: string } | null)?.slug;
    const fromEvent = oldSlug ? categoryKind(oldSlug) !== "listing" : false;
    if (storedEventDate && !replace) {
      eventDate = storedEventDate;
      eventTime = fromEvent ? null : ((row.event_time as string | null) ?? null);
      endTime = fromEvent ? null : ((row.end_time as string | null) ?? null);
    } else {
      eventDate = null; eventTime = null; endTime = null;
    }
    if (fromEvent) { eventTime = null; endTime = null; } // event to listing drops the times (Req 11.6)
  } else if (newKind === "event-optional" && !eventDate) {
    eventTime = null; endDate = null; endTime = null; // no date: all four null
  }
  const patch: Record<string, unknown> = {
    title: e.title, body: e.body, category_id: cat.id,
    event_date: eventDate, event_time: eventTime, end_date: endDate, end_time: endTime, place_label: e.placeLabel,
  };
  // Leave the stored link untouched when the submitted one is the same value (Req 11.7).
  if (e.rsvpUrl !== ((row.rsvp_url as string | null) ?? null)) patch.rsvp_url = e.rsvpUrl;

  const { data: updated, error } = await supabase
    .from("postings")
    .update(patch)
    .eq("id", id)
    .eq("author_id", user.id)
    .select("id");
  if (error) {
    console.error("[CorkBack] posting edit failed:", { code: error.code, message: error.message });
    if (error.code === "42501") return fail(403, "forbidden", "That change isn't allowed.");
    return fail(500, "failed", "Couldn't save your changes. They are kept on this page; try again.");
  }
  // Zero rows: the database no longer considers it an active, visible posting (ended or moderated in the meantime).
  if (!updated || updated.length === 0) return fail(409, "unavailable", "This posting is no longer editable. It may have ended or been removed.");
  if (!e.location) return NextResponse.json({ id });

  // Second step: the new pin, in one atomic statement inside the function. A failure leaves the previous pin as stored.
  const { error: locError } = await supabase.rpc("cb_update_posting_location", {
    p_posting_id: id,
    p_lat: e.location.pin.lat,
    p_lng: e.location.pin.lng,
    p_time_zone: e.location.timeZone,
    p_precision: e.location.precision,
  });
  if (locError) {
    console.error("[CorkBack] posting location update failed:", { code: locError.code, message: locError.message });
    if (locError.code === "CB404" || locError.code === "CB409") return fail(409, "unavailable", "This posting is no longer editable. It may have ended or been removed.");
    if (locError.code === "22023") return fail(400, "invalid", "That location isn't valid.");
    return fail(500, "location_failed", "Your other changes were saved, but the location was not.");
  }
  return NextResponse.json({ id, location: { lat: e.location.pin.lat, lng: e.location.pin.lng, precision: e.location.precision, timeZone: e.location.timeZone } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Deleting isn't available in this environment.");
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Sign in to delete your posting.");
  if (!isUuid(id)) return fail(404, "not_found", "This posting wasn't found.");

  const { data, error } = await supabase.rpc("delete_own_posting", { p_posting_id: id });
  if (error) {
    console.error("[CorkBack] posting delete failed:", { code: error.code, message: error.message });
    if (error.code === "CB404") return fail(404, "not_found", "This posting wasn't found.");
    if (error.code === "42501") return fail(401, "signed_out", "Sign in to delete your posting.");
    return fail(500, "failed", "Couldn't delete the posting. Try again.");
  }
  return NextResponse.json({ result: data === "already_deleted" ? "already_deleted" : "deleted" });
}
