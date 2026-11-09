import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidUsername } from "@/lib/domain";
import { canFollow, parseFollowBody } from "@/lib/followState";
import { isFollowing } from "@/lib/follows";

/**
 * PUT /api/follows/[username]  { following: boolean }
 * Sets the viewer's follow of @username to the DESIRED state (idempotent).
 * - One-way; never creates or changes a friendship (connections are untouched).
 * - No self-follow: rejected here (400) and by the no_self_follow CHECK.
 * - No duplicates: (follower_id, followee_id) primary key + ignore-duplicates upsert.
 * - RLS ("follows self write/delete") is the enforcement: a user can only add
 *   or remove edges where they are the follower.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const fail = (status: number, error: string, code: string) => NextResponse.json({ error, code }, { status });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "Not configured in this environment.", "not_configured");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "Sign in to follow posters.", "signed_out");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request.", "invalid");
  }
  const parsed = parseFollowBody(body);
  if (!parsed.ok) return fail(400, "Send { following: true | false }.", "invalid");

  if (!isValidUsername(username)) return fail(404, "That poster was not found.", "not_found");
  const { data: target, error: lookupError } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (lookupError) return fail(500, "Could not load that poster. Try again.", "load_failed");
  if (!target) return fail(404, "That poster was not found.", "not_found");
  if (!canFollow(user.id, String(target.id))) return fail(400, "You can't follow yourself.", "self");

  const { error } = parsed.following
    ? await supabase
        .from("follows")
        .upsert({ follower_id: user.id, followee_id: target.id }, { onConflict: "follower_id,followee_id", ignoreDuplicates: true })
    : await supabase.from("follows").delete().eq("follower_id", user.id).eq("followee_id", target.id);

  if (error) {
    console.error("[CorkBack] follow write failed:", { code: error.code, message: error.message });
    if (error.code === "23514") return fail(400, "You can't follow yourself.", "self");
    if (error.code === "42501") return fail(403, "That change isn't allowed.", "forbidden");
    return fail(500, "Could not save. Try again.", "write_failed");
  }

  try {
    return NextResponse.json({ following: await isFollowing(supabase, user.id, String(target.id)) });
  } catch {
    return fail(500, "Saved, but could not confirm. Refresh to check.", "confirm_failed");
  }
}
