"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

/**
 * Thread view for a participant. Loads the thread's messages (RLS returns rows
 * only if the viewer is a participant — a third user gets an empty thread) and
 * lets the participant reply inside the thread.
 */
export function ThreadView({ threadId, viewerId }: { threadId: string; viewerId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await fetch(`/api/messages?threadId=${encodeURIComponent(threadId)}`);
    const data = await res.json();
    if (res.ok) setMessages(data.messages ?? []);
    else setStatus(data.error ?? "Could not load this thread.");
    setLoading(false);
  }

  useEffect(() => {
    load();
    // load depends only on threadId; it is defined inline and safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);
  useEffect(() => { endRef.current?.scrollIntoView(); }, [messages]);

  async function reply(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    // Reply within the thread: send to the same thread by re-using the API with
    // the counterpart resolved server-side. We send by threadId-aware path:
    // the API finds the existing thread for the pair, so we send to the other
    // participant. Simplest: re-fetch the thread's other participant via a
    // dedicated reply call.
    const res = await fetch("/api/messages/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, body: text }),
    });
    const data = await res.json();
    if (res.ok) { setBody(""); setStatus(null); await load(); }
    else setStatus(data.error ?? "Could not send your reply.");
  }

  if (loading) return <p className="text-sm text-ink/60">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {messages.length === 0 ? (
          <p className="text-sm text-ink/60">No messages in this thread.</p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === viewerId;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${mine ? "bg-deep-navy text-white" : "border border-board bg-card text-ink"}`}>
                  {m.body}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={reply} className="flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Reply…"
          className="flex-1 rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none"
        />
        <button type="submit" disabled={!body.trim()} className="rounded-control bg-deep-navy px-5 py-2 font-bold text-white disabled:opacity-60">
          Send
        </button>
      </form>
      {status ? <p className="text-sm text-dark-red">{status}</p> : null}
    </div>
  );
}
