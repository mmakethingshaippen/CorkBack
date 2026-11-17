import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/reactionState";
import { validateLocationBlock } from "@/lib/postingInput";
import { timeZoneForPin } from "@/lib/lifecycle";

/**
 * Retry path for an owner's location change.
 *
 * PATCH — body is exactly { location }. Validates it with the publish rules, then calls
 *   public.cb_update_posting_location once, with the caller's own session (never the service role).
 *   The function is one UPDATE, so on any failure the posting keeps its previous pin, precision and zone.
 *   No content column is written here.
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
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(400, "invalid", "Invalid request.");
  const body = raw as Record<string, unknown>;
  // Only the location block is accepted: any other key (content fields, the retired real/desired) is refused.
  if (Object.keys(body).some((k) => k !== "location")) return fail(400, "invalid", "Invalid request.");

  const v = validateLocationBlock(body);
  if (!v.ok) return fail(400, "invalid", v.error);

  const { error } = await supabase.rpc("cb_update_posting_location", {
    p_posting_id: id,
    p_lat: v.pin.lat,
    p_lng: v.pin.lng,
    p_time_zone: timeZoneForPin(v.pin.lat, v.pin.lng),
    p_precision: v.precision,
  });
  if (error) {
    console.error("[CorkBack] posting location update failed:", { code: error.code, message: error.message });
    if (error.code === "CB404" || error.code === "CB409") {
      return fail(409, "unavailable", "This posting is no longer editable. It may have ended or been removed.");
    }
    if (error.code === "22023") return fail(400, "invalid", "The pin position is not valid. Move the pin and try again.");
    if (error.code === "42501") return fail(401, "signed_out", "Sign in to edit your posting.");
    return fail(500, "location_failed", "The location was not saved. Try again.");
  }
  return NextResponse.json({ id });
}
