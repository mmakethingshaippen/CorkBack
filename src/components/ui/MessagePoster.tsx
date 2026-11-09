"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircleIcon } from "@/components/icons";
import { SignInToTakePart } from "./SignInToTakePart";
import { NavyLink } from "./actions";
import { useMessageComposer } from "./useMessageComposer";

/**
 * "Message the poster" from a posting page. Opens (or reuses) the ONE private
 * conversation with the poster about this posting.
 * - Success: says "Message sent", clears the draft only after the save, then
 *   opens the conversation (with a link in case navigation is slow).
 * - Failure: keeps the draft and explains what happened.
 * - Double clicks and retries never duplicate (see useMessageComposer).
 * Message text never appears on the posting page or the board.
 */
export function MessagePoster({
  posterUsername,
  postingId,
  signedIn,
  isOwnPosting,
}: {
  posterUsername: string;
  postingId: string;
  signedIn: boolean;
  isOwnPosting: boolean;
}) {
  const router = useRouter();
  const c = useMessageComposer(`cb.draft.posting.${postingId}`);
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const autoOpened = useRef(false);

  // Reopen once if a saved draft is restored (e.g. after signing in again).
  useEffect(() => {
    if (c.text && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [c.text]);

  if (isOwnPosting) return null; // never message yourself
  if (!signedIn) return <SignInToTakePart action={`message @${posterUsername} privately`} />;

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const data = await c.send<{ threadId: string }>((body, clientId) =>
      fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postingId, toUsername: posterUsername, body, clientId }),
      }),
    );
    if (data?.threadId) {
      setThreadId(data.threadId);
      router.push(`/inbox/${data.threadId}`);
    }
  }

  const showForm = open || c.status.kind === "sent";
  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-control bg-deep-navy px-5 py-3 font-bold text-white"
      >
        <MessageCircleIcon /> Message @{posterUsername}
        {c.text ? <span className="text-sm font-normal">(draft saved)</span> : null}
      </button>
    );
  }

  return (
    <form onSubmit={onSend} className="space-y-2 rounded-card border border-board bg-card p-4" aria-busy={c.sending}>
      <label htmlFor={`msg-${postingId}`} className="block text-sm font-bold text-ink">
        Private message to @{posterUsername}
      </label>
      <textarea
        id={`msg-${postingId}`}
        value={c.text}
        onChange={(e) => c.setText(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Write a private message…"
        disabled={c.status.kind === "sent"}
        className="w-full rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-deep-navy/30"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!c.text.trim() || c.status.kind === "sent"}
          aria-disabled={c.sending}
          className={`rounded-control bg-deep-navy px-5 py-2 font-bold text-white disabled:opacity-60 ${c.sending ? "cursor-wait opacity-70" : ""}`}
        >
          {c.sending ? "Sending…" : c.status.kind === "error" ? "Try again" : "Send"}
        </button>
        {c.status.kind !== "sent" ? (
          <button
            type="button"
            onClick={() => { setOpen(false); c.setStatus({ kind: "idle" }); }}
            className="rounded-control border border-board px-5 py-2 font-bold text-ink"
          >
            Close
          </button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className={`min-h-[1.25rem] text-sm ${c.status.kind === "error" ? "font-bold text-dark-red" : "text-ink"}`}>
        {c.status.kind === "sending" ? "Sending…" : null}
        {c.status.kind === "sent" ? (
          <>
            Message sent. Opening your conversation…{" "}
            {threadId ? <Link href={`/inbox/${threadId}`} className="font-bold text-deep-navy underline">Open it now</Link> : null}
          </>
        ) : null}
        {c.status.kind === "error" ? (
          <>
            {c.status.text}{" "}
            {c.status.signedOut ? <NavyLink href="/sign-in">Sign in</NavyLink> : null}
          </>
        ) : null}
      </p>
      <p className="text-xs text-ink/60">
        Only you and @{posterUsername} can see this conversation. It never appears on the board or this posting. Closing
        keeps your draft on this device.
      </p>
    </form>
  );
}
