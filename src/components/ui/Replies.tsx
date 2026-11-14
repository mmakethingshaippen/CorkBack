"use client";

import { useRef, useState } from "react";
import { PosterHandle } from "./PosterHandle";
import { NavyLink } from "./actions";
import { useMessageComposer } from "./useMessageComposer";
import { REPLY_MAX, addReply, type ReplyView } from "@/lib/replies";

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/**
 * Public replies on a posting: plain-text comments, oldest first. Replies have
 * NO likes and cannot be edited (locked). A reply's author can delete it after
 * confirming. Signed-out visitors read and see a sign-in prompt; ended postings
 * keep their replies readable but closed to new ones.
 * Composer: the shared draft/idempotency logic (one send at a time, the same
 * key while retrying the same draft, draft kept until the server confirms).
 */
export function Replies({
  postingId,
  initial,
  signedIn,
  viewerId,
  open,
}: {
  postingId: string;
  initial: ReplyView[];
  signedIn: boolean;
  viewerId: string | null;
  /** The posting is active, so new replies are accepted. */
  open: boolean;
}) {
  const [replies, setReplies] = useState(initial);
  const c = useMessageComposer(`cb.draft.reply.${postingId}`);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const lock = useRef(false);
  const list = useRef<HTMLUListElement>(null);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const data = await c.send<{ id: string; reply: ReplyView | null }>((body, clientId) =>
      fetch(`/api/postings/${postingId}/replies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, clientId }),
      }),
    );
    if (data?.reply) setReplies((cur) => addReply(cur, data.reply as ReplyView));
    if (data) c.setStatus({ kind: "sent", text: "Reply posted." });
  }

  async function remove(id: string) {
    if (lock.current) return;
    lock.current = true;
    setDeleting(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/replies/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteError(d.error ?? "Couldn't delete the reply. Try again.");
        return;
      }
      setReplies((cur) => cur.filter((r) => r.id !== id));
      setConfirmId(null);
      // Keep keyboard focus inside the list after the row disappears.
      setTimeout(() => (document.getElementById(`replies-h-${postingId}`) as HTMLElement | null)?.focus(), 0);
    } catch {
      setDeleteError("Couldn't reach CorkBack. Nothing was deleted; try again.");
    } finally {
      lock.current = false;
      setDeleting(null);
    }
  }

  const tooLong = c.text.trim().length > REPLY_MAX;

  return (
    <section aria-labelledby={`replies-h-${postingId}`}>
      <h2 id={`replies-h-${postingId}`} tabIndex={-1} className="mb-2 text-lg font-bold text-ink outline-none">
        Replies{replies.length ? ` (${replies.length})` : ""}
      </h2>

      {replies.length === 0 ? (
        <p className="text-sm text-ink/60">{open ? "Be the first to reply." : "No replies were left on this posting."}</p>
      ) : (
        <ul ref={list} className="space-y-3">
          {replies.map((r) => (
            <li key={r.id} className="rounded-card border border-board bg-white p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <PosterHandle username={r.authorUsername} avatarPath={r.authorAvatarPath ?? null} />
                <time dateTime={r.createdAt} className="text-xs text-ink/60">{dateLabel(r.createdAt)}</time>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-ink">{r.body}</p>
              {viewerId && r.authorId === viewerId ? (
                confirmId === r.id ? (
                  <div
                    role="alertdialog"
                    aria-modal="false"
                    aria-label="Delete this reply?"
                    onKeyDown={(e) => { if (e.key === "Escape") setConfirmId(null); }}
                    className="mt-2 rounded-card border-2 border-dark-red p-2 text-sm"
                  >
                    <p className="font-bold text-ink">Delete this reply? This can&apos;t be undone.</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        autoFocus
                        onClick={() => setConfirmId(null)}
                        disabled={deleting === r.id}
                        className="inline-flex min-h-[44px] items-center rounded-control border border-board bg-white px-4 font-bold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy"
                      >
                        Keep it
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        disabled={deleting === r.id}
                        className="inline-flex min-h-[44px] items-center rounded-control border-2 border-dark-red bg-white px-4 font-bold text-dark-red disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy"
                      >
                        {deleting === r.id ? "Deleting…" : "Yes, delete it"}
                      </button>
                    </div>
                    <p role="status" aria-live="polite" className="mt-1 min-h-[1.25rem] font-bold text-dark-red">{deleteError}</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setConfirmId(r.id); setDeleteError(null); }}
                    aria-label={`Delete your reply: ${r.body.slice(0, 40)}`}
                    className="mt-1 inline-flex min-h-[44px] items-center rounded-control border border-board bg-white px-4 text-sm font-bold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy"
                  >
                    Delete
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {!signedIn ? (
          <p className="text-sm text-ink/60">
            <NavyLink href="/sign-in">Sign in</NavyLink> to reply. Replies are public comments on this posting.
          </p>
        ) : !open ? (
          <p role="status" className="text-sm text-ink/60">This posting has ended, so new replies are closed.</p>
        ) : (
          <form onSubmit={onSend} aria-busy={c.sending} className="space-y-2 rounded-card border border-board bg-card p-4">
            <label htmlFor={`reply-${postingId}`} className="block text-sm font-bold text-ink">Add a public reply</label>
            <textarea
              id={`reply-${postingId}`}
              value={c.text}
              onChange={(e) => c.setText(e.target.value)}
              rows={3}
              maxLength={REPLY_MAX + 200}
              placeholder="Write a public reply…"
              aria-describedby={`reply-hint-${postingId}`}
              className="w-full rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-deep-navy/30"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={!c.text.trim() || tooLong || c.sending}
                aria-disabled={c.sending}
                className={`inline-flex min-h-[44px] items-center rounded-control bg-deep-navy px-5 font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy focus-visible:ring-offset-2 disabled:opacity-60 ${c.sending ? "cursor-wait" : ""}`}
              >
                {c.sending ? "Posting…" : c.status.kind === "error" ? "Try again" : "Post reply"}
              </button>
              <span id={`reply-hint-${postingId}`} className={`text-xs ${tooLong ? "font-bold text-dark-red" : "text-ink/60"}`}>
                {c.text.trim().length} / {REPLY_MAX}
              </span>
            </div>
            <p role="status" aria-live="polite" className={`min-h-[1.25rem] text-sm ${c.status.kind === "error" ? "font-bold text-dark-red" : "text-ink"}`}>
              {c.status.kind === "sending" ? "Posting…" : null}
              {c.status.kind === "sent" ? "Reply posted." : null}
              {c.status.kind === "error" ? (
                <>
                  {c.status.text} {c.status.signedOut ? <NavyLink href="/sign-in">Sign in</NavyLink> : null}
                </>
              ) : null}
            </p>
            <p className="text-xs text-ink/60">Replies are public and can&apos;t be edited. You can delete your own.</p>
          </form>
        )}
      </div>
    </section>
  );
}
