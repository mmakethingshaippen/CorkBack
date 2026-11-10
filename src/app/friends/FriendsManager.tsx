"use client";

import { useEffect, useRef, useState } from "react";
import { PosterHandle } from "@/components/ui/PosterHandle";
import { useConnectionAction } from "@/components/ui/useConnectionAction";
import type { ConnectionAction, Relationship } from "@/lib/connectionState";

type Person = { username: string; since: string };
type Result = { username: string; state: Relationship };

const outline = "rounded-control border-2 border-deep-navy bg-white px-4 py-1.5 text-sm font-bold text-deep-navy";
const solid = "rounded-control border-2 border-deep-navy bg-deep-navy px-4 py-1.5 text-sm font-bold text-white";
const neutral = "rounded-control border-2 border-board bg-board/40 px-4 py-1.5 text-sm font-bold text-ink";

/**
 * Search plus incoming / outgoing / friends lists. Lists are rendered from
 * server props, and every action refreshes them from the server, so they always
 * reflect the database (including changes made in another session).
 */
export function FriendsManager({ incoming, outgoing, friends }: { incoming: Person[]; outgoing: Person[]; friends: Person[] }) {
  const { run, pending, message } = useConnectionAction();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "short" | "loading" | "error" | "done">("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); setSearchState("idle"); return; }
    if (term.length < 2) { setResults(null); setSearchState("short"); return; }
    if (!/^[A-Za-z0-9_]{2,20}$/.test(term)) {
      setResults(null); setSearchState("error"); setSearchError("Usernames use only letters, numbers, and underscores."); return;
    }
    const mine = ++seq.current;
    setSearchState("loading");
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(term)}`);
        const data = (await res.json().catch(() => ({}))) as { results?: Result[]; error?: string };
        if (mine !== seq.current) return; // a newer search started
        if (!res.ok) { setSearchState("error"); setSearchError(data.error ?? "Search failed. Try again."); return; }
        setResults(data.results ?? []); setSearchState("done");
      } catch {
        if (mine !== seq.current) return;
        setSearchState("error"); setSearchError("Could not reach CorkBack. Check your connection and try again.");
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function act(a: ConnectionAction, username: string) {
    const next = await run(a, username);
    setConfirm(null);
    if (next && results) setResults(results.map((r) => (r.username === username ? { ...r, state: next } : r)));
  }

  const busy = (u: string) => Boolean(pending[u]);
  const button = (label: string, a: ConnectionAction, u: string, cls: string) => (
    <button type="button" onClick={() => act(a, u)} aria-disabled={busy(u)} className={`${cls} ${busy(u) ? "cursor-wait opacity-70" : ""}`}>
      {label}<span className="sr-only"> @{u}</span>
    </button>
  );
  const controls = (u: string, state: Relationship) => {
    if (busy(u)) return <span className="text-sm text-ink/70" role="status">Saving…</span>;
    if (state === "none") return button("Add friend", "send", u, outline);
    if (state === "outgoing") return <>{<span className="text-sm text-ink/70">Request sent</span>}{button("Cancel request", "cancel", u, neutral)}</>;
    if (state === "incoming") return <>{button("Accept", "accept", u, solid)}{button("Decline", "decline", u, neutral)}</>;
    if (confirm === u) {
      return (
        <>
          <span className="text-sm text-ink">Remove @{u}?</span>
          {button("Yes, remove", "remove", u, outline)}
          <button type="button" onClick={() => setConfirm(null)} className={neutral}>Keep</button>
        </>
      );
    }
    return (
      <>
        <span className="text-sm text-ink/70">Friends</span>
        <button type="button" onClick={() => setConfirm(u)} className={neutral}>Remove friend<span className="sr-only"> @{u}</span></button>
      </>
    );
  };

  const list = (title: string, id: string, people: Person[], state: Relationship, empty: string) => (
    <section aria-labelledby={id} className="rounded-card border border-board bg-white p-4">
      <h2 id={id} className="text-lg font-bold text-ink">
        {title} <span className="text-sm font-normal text-ink/60">({people.length})</span>
      </h2>
      {people.length === 0 ? (
        <p className="mt-1 text-sm text-ink/60">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-board">
          {people.map((p) => (
            <li key={p.username} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <PosterHandle username={p.username} />
              <span className="flex flex-wrap items-center gap-2">{controls(p.username, state)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className={`min-h-[1.25rem] text-sm ${message?.tone === "error" ? "font-bold text-dark-red" : "text-ink/80"}`}>
        {message?.text}
      </p>

      <section aria-labelledby="find-friends" className="rounded-card border border-board bg-white p-4">
        <h2 id="find-friends" className="text-lg font-bold text-ink">Find friends</h2>
        <label htmlFor="friend-search" className="mt-2 block text-sm font-bold text-ink">Search by username</label>
        <input
          id="friend-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Start typing a username"
          autoComplete="off"
          maxLength={20}
          className="mt-1 w-full rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-deep-navy/30"
          aria-describedby="friend-search-status"
        />
        <p id="friend-search-status" role="status" aria-live="polite" className="mt-1 text-sm text-ink/70">
          {searchState === "short" ? "Type at least 2 characters." : null}
          {searchState === "loading" ? "Searching…" : null}
          {searchState === "error" ? searchError : null}
          {searchState === "done" && results?.length === 0 ? `No usernames start with "${q.trim()}".` : null}
          {searchState === "done" && results && results.length > 0 ? `${results.length} found.` : null}
        </p>
        {searchState === "done" && results && results.length > 0 ? (
          <ul className="mt-2 divide-y divide-board">
            {results.map((r) => (
              <li key={r.username} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <PosterHandle username={r.username} />
                <span className="flex flex-wrap items-center gap-2">{controls(r.username, r.state)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {list("Requests for you", "incoming", incoming, "incoming", "No friend requests right now.")}
      {list("Requests you sent", "outgoing", outgoing, "outgoing", "You have no pending requests.")}
      {list("Friends", "friends", friends, "friends", "No friends yet. Search above to send a request.")}
    </div>
  );
}
