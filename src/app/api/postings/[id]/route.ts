import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/reactionState";
import { isPostingActive } from "@/lib/lifecycle";
import { validatePostingEdit } from "@/lib/postingInput";

/**
 * Owner edit and delete of a posting.
 *
 * PATCH  — change content only: title, details, category, RSVP link, event
 *   date/time, end date/time, place label. The pin, expiry, flyer, zone, author,
 *   created_at, deletion and moderation state are NOT updatable: the database
 *   grants UPDATE on exactly those content columns, and the update policy only
 *   allows the author on an active, visible posting. This route adds readable
 *   errors and the same validation as publishing.
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
    .select("id, author_id, expires_at, event_date, end_date, end_time, time_zone, lat, lng, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.author_id !== user.id) return fail(404, "not_found", "This posting wasn't found.");
  const lifecycle = {
    expiresAt: String(row.expires_at), eventDate: row.event_date as string | null, endDate: row.end_date as string | null,
    endTime: row.end_time as string | null, timeZone: row.time_zone as string | null, lat: Number(row.lat), lng: Number(row.lng),
    deletedAt: row.deleted_at as string | null,
  };
  if (!isPostingActive(lifecycle)) return fail(409, "ended", "This posting has ended, so it can't be edited. You can still delete it.");

  const v = validatePostingEdit(raw, { expiresAt: lifecycle.expiresAt, timeZone: lifecycle.timeZone, lat: lifecycle.lat, lng: lifecycle.lng }, new Date());
  if (!v.ok) return fail(400, "invalid", v.error);
  const e = v.value;

  const { data: cat } = await supabase.from("categories").select("id").eq("slug", e.categorySlug).single();
  if (!cat) return fail(400, "invalid", "Invalid category.");

  const { data: updated, error } = await supabase
    .from("postings")
    .update({
      title: e.title, body: e.body, category_id: cat.id, rsvp_url: e.rsvpUrl,
      event_date: e.eventDate, event_time: e.eventTime, end_date: e.endDate, end_time: e.endTime, place_label: e.placeLabel,
    })
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
  return NextResponse.json({ id });
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
