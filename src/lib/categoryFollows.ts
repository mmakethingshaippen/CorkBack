import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { CATEGORIES } from "./categories";

/**
 * Server reads for category follows (a feed follow, not email; alerts are
 * separate). Uses the caller's session; RLS ("category_follows self read")
 * lets a user see only their own rows.
 */
export async function isFollowingCategory(supabase: SupabaseClient, userId: string, categoryId: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("category_follows")
    .select("category_id")
    .eq("user_id", userId)
    .eq("category_id", categoryId)
    .maybeSingle();
  if (error) throw new Error(`Could not load category follow state (${error.code ?? "unknown"}).`);
  return Boolean(data);
}

/** Slugs of the categories the viewer follows, in the locked list order. */
export async function listFollowedCategorySlugs(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("category_follows")
    .select("categories(slug)")
    .eq("user_id", userId);
  if (error) throw new Error(`Could not load the categories you follow (${error.code ?? "unknown"}).`);
  const slugs = new Set(
    (data ?? []).map((r) => (r as unknown as { categories?: { slug?: string } | null }).categories?.slug ?? ""),
  );
  return CATEGORIES.map((c) => c.slug).filter((s) => slugs.has(s));
}

/** Convenience for pages: the signed-in viewer's followed slugs, or [] when it can't be read. */
export async function viewerFollowedCategorySlugs(userId: string | null): Promise<string[]> {
  if (!userId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return [];
  try {
    return await listFollowedCategorySlugs(await createClient(), userId);
  } catch {
    return [];
  }
}
