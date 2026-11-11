/**
 * Public replies — pure helpers. Replies are public comments on a posting.
 * There is NO like (or any reaction) on replies (locked), and replies are not
 * editable. The database function submit_reply() is the enforcement; this file
 * shares its rules and maps its errors.
 */
import { MESSAGE_WHITESPACE_CLASS } from "./messaging";
import type { ApiFailure } from "./moderation";

export const REPLY_MAX = 1000;
export const REPLY_RATE_LIMIT_TEXT = "10 replies in 10 minutes";

// Same whitespace class as the database (replies_body_valid / cb_has_text).
const HAS_TEXT = new RegExp(`[^${MESSAGE_WHITESPACE_CLASS}]`);

export function validateReplyBody(body: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof body !== "string") return { ok: false, error: "A reply must be text." };
  const t = body.trim();
  if (!HAS_TEXT.test(t)) return { ok: false, error: "A reply can't be empty." };
  if (t.length > REPLY_MAX) return { ok: false, error: `A reply must be ${REPLY_MAX} characters or fewer.` };
  return { ok: true, value: t };
}

/** Map a submit_reply database error (SQLSTATE) to an HTTP response. */
export function replyErrorResponse(code: string | undefined): ApiFailure {
  switch (code) {
    case "42501":
      return { status: 401, code: "signed_out", error: "Sign in to reply. Your draft is kept." };
    case "CB404":
      return { status: 404, code: "not_found", error: "This posting isn't available, so it can't take replies." };
    case "CB409":
      return { status: 409, code: "ended", error: "This posting has ended. Replies are closed, and the earlier ones stay readable." };
    case "CB413":
      return { status: 413, code: "too_long", error: `A reply must be ${REPLY_MAX} characters or fewer.` };
    case "CB422":
      return { status: 400, code: "invalid_body", error: "A reply can't be empty." };
    case "CB429":
      return { status: 429, code: "rate_limited", error: `You've reached the limit of ${REPLY_RATE_LIMIT_TEXT}. Your draft is kept; try again in a few minutes.` };
    case "CB400":
      return { status: 400, code: "invalid", error: "Missing send id. Refresh the page and try again." };
    default:
      return { status: 500, code: "failed", error: "Your reply wasn't sent. Your draft is kept, so you can try again." };
  }
}

export interface ReplyView {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorUsername: string;
}

/** Oldest first with a stable tie-break. */
export function sortReplies<T extends { createdAt: string; id: string }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** Add a reply to a list unless it is already there (retries and refreshes never duplicate). */
export function addReply<T extends { id: string; createdAt: string }>(list: T[], reply: T): T[] {
  return list.some((r) => r.id === reply.id) ? list : sortReplies([...list, reply]);
}
