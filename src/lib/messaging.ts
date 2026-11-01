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

/** Validate a message body. Non-empty, trimmed, bounded. */
export const MAX_MESSAGE_LEN = 2000;
export function validateMessageBody(body: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof body !== "string") return { ok: false, error: "Message must be text." };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Message cannot be empty." };
  if (trimmed.length > MAX_MESSAGE_LEN) return { ok: false, error: `Message must be ${MAX_MESSAGE_LEN} characters or fewer.` };
  return { ok: true, value: trimmed };
}
