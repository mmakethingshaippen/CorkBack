/**
 * Stage 3 — private messaging helpers. Pure, DB-free, testable.
 *
 * A thread is strictly 1:1 between two participants. Only those two may read it
 * or post to it; a third user sees nothing. These helpers encode the ordered
 * pair (so a pair maps to one thread) and the participant check. The database
 * RLS in supabase/stage3_messaging.sql enforces the same rule server-side.
 *
 * Messaging does NOT touch Follow/Connect, adds no Like, and never surfaces
 * message text on the board or a posting page.
 */

/** Order two user ids so a pair always maps to the same (lo, hi). */
export function orderedPair(a: string, b: string): { userLo: string; userHi: string } {
  if (a === b) throw new Error("A thread needs two distinct users.");
  return a < b ? { userLo: a, userHi: b } : { userLo: b, userHi: a };
}

/** Is `userId` one of the thread's two participants? */
export function isParticipant(
  thread: { userLo: string; userHi: string },
  userId: string,
): boolean {
  return userId === thread.userLo || userId === thread.userHi;
}

/** The other participant's id, from the viewer's perspective. */
export function counterpart(
  thread: { userLo: string; userHi: string },
  viewerId: string,
): string | null {
  if (!isParticipant(thread, viewerId)) return null;
  return viewerId === thread.userLo ? thread.userHi : thread.userLo;
}

/** Can this viewer access (read/post to) this thread? Participant-only. */
export function canAccessThread(
  thread: { userLo: string; userHi: string },
  viewerId: string,
): boolean {
  return isParticipant(thread, viewerId);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

/**
 * Idempotency key for one send attempt. The composer keeps the same key while
 * retrying the same draft, and makes a new one after a successful send or when
 * the text changes, so "retry" and "send the same words again" are different.
 */
export function nextClientKey(
  previous: { key: string; text: string } | null,
  text: string,
  makeKey: () => string,
): { key: string; text: string } {
  return previous && previous.text === text ? previous : { key: makeKey(), text };
}

export interface ThreadMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

/** Chronological order with a stable tie-break (server timestamps, then id). */
export function sortMessages<T extends { created_at: string; id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** Merge newly fetched or sent messages into a list without duplicates. */
export function mergeMessages<T extends { created_at: string; id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return sortMessages([...byId.values()]);
}

/**
 * Exactly the characters String.prototype.trim() removes (ECMAScript
 * WhiteSpace + LineTerminator, incl. every Unicode Zs space separator).
 * The database check in supabase/stage6_social_part4.sql uses this same class,
 * written identically, so "blank" means the same thing in the app and the DB.
 * messagingKeys.test.ts proves it matches trim() for every BMP character.
 */
export const MESSAGE_WHITESPACE_CLASS =
  " \\t\\n\\v\\f\\r\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";

/** Validate a message body. Non-empty, trimmed, bounded. */
export const MAX_MESSAGE_LEN = 2000;
export function validateMessageBody(body: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof body !== "string") return { ok: false, error: "Message must be text." };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Message cannot be empty." };
  if (trimmed.length > MAX_MESSAGE_LEN) return { ok: false, error: `Message must be ${MAX_MESSAGE_LEN} characters or fewer.` };
  return { ok: true, value: trimmed };
}
