import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { isPostingActive } from "./lifecycle";
import { getReactionCounts, getViewerReaction, loadPostingLifecycle, ZERO_COUNTS } from "./reactions";
import { isUuid } from "./reactionState";

/**
 * Shared guard for the like/plan routes: signed in, valid id, posting exists and
 * is active. RLS is the real enforcement (posting_is_active in the policies);
 * this gives readable errors first.
 */
export async function guardReaction(
  req: Request,
  id: string,
): Promise<
  | { ok: true; supabase: SupabaseClient; user: User; body: unknown }
  | { ok: false; res: NextResponse }
> {
  const fail = (status: number, error: string, code?: string) => ({
    ok: false as const,
    res: NextResponse.json({ error, code }, { status }),
  });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "Not configured in this environment.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "Sign in to take part.", "signed_out");
  if (!isUuid(id)) return fail(404, "This posting was not found.", "not_found");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request.", "invalid");
  }

  let posting;
  try {
    posting = await loadPostingLifecycle(supabase, id);
  } catch {
    return fail(500, "Could not load this posting. Try again.", "load_failed");
  }
  if (!posting) return fail(404, "This posting was not found.", "not_found");
  if (!isPostingActive(posting)) {
    return fail(409, "This posting has ended. Likes and plans are closed.", "ended");
  }
  return { ok: true, supabase, user, body };
}

/** Readable error for a failed likes/plans write. */
export function writeError(error: { code?: string; message: string }): NextResponse {
  console.error("[CorkBack] reaction write failed:", { code: error.code, message: error.message });
  if (error.code === "42501") {
    // RLS rejected the row: not the caller's own row, or the database considers
    // the posting ended.
    return NextResponse.json(
      { error: "That change isn't allowed. The posting may have ended.", code: "forbidden" },
      { status: 403 },
    );
  }
  return NextResponse.json({ error: "Could not save. Try again.", code: "write_failed" }, { status: 500 });
}

/** Fresh server truth after a write: the viewer's state and public counts. */
export async function reactionSnapshot(supabase: SupabaseClient, postingId: string, userId: string) {
  const [mine, counts] = await Promise.all([
    getViewerReaction(supabase, postingId, userId),
    getReactionCounts(supabase, [postingId]),
  ]);
  // `at`: server time of this snapshot, so clients can tell it apart from older cached renders.
  return NextResponse.json({ ...mine, counts: counts.get(postingId) ?? ZERO_COUNTS, at: new Date().toISOString() });
}
