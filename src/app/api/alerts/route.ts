import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES } from "@/lib/categories";

/**
 * Alerts CRUD for the signed-in user. Create, list, delete — no edit flow yet.
 * RLS restricts every row to its owner. The home point and radius are private;
 * they are only ever returned to the owner here and never surfaced elsewhere.
 */

function notConfigured() {
  return NextResponse.json(
    { error: "Alerts are not configured in this environment. Add Supabase credentials." },
    { status: 501 },
  );
}

/** Geocode a town name to a center using the free OpenStreetMap Nominatim API (no key). */
async function geocodeTown(name: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers: { "User-Agent": "CorkBack/1.0 (alerts geocode)" } });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!rows.length) return null;
    return { lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
  } catch {
    return null;
  }
}

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return notConfigured();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to view alerts." }, { status: 401 });

  const { data, error } = await supabase
    .from("alerts")
    .select("id, category_id, center_lat, center_lng, radius_miles, town_name, created_at, categories(slug, label)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ alerts: data ?? [] });
}

export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return notConfigured();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to create an alert." }, { status: 401 });

  const b = await req.json();

  // One category is required (an alert has one category).
  const category = CATEGORIES.find((c) => c.slug === b.categorySlug);
  if (!category) return NextResponse.json({ error: "Choose one category." }, { status: 400 });

  // One home point: either an explicit center (map point) or a town name that we
  // geocode to a center. A resolved center is always required.
  let centerLat: number | undefined = typeof b.centerLat === "number" ? b.centerLat : undefined;
  let centerLng: number | undefined = typeof b.centerLng === "number" ? b.centerLng : undefined;

  if ((centerLat === undefined || centerLng === undefined) && typeof b.townName === "string" && b.townName.trim()) {
    const geo = await geocodeTown(b.townName.trim());
    if (!geo) {
      return NextResponse.json({ error: `Could not find a town named "${b.townName}". Try a point on the map instead.` }, { status: 400 });
    }
    centerLat = geo.lat;
    centerLng = geo.lng;
  }

  if (centerLat === undefined || centerLng === undefined) {
    return NextResponse.json({ error: "Set a home point (a town or a point on the map)." }, { status: 400 });
  }

  // One radius: 1..25 miles, or null = whole town.
  let radiusMiles: number | null;
  if (b.wholeTown === true) {
    radiusMiles = null;
  } else if (typeof b.radiusMiles === "number" && b.radiusMiles >= 1 && b.radiusMiles <= 25) {
    radiusMiles = b.radiusMiles;
  } else {
    return NextResponse.json({ error: "Radius must be 1–25 miles, or choose whole town." }, { status: 400 });
  }

  const { data: cat } = await supabase.from("categories").select("id").eq("slug", category.slug).single();

  const { data, error } = await supabase
    .from("alerts")
    .insert({
      user_id: user.id,
      category_id: cat?.id,
      center_lat: centerLat,
      center_lng: centerLng,
      radius_miles: radiusMiles,
      town_name: typeof b.townName === "string" && b.townName.trim() ? b.townName.trim() : null,
    })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create alert." }, { status: 400 });
  return NextResponse.json({ id: data.id });
}

export async function DELETE(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return notConfigured();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to delete an alert." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing alert id." }, { status: 400 });

  // RLS also enforces ownership; the explicit user_id filter is defense in depth.
  const { error } = await supabase.from("alerts").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
