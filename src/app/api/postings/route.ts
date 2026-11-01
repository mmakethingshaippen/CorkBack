import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeExpiresAt, clampPinNudge, EXPIRY_PRESETS, type ExpiryPreset } from "@/lib/domain";
import { CATEGORIES } from "@/lib/categories";

/**
 * Create a posting. Requires an authenticated author. Server computes expires_at
 * from the preset and clamps the pin to stay near the poster's real location.
 * Nothing about the request is public until this row is written.
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

  const b = await req.json();
  const expiry = b.expiry as ExpiryPreset;
  if (!EXPIRY_PRESETS.includes(expiry)) {
    return NextResponse.json({ error: "Invalid expiry preset." }, { status: 400 });
  }
  const category = CATEGORIES.find((c) => c.slug === b.categorySlug);
  if (!category) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }
  if (!b.title || !b.real) {
    return NextResponse.json({ error: "Title and location are required." }, { status: 400 });
  }

  // Resolve the category id.
  const { data: cat } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", category.slug)
    .single();

  const now = new Date();
  const expiresAt = computeExpiresAt(now, expiry);
  const pin = clampPinNudge(b.real, b.desired ?? b.real);

  const { data, error } = await supabase
    .from("postings")
    .insert({
      author_id: user.id,
      title: String(b.title).slice(0, 140),
      body: String(b.body ?? ""),
      category_id: cat?.id,
      rsvp_url: b.rsvpUrl ?? null,
      event_date: b.eventDate ?? null,
      event_time: b.eventTime ?? null,
      place_label: b.placeLabel ?? "",
      lat: pin.lat,
      lng: pin.lng,
      expiry,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not publish." }, { status: 400 });
  }
  return NextResponse.json({ id: data.id });
}
