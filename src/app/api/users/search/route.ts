import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prefixPattern, SEARCH_RE, type Relationship } from "@/lib/connectionState";
import { listConnections } from "@/lib/connections";

/**
 * GET /api/users/search?q=prefix
 * Signed-in users search PUBLIC usernames by prefix (2-20 characters, max 20
 * results, excluding yourself). Returns usernames and your relationship with
 * each, nothing else: no ids, emails, or locations.
 */
export async function GET(req: Request) {
  const fail = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Not configured in this environment.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Sign in to search for friends.");

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!SEARCH_RE.test(q)) {
    return fail(400, "invalid_query", "Type at least 2 letters, numbers, or underscores.");
  }

  const [{ data, error }, mine] = await Promise.all([
    supabase.from("profiles").select("username").ilike("username", prefixPattern(q)).neq("id", user.id)
      .order("username", { ascending: true }).limit(20),
    listConnections(supabase, user.id),
  ]);
  if (error) return fail(500, "search_failed", "Search failed. Try again.");

  const results = (data ?? []).map((r) => ({
    username: String(r.username),
    state: (mine.byUsername[String(r.username)] ?? "none") as Relationship,
  }));
  return NextResponse.json({ results });
}
