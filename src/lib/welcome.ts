import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeNextPath } from "./appUrl";

/**
 * Where to go after an email link signs someone in: their intended page, or
 * /welcome first if the account has no profile (no username) yet.
 */
export async function destinationAfterSignIn(supabase: SupabaseClient, userId: string, next: string | null): Promise<string> {
  const dest = safeNextPath(next, "/");
  const { data } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  return data ? dest : `/welcome?next=${encodeURIComponent(dest)}`;
}
