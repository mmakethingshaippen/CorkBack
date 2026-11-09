import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isValidUsername } from "@/lib/domain";
import { parseConnectionBody, type ConnectionAction, type Relationship } from "@/lib/connectionState";
import { getRelationship } from "@/lib/connections";

/**
 * POST /api/connections  { action, username }
 *   send    - request friendship (you become the requester)
 *   cancel  - withdraw your pending request
 *   accept  - accept a request sent TO you (recipient only)
 *   decline - decline a request sent TO you (recipient only)
 *   remove  - end an accepted friendship (either friend)
 *
 * The database enforces the rules (one row per pair either way, no self
 * requests, recipient-only accept, participants immutable, party-only delete).
 * This route adds readable errors and makes repeats idempotent. Responds with
 * the resulting relationship. Following is never touched.
 */

const MSG: Record<string, string> = {
  incoming_exists: "They already sent you a request. Accept it instead.",
  already_friends: "You're already friends.",
  state_changed: "That request changed. The list has been refreshed.",
  self: "You can't send a friend request to yourself.",
};

export async function POST(req: Request) {
  const fail = (status: number, code: string, error: string, state?: Relationship) =>
    NextResponse.json({ error, code, state }, { status });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Not configured in this environment.");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Sign in to manage friends.");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "invalid", "Invalid request.");
  }
  const parsed = parseConnectionBody(body);
  if (!parsed.ok) return fail(400, "invalid", "Send { action, username }.");
  if (!isValidUsername(parsed.username)) return fail(404, "not_found", "That user was not found.");

  const { data: target, error: lookupError } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", parsed.username)
    .maybeSingle();
  if (lookupError) return fail(500, "load_failed", "Could not load that user. Try again.");
  if (!target) return fail(404, "not_found", "That user was not found.");
  const them = String(target.id);
  if (them === user.id) return fail(400, "self", MSG.self);

  try {
    return await perform(supabase, parsed.action, user.id, them, fail);
  } catch (e) {
    console.error("[CorkBack] connection action failed:", e instanceof Error ? e.message : e);
    return fail(500, "write_failed", "Could not save. Try again.");
  }
}

async function perform(
  supabase: SupabaseClient,
  action: ConnectionAction,
  me: string,
  them: string,
  fail: (status: number, code: string, error: string, state?: Relationship) => NextResponse,
): Promise<NextResponse> {
  const ok = (state: Relationship) => NextResponse.json({ state });
  const current = () => getRelationship(supabase, me, them);
  const pair = `and(requester_id.eq.${me},addressee_id.eq.${them}),and(requester_id.eq.${them},addressee_id.eq.${me})`;

  if (action === "send") {
    const before = await current();
    if (before === "outgoing") return ok("outgoing");
    if (before === "incoming") return fail(409, "incoming_exists", MSG.incoming_exists, "incoming");
    if (before === "friends") return fail(409, "already_friends", MSG.already_friends, "friends");
    const { error } = await supabase.from("connections").insert({ requester_id: me, addressee_id: them });
    if (error) {
      // 23505: the other person sent a request at the same moment (one row per pair).
      if (error.code === "23505") {
        const now = await current();
        if (now === "outgoing") return ok("outgoing");
        if (now === "incoming") return fail(409, "incoming_exists", MSG.incoming_exists, "incoming");
        if (now === "friends") return fail(409, "already_friends", MSG.already_friends, "friends");
      }
      if (error.code === "23514") return fail(400, "self", MSG.self);
      if (error.code === "42501") return fail(403, "forbidden", "That isn't allowed.");
      throw new Error(`${error.code}: ${error.message}`);
    }
    return ok(await current());
  }

  if (action === "accept") {
    const { data, error } = await supabase
      .from("connections")
      .update({ status: "accepted" })
      .eq("requester_id", them)
      .eq("addressee_id", me)
      .eq("status", "pending")
      .select("status");
    if (error) {
      if (error.code === "42501") return fail(403, "forbidden", "Only the person who received a request can accept it.");
      throw new Error(`${error.code}: ${error.message}`);
    }
    if ((data ?? []).length === 1) return ok("friends");
    const now = await current();
    return now === "friends" ? ok("friends") : fail(409, "state_changed", MSG.state_changed, now);
  }

  // cancel / decline / remove are deletes scoped to exactly the intended row.
  let del = supabase.from("connections").delete();
  if (action === "cancel") del = del.eq("requester_id", me).eq("addressee_id", them).eq("status", "pending");
  else if (action === "decline") del = del.eq("requester_id", them).eq("addressee_id", me).eq("status", "pending");
  else del = del.or(pair).eq("status", "accepted");
  const { data, error } = await del.select("status");
  if (error) {
    if (error.code === "42501") return fail(403, "forbidden", "That isn't allowed.");
    throw new Error(`${error.code}: ${error.message}`);
  }
  if ((data ?? []).length === 1) return ok("none");
  const now = await current();
  return now === "none" ? ok("none") : fail(409, "state_changed", MSG.state_changed, now);
}
