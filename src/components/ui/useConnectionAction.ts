"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConnectionAction, Relationship } from "@/lib/connectionState";

const SUCCESS: Record<ConnectionAction, (u: string) => string> = {
  send: (u) => `Friend request sent to @${u}.`,
  cancel: (u) => `Request to @${u} cancelled.`,
  accept: (u) => `You and @${u} are now friends.`,
  decline: (u) => `Request from @${u} declined.`,
  remove: (u) => `@${u} removed from your friends.`,
};

/**
 * Runs a friendship action against /api/connections. One action per username at
 * a time (extra clicks are ignored while it is in flight). After any response
 * the server-rendered lists are refreshed so they always match the database.
 */
export function useConnectionAction() {
  const router = useRouter();
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<Record<string, ConnectionAction>>({});
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  async function run(action: ConnectionAction, username: string): Promise<Relationship | null> {
    if (inFlight.current.has(username)) return null;
    inFlight.current.add(username);
    setPending((p) => ({ ...p, [username]: action }));
    setMessage(null);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, username }),
      });
      const data = (await res.json().catch(() => ({}))) as { state?: Relationship; error?: string; code?: string };
      if (!res.ok) {
        if (data.code === "signed_out") {
          // Don't refresh: a signed-out re-render would replace this control and
          // drop the message. Keep the page as-is and say what to do.
          setMessage({ text: "Your session has ended. Sign in again to continue.", tone: "error" });
          return null;
        }
        setMessage({ text: data.error ?? "Could not save. Try again.", tone: "error" });
        router.refresh(); // e.g. 409 state_changed: re-sync the lists with the server
        return data.state ?? null;
      }
      setMessage({ text: SUCCESS[action](username), tone: "ok" });
      router.refresh();
      return data.state ?? null;
    } catch {
      setMessage({ text: "Could not reach CorkBack. Check your connection and try again.", tone: "error" });
      return null;
    } finally {
      inFlight.current.delete(username);
      setPending((p) => {
        const next = { ...p };
        delete next[username];
        return next;
      });
    }
  }

  return { run, pending, message, setMessage };
}
