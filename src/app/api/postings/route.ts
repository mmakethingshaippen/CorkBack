import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validatePostingInput } from "@/lib/postingInput";

/**
 * Create a posting. Requires an authenticated author. Server computes expires_at
 * from the preset and clamps the pin to stay near the poster's real location.
 * Only the bounded pin is stored; the raw location is discarded, and the
 * response contains just the new id. Nothing is public until this row is written.
 */
export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { error: "Publishing is not configured in this environment. Add Supabase credentials to enable posting." },
      { status: 501 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to post." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const v = validatePostingInput(raw, new Date());
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const p = v.value;

  const { data: cat } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", p.categorySlug)
    .single();
  if (!cat) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  // Store the zone only if the database accepts it too, so the app and the
  // database always evaluate the same zone (otherwise both use the fallback).
  let timeZone = p.timeZone;
  if (timeZone) {
    const { data: dbZone, error: tzErr } = await supabase.rpc("cb_safe_time_zone", { p_tz: timeZone });
    if (tzErr || dbZone !== timeZone) timeZone = null;
  }

  const { data, error } = await supabase
    .from("postings")
    .insert({
      author_id: user.id,
      title: p.title,
      body: p.body,
      category_id: cat.id,
      rsvp_url: p.rsvpUrl,
      event_date: p.eventDate,
      event_time: p.eventTime,
      end_date: p.endDate,
      end_time: p.endTime,
      time_zone: timeZone,
      place_label: p.placeLabel,
      lat: p.pin.lat,
      lng: p.pin.lng,
      expiry: p.expiry,
      expires_at: p.expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not publish." }, { status: 400 });
  }
  return NextResponse.json({ id: data.id });
}
