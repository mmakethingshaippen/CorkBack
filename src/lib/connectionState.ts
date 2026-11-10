/**
 * Pure friendship (Connect) rules. A friendship is one row in `connections`
 * between two users: pending (requester -> addressee) or accepted. Following is
 * a separate system and is never read or written here.
 */

export type Relationship = "none" | "outgoing" | "incoming" | "friends";
export type ConnectionAction = "send" | "cancel" | "accept" | "decline" | "remove";

export const CONNECTION_ACTIONS: ConnectionAction[] = ["send", "cancel", "accept", "decline", "remove"];

export interface ConnectionRow {
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
}

/** The viewer's relationship with `otherId`, given the rows the viewer can see. */
export function relationshipFrom(rows: ConnectionRow[], me: string, otherId: string): Relationship {
  const row = rows.find(
    (r) =>
      (r.requester_id === me && r.addressee_id === otherId) ||
      (r.requester_id === otherId && r.addressee_id === me),
  );
  if (!row) return "none";
  if (row.status === "accepted") return "friends";
  return row.requester_id === me ? "outgoing" : "incoming";
}

/** Which actions make sense from a relationship state (the server re-checks everything). */
export function allowedActions(rel: Relationship): ConnectionAction[] {
  switch (rel) {
    case "none":
      return ["send"];
    case "outgoing":
      return ["cancel"];
    case "incoming":
      return ["accept", "decline"];
    case "friends":
      return ["remove"];
  }
}

/** The state an action leads to when it succeeds. */
export function resultingRelationship(action: ConnectionAction): Relationship {
  return action === "send" ? "outgoing" : action === "accept" ? "friends" : "none";
}

export function parseConnectionBody(b: unknown):
  | { ok: true; action: ConnectionAction; username: string }
  | { ok: false } {
  if (!b || typeof b !== "object") return { ok: false };
  const { action, username } = b as Record<string, unknown>;
  if (typeof action !== "string" || !CONNECTION_ACTIONS.includes(action as ConnectionAction)) return { ok: false };
  if (typeof username !== "string") return { ok: false };
  return { ok: true, action: action as ConnectionAction, username };
}

/** Search query: 2-20 characters of the username alphabet. */
export const SEARCH_RE = /^[A-Za-z0-9_]{2,20}$/;

/** ILIKE prefix pattern with LIKE wildcards escaped (usernames may contain "_"). */
export function prefixPattern(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";
}
