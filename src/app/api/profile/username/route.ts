import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usernameRejection } from "@/lib/domain";

/**
 * POST { username } - recovery path: a signed-in account that has no profile
 * yet chooses its username (/welcome). Uses the caller's session, so RLS
 * ("profiles self insert": auth.uid() = id) is the enforcement. Never changes
 * an existing username. Idempotent: if the profile already exists, returns it.
 */
const fail = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status });

export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Accounts are not configured in this environment.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Your session has ended. Sign in again to choose your username.");

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "invalid", "Invalid request.");
  }
  if (typeof b.username !== "string") return fail(400, "invalid_username", "Choose a username.");
  const rejection = usernameRejection(b.username);
  if (rejection) return fail(400, "invalid_username", rejection);

  const own = async () => (await supabase.from("profiles").select("username").eq("id", user.id).maybeSingle()).data?.username ?? null;

  const existing = await own();
  if (existing) return NextResponse.json({ ok: true, username: existing, existing: true });

  const { error } = await supabase.from("profiles").insert({ id: user.id, username: b.username });
  if (!error) return NextResponse.json({ ok: true, username: b.username, existing: false });
  if (error.code === "23505") {
    const now = await own(); // a concurrent request for this account may have won
    if (now) return NextResponse.json({ ok: true, username: now, existing: true });
    return fail(409, "username_taken", "That username is taken. Try another.");
  }
  console.error("[CorkBack] choose-username insert failed:", { code: error.code });
  return fail(500, "profile_failed", "Couldn't save your username. Please try again.");
}
