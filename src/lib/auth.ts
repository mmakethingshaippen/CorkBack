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

export async function getViewer(): Promise<{ id: string; username: string | null } | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();
  return { id: user.id, username: profile?.username ?? null };
}

export async function isSignedIn(): Promise<boolean> {
  return (await getViewer()) !== null;
}
