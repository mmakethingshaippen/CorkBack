"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NavyLink } from "@/components/ui/actions";
import { useMessageComposer } from "@/components/ui/useMessageComposer";
import { mergeMessages, type ThreadMessage } from "@/lib/messaging";

/**
 * A private conversation. Participants only (the page 404s for anyone else,
 * and RLS returns nothing to them).
 *
 * How it updates (no real-time push): messages load when the page opens, after
 * you send, when the tab regains focus or becomes visible, and when you press
 * "Check for new messages". Messages are shown oldest first by server time.
 */
export function ThreadView({ threadId, viewerId, otherHandle }: { threadId: string; viewerId: string; otherHandle: string }) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "signed_out">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const c = useMessageComposer(`cb.draft.thread.${threadId}`);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/messages?threadId=${encodeURIComponent(threadId)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { messages?: ThreadMessage[]; error?: string; code?: string };
      if (res.status === 401) { setPhase("signed_out"); return; }
      if (!res.ok) { setLoadError(data.error ?? "Couldn't load messages."); setPhase((p) => (p === "ready" ? "ready" : "error")); return; }
      setMessages((cur) => mergeMessages(cur, data.messages ?? []));
      setLoadError(null);
      setPhase("ready");
      setLastChecked(new Date());
    } catch {
      setLoadError("Couldn't reach CorkBack. Check your connection.");
      setPhase((p) => (p === "ready" ? "ready" : "error"));
    } finally {
      setChecking(false);
    }
  }, [threadId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onFocus = () => load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  async function onReply(e: React.FormEvent) {
    e.preventDefault();
    const data = await c.send<{ message: ThreadMessage }>((body, clientId) =>
      fetch("/api/messages/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, body, clientId }),
      }),
    );
    if (data?.message) {
      setMessages((cur) => mergeMessages(cur, [data.message]));
      load(); // also picks up anything the other person sent meanwhile
    }
  }

  if (phase === "loading") return <p role="status" className="text-sm text-ink/60">Loading messages…</p>;
  if (phase === "signed_out") {
    return (
      <p role="alert" className="text-sm text-ink">
        Your session has ended. <NavyLink href="/sign-in">Sign in again</NavyLink> to read this conversation.
      </p>
    );
  }
  if (phase === "error") {
    return (
      <div role="alert" className="space-y-2 rounded-card border-2 border-dark-red bg-white p-4 text-sm">
        <p className="font-bold text-ink">This conversation couldn&apos;t load.</p>
        <p className="text-ink/70">{loadError}</p>
        <button type="button" onClick={() => { setPhase("loading"); load(); }} className="rounded-control border-2 border-deep-navy px-4 py-1.5 font-bold text-deep-navy">
          Try again
        </button>
      </div>
    );
  }

  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="space-y-4">
      <div role="log" aria-live="polite" aria-label={`Conversation with @${otherHandle}`} className="space-y-2">
        {messages.length === 0 ? (
          <p className="text-sm text-ink/60">No messages yet. Say hello below.</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === viewerId;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-card px-3 py-2 text-sm ${mine ? "bg-deep-navy text-white" : "border border-board bg-card text-ink"}`}>
                  <span className="sr-only">{mine ? "You" : `@${otherHandle}`}: </span>
                  <span className="whitespace-pre-wrap break-words">{m.body}</span>
                  <span className={`mt-1 block text-[11px] ${mine ? "text-white/70" : "text-ink/50"}`}>
                    <time dateTime={m.created_at}>{fmt(m.created_at)}</time>
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink/60">
        <span>
          Updates when you open or return to this page, or check below.{" "}
          {lastChecked ? <>Last checked <time dateTime={lastChecked.toISOString()}>{lastChecked.toLocaleTimeString()}</time>.</> : null}
        </span>
        <button type="button" onClick={load} aria-disabled={checking} className="font-bold text-deep-navy underline-offset-2 hover:underline">
          {checking ? "Checking…" : "Check for new messages"}
        </button>
      </div>
      {loadError ? <p role="alert" className="text-sm text-dark-red">{loadError}</p> : null}

      <form onSubmit={onReply} className="space-y-2" aria-busy={c.sending}>
        <label htmlFor="reply-box" className="sr-only">Reply to @{otherHandle}</label>
        <div className="flex gap-2">
          <textarea
            id="reply-box"
            value={c.text}
            onChange={(e) => c.setText(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Reply…"
            className="min-w-0 flex-1 rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-deep-navy/30"
          />
          <button
            type="submit"
            disabled={!c.text.trim()}
            aria-disabled={c.sending}
            className={`self-end rounded-control bg-deep-navy px-5 py-2 font-bold text-white disabled:opacity-60 ${c.sending ? "cursor-wait opacity-70" : ""}`}
          >
            {c.sending ? "Sending…" : c.status.kind === "error" ? "Try again" : "Send"}
          </button>
        </div>
        <p role="status" aria-live="polite" className={`min-h-[1.25rem] text-sm ${c.status.kind === "error" ? "font-bold text-dark-red" : "text-ink/70"}`}>
          {c.status.kind === "sent" ? "Message sent." : null}
          {c.status.kind === "error" ? (
            <>
              {c.status.text} {c.status.signedOut ? <NavyLink href="/sign-in">Sign in</NavyLink> : null}
            </>
          ) : null}
        </p>
      </form>
    </div>
  );
}
