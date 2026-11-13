import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES } from "@/lib/categories";
import { parseFollowBody } from "@/lib/followState";
import { isFollowingCategory } from "@/lib/categoryFollows";
/**
 * PUT /api/category-follows/[slug]  { following: boolean }
 * Sets the viewer's follow of a category to the DESIRED state (idempotent).
 * A category follow is a feed follow, not email. It never touches alerts,
 * people follows or connections.
 * - No duplicates: (user_id, category_id) primary key + ignore-duplicates upsert.
 * - RLS ("category_follows self write/delete") is the enforcement.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const fail = (status: number, error: string, code: string) => NextResponse.json({ error, code }, { status });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "Not configured in this environment.", "not_configured");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "Sign in to follow categories.", "signed_out");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request.", "invalid");
  }
  const parsed = parseFollowBody(body);
  if (!parsed.ok) return fail(400, "Send { following: true | false }.", "invalid");
  const category = CATEGORIES.find((c) => c.slug === slug);
  if (!category) return fail(404, "That category was not found.", "not_found");
  const { data: cat, error: lookupError } = await supabase.from("categories").select("id").eq("slug", category.slug).maybeSingle();
  if (lookupError) return fail(500, "Could not load that category. Try again.", "load_failed");
  if (!cat) return fail(404, "That category was not found.", "not_found");
  const categoryId = Number(cat.id);
  const { error } = parsed.following
    ? await supabase
        .from("category_follows")
        .upsert({ user_id: user.id, category_id: categoryId }, { onConflict: "user_id,category_id", ignoreDuplicates: true })
    : await supabase.from("category_follows").delete().eq("user_id", user.id).eq("category_id", categoryId);
  if (error) {
    console.error("[CorkBack] category follow write failed:", { code: error.code, message: error.message });
    if (error.code === "42501") return fail(403, "That change isn't allowed.", "forbidden");
    return fail(500, "Could not save. Try again.", "write_failed");
  }
  try {
    return NextResponse.json({ following: await isFollowingCategory(supabase, user.id, categoryId) });
  } catch {
    return fail(500, "Saved, but could not confirm. Refresh to check.", "confirm_failed");
  }
}
