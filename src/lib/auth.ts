import "server-only";
import { createClient } from "./supabase/server";

/**
 * Current viewer helpers. When Supabase is not configured, the viewer is always
 * treated as a signed-out visitor (public browsing still works fully).
 */

function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export async function getViewer(): Promise<{ id: string; username: string | null; avatarPath: string | null } | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, avatar_path")
    .eq("id", user.id)
    .maybeSingle();
  return { id: user.id, username: profile?.username ?? null, avatarPath: (profile?.avatar_path as string | null) ?? null };
}

export async function isSignedIn(): Promise<boolean> {
  return (await getViewer()) !== null;
}

/**
 * The signed-in viewer's home point, taken from their most recent alert (town
 * name + center). Used only to center the home map when device location is
 * unavailable — never shown publicly. Returns null when signed out or no alert.
 */
export async function getViewerHomePoint(): Promise<
  { lat: number; lng: number; townName: string | null } | null
> {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("alerts")
    .select("center_lat, center_lng, town_name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    lat: Number(data.center_lat),
    lng: Number(data.center_lng),
    townName: (data.town_name as string) ?? null,
  };
}
