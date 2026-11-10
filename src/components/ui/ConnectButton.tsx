"use client";

import { useState } from "react";
import { NavyLink } from "./actions";
import { useConnectionAction } from "./useConnectionAction";
import type { ConnectionAction, Relationship } from "@/lib/connectionState";

const outline = "rounded-control border-2 border-deep-navy bg-white px-4 py-2 font-bold text-deep-navy";
const solid = "rounded-control border-2 border-deep-navy bg-deep-navy px-4 py-2 font-bold text-white";
const neutral = "rounded-control border-2 border-board bg-board/40 px-4 py-2 font-bold text-ink";

/**
 * Friendship control on a profile. Two-way and separate from Follow: accepting
 * never adds a follow, and following never sends a request.
 * State comes from a server read; after any action the page refreshes from the
 * server. Remove asks for confirmation.
 */
export function ConnectButton({
  username,
  initialState,
  signedIn,
  isSelf,
}: {
  username: string;
  initialState: Relationship;
  signedIn: boolean;
  isSelf: boolean;
}) {
  const [state, setState] = useState<Relationship>(initialState);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { run, pending, message } = useConnectionAction();

  if (isSelf) return null;
  if (!signedIn) {
    return (
      <p className="text-sm text-ink/70">
        <NavyLink href="/sign-in">Sign in</NavyLink> to add @{username} as a friend.
      </p>
    );
  }

  const busy = Boolean(pending[username]);
  async function act(a: ConnectionAction) {
    const next = await run(a, username);
    if (next) setState(next);
    setConfirmRemove(false);
  }
  const btn = (label: string, a: ConnectionAction, cls: string) => (
    <button type="button" onClick={() => act(a)} aria-disabled={busy} className={`${cls} ${busy ? "cursor-wait opacity-70" : ""}`}>
      {label}
      <span className="sr-only"> @{username}</span>
    </button>
  );

  return (
    <div className="space-y-1" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-3">
        {state === "none" ? btn("Add friend", "send", outline) : null}
        {state === "outgoing" ? (
          <>
            <span className="text-sm font-bold text-ink">Friend request sent</span>
            {btn("Cancel request", "cancel", neutral)}
          </>
        ) : null}
        {state === "incoming" ? (
          <>
            <span className="text-sm font-bold text-ink">@{username} sent you a friend request</span>
            {btn("Accept", "accept", solid)}
            {btn("Decline", "decline", neutral)}
          </>
        ) : null}
        {state === "friends" && !confirmRemove ? (
          <>
            <span className="text-sm font-bold text-ink">You&apos;re friends</span>
            <button type="button" onClick={() => setConfirmRemove(true)} className={neutral}>
              Remove friend<span className="sr-only"> @{username}</span>
            </button>
          </>
        ) : null}
        {state === "friends" && confirmRemove ? (
          <>
            <span className="text-sm font-bold text-ink">Remove @{username} from your friends?</span>
            {btn("Yes, remove", "remove", outline)}
            <button type="button" onClick={() => setConfirmRemove(false)} className={neutral}>
              Keep
            </button>
          </>
        ) : null}
      </div>
      <p className="text-xs text-ink/60">
        Friends see each other&apos;s Going/Interested on active postings. Friendship is separate from Follow.
      </p>
      <p role="status" aria-live="polite" className={`min-h-[1rem] text-sm ${message?.tone === "error" ? "text-dark-red" : "text-ink/70"}`}>
        {busy ? "Saving…" : message?.text}
      </p>
    </div>
  );
}
