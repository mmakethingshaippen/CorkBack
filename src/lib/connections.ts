import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPostingActive } from "./lifecycle";
import { relationshipFrom, type ConnectionRow, type Relationship } from "./connectionState";
import type { PlanKind } from "./types";

/**
 * Server reads for Friends. Every read uses the caller's session, so RLS
 * ("connections party read", "plans self or friend read") decides visibility.
 * Only usernames leave this module: never user ids, emails, or locations.
 * Following is independent and is never touched here.
 */

export interface PersonEntry {
  username: string;
  avatarPath: string | null;
  since: string;
}

export async function getRelationship(supabase: SupabaseClient, me: string, otherId: string): Promise<Relationship> {
  const { data, error } = await supabase
    .from("connections")
    .select("requester_id, addressee_id, status")
    .or(`and(requester_id.eq.${me},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${me})`);
  if (error) throw new Error(`Could not load friendship state (${error.code ?? "unknown"}).`);
  return relationshipFrom((data ?? []) as ConnectionRow[], me, otherId);
}

/** All of the viewer's connection rows with the other person's username. */
async function myRows(supabase: SupabaseClient, me: string) {
  const { data, error } = await supabase
    .from("connections")
    .select(
      "requester_id, addressee_id, status, created_at, requester:profiles!connections_requester_id_fkey(username, avatar_path), addressee:profiles!connections_addressee_id_fkey(username, avatar_path)",
    )
    .or(`requester_id.eq.${me},addressee_id.eq.${me}`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Could not load your friends (${error.code ?? "unknown"}).`);
  return (data ?? []) as unknown as (ConnectionRow & {
    created_at: string;
    requester: { username: string; avatar_path: string | null } | null;
    addressee: { username: string; avatar_path: string | null } | null;
  })[];
}

export async function listConnections(supabase: SupabaseClient, me: string): Promise<{
  incoming: PersonEntry[];
  outgoing: PersonEntry[];
  friends: PersonEntry[];
  /** username -> relationship, for marking search results. */
  byUsername: Record<string, Relationship>;
}> {
  const rows = await myRows(supabase, me);
  const incoming: PersonEntry[] = [];
  const outgoing: PersonEntry[] = [];
  const friends: PersonEntry[] = [];
  const byUsername: Record<string, Relationship> = {};
  for (const r of rows) {
    const iAmRequester = r.requester_id === me;
    const person = iAmRequester ? r.addressee : r.requester;
    const other = person?.username;
    if (!other) continue;
    const entry = { username: other, avatarPath: person?.avatar_path ?? null, since: r.created_at };
    if (r.status === "accepted") {
      friends.push(entry);
      byUsername[other] = "friends";
    } else if (iAmRequester) {
      outgoing.push(entry);
      byUsername[other] = "outgoing";
    } else {
      incoming.push(entry);
      byUsername[other] = "incoming";
    }
  }
  friends.sort((a, b) => a.username.localeCompare(b.username));
  return { incoming, outgoing, friends, byUsername };
}

export interface FriendActivity {
  username: string;
  avatarPath: string | null;
  kind: PlanKind;
  posting: { id: string; title: string; eventDate: string | null; placeLabel: string };
}

/**
 * Friends' Going/Interested on ACTIVE postings. RLS returns only accepted
 * friends' plans on active postings (plus the viewer's own, excluded here); the
 * shared lifecycle rule is applied again so the app and database agree.
 * Exposes only username, plan, and the posting's public title/date/place label.
 */
export async function listFriendActivity(supabase: SupabaseClient, me: string, now = new Date()): Promise<FriendActivity[]> {
  const { data, error } = await supabase
    .from("plans")
    .select(
      "kind, created_at, user_id, profiles!plans_user_id_fkey(username, avatar_path), postings!plans_posting_id_fkey(id, title, event_date, place_label, expires_at, end_date, end_time, time_zone, lat, lng, deleted_at)",
    )
    .neq("user_id", me)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load friends' plans (${error.code ?? "unknown"}).`);
  const out: FriendActivity[] = [];
  for (const r of (data ?? []) as unknown as {
    kind: PlanKind;
    profiles: { username: string; avatar_path: string | null } | null;
    postings: {
      id: string; title: string; event_date: string | null; place_label: string; expires_at: string;
      end_date: string | null; end_time: string | null; time_zone: string | null; lat: number; lng: number; deleted_at: string | null;
    } | null;
  }[]) {
    const p = r.postings;
    if (!p || !r.profiles?.username) continue;
    const lifecycle = {
      expiresAt: p.expires_at, eventDate: p.event_date, endDate: p.end_date, endTime: p.end_time,
      timeZone: p.time_zone, lat: Number(p.lat), lng: Number(p.lng), deletedAt: p.deleted_at,
    };
    if (!isPostingActive(lifecycle, now)) continue;
    out.push({
      username: r.profiles.username,
      avatarPath: r.profiles.avatar_path ?? null,
      kind: r.kind,
      posting: { id: p.id, title: p.title, eventDate: p.event_date, placeLabel: p.place_label ?? "" },
    });
  }
  return out;
}
