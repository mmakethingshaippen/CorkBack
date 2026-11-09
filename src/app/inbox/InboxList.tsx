"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NavyLink } from "@/components/ui/actions";

interface ThreadRow {
  id: string;
  postingTitle: string | null;
  otherHandle: string;
  lastMessage: string | null;
  lastAt: string;
  lastFromMe: boolean;
}

/**
 * Your conversations only (RLS), most recent activity first. Reloads when the
 * tab regains focus; there is no real-time push.
 */
export function InboxList() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "signed_out">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/messages/threads", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { threads?: ThreadRow[]; error?: string };
      if (res.status === 401) { setPhase("signed_out"); return; }
      if (!res.ok) { setError(body.error ?? "Couldn't load your messages."); setPhase("error"); return; }
      setThreads(body.threads ?? []);
      setPhase("ready");
    } catch {
      setError("Couldn't reach CorkBack. Check your connection.");
      setPhase("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  if (phase === "loading") return <p role="status" className="text-sm text-ink/60">Loading your messages…</p>;
  if (phase === "signed_out") {
    return (
      <p role="alert" className="text-sm text-ink">
        Your session has ended. <NavyLink href="/sign-in">Sign in again</NavyLink> to see your messages.
      </p>
    );
  }
  if (phase === "error") {
    return (
      <div role="alert" className="space-y-2 rounded-card border-2 border-dark-red bg-white p-4 text-sm">
        <p className="font-bold text-ink">Your messages couldn&apos;t load.</p>
        <p className="text-ink/70">{error}</p>
        <button type="button" onClick={() => { setPhase("loading"); load(); }} className="rounded-control border-2 border-deep-navy px-4 py-1.5 font-bold text-deep-navy">
          Try again
        </button>
      </div>
    );
  }
  if (threads.length === 0) {
    return <p className="text-sm text-ink/60">No messages yet. Open a posting and choose &quot;Message&quot; to contact its poster.</p>;
  }

  return (
    <ul className="space-y-3" aria-label="Your conversations">
      {threads.map((t) => (
        <li key={t.id}>
          <Link href={`/inbox/${t.id}`} className="block rounded-card border border-board bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-deep-navy">@{t.otherHandle}</span>
              <time dateTime={t.lastAt} className="shrink-0 text-xs text-ink/50">{new Date(t.lastAt).toLocaleDateString()}</time>
            </div>
            {t.postingTitle ? <p className="truncate text-xs text-ink/60">About: {t.postingTitle}</p> : null}
            {t.lastMessage ? (
              <p className="mt-1 truncate text-sm text-ink/70">
                {t.lastFromMe ? "You: " : ""}
                {t.lastMessage}
              </p>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
