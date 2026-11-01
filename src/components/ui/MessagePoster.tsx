"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircleIcon } from "@/components/icons";
import { SignInToTakePart } from "./SignInToTakePart";

/**
 * Entry point to start a private thread with the poster from a posting page.
 * Signed-in only. Hidden on the viewer's own posting. Message text is never
 * shown on the posting page — it only opens a composer and, on send, routes to
 * the private thread in the inbox. No Like, no public display of the message.
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
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (isOwnPosting) return null; // never message yourself

  if (!signedIn) {
    return <SignInToTakePart action={`message @${posterUsername} privately`} />;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setStatus(null);
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toUsername: posterUsername, postingId, body }),
    });
    const data = await res.json();
    setSending(false);
    if (res.ok) {
      router.push(`/inbox/${data.threadId}`);
    } else {
      setStatus(data.error ?? "Could not send the message.");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-control bg-deep-navy px-5 py-3 font-bold text-white"
      >
        <MessageCircleIcon /> Message @{posterUsername}
      </button>
    );
  }

  return (
    <form onSubmit={send} className="space-y-2 rounded-card border border-board bg-card p-4">
      <p className="text-sm font-bold text-ink">Private message to @{posterUsername}</p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Write a private message…"
        className="w-full rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="rounded-control bg-deep-navy px-5 py-2 font-bold text-white disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-control border border-board px-5 py-2 font-bold text-ink">
          Cancel
        </button>
      </div>
      <p className="text-xs text-ink/60">Only you and @{posterUsername} can see this thread. It never appears on the board or this posting.</p>
      {status ? <p className="text-sm text-dark-red">{status}</p> : null}
    </form>
  );
}
