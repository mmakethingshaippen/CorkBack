"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ThreadRow {
  id: string;
  otherHandle: string;
  lastMessage: string | null;
  lastAt: string;
  lastFromMe: boolean;
}

/** Inbox list — only the signed-in user's own threads (RLS-scoped). */
export function InboxList() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/messages/threads");
      const body = await res.json();
      if (res.ok) setThreads(body.threads ?? []);
      else setStatus(body.error ?? "Could not load your inbox.");
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-sm text-ink/60">Loading…</p>;
  if (status) return <p className="text-sm text-dark-red">{status}</p>;
  if (threads.length === 0) {
    return <p className="text-sm text-ink/60">No messages yet. Start one from a posting page.</p>;
  }

  return (
    <ul className="space-y-3">
      {threads.map((t) => (
        <li key={t.id}>
          <Link href={`/inbox/${t.id}`} className="block rounded-card border border-board bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-deep-navy">@{t.otherHandle}</span>
              <span className="text-xs text-ink/50">{new Date(t.lastAt).toLocaleDateString()}</span>
            </div>
            {t.lastMessage ? (
              <p className="mt-1 truncate text-sm text-ink/70">
                {t.lastFromMe ? "You: " : ""}{t.lastMessage}
              </p>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
