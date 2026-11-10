"use client";

import { useEffect, useRef, useState } from "react";
import { nextClientKey } from "@/lib/messaging";

export type ComposerStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; text: string }
  | { kind: "error"; text: string; signedOut?: boolean };

/**
 * Shared composer logic for "message the poster" and thread replies.
 * - One send at a time (a ref lock ignores double clicks / double submits).
 * - Idempotency: the same key is reused while retrying the SAME draft, so a
 *   retry after a lost response never duplicates; after a successful send (or
 *   when the text changes) a new key is used, so sending the same words again
 *   on purpose creates a new message.
 * - The draft is cleared only after the server confirms the save, and is kept
 *   in sessionStorage (this tab) until then, so it survives a failed send,
 *   a refresh, or signing in again.
 */
export function useMessageComposer(draftKey: string) {
  const [text, setTextState] = useState("");
  const [status, setStatus] = useState<ComposerStatus>({ kind: "idle" });
  const lock = useRef(false);
  const attempt = useRef<{ key: string; text: string } | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) setTextState(saved);
    } catch {
      /* storage unavailable: drafts just aren't persisted */
    }
  }, [draftKey]);

  function setText(v: string) {
    setTextState(v);
    if (status.kind === "sent" || status.kind === "error") setStatus({ kind: "idle" });
    try {
      if (v) sessionStorage.setItem(draftKey, v);
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  }

  async function send<T>(post: (body: string, clientId: string) => Promise<Response>): Promise<T | null> {
    const body = text.trim();
    if (!body || lock.current) return null;
    lock.current = true;
    attempt.current = nextClientKey(attempt.current, body, () => crypto.randomUUID());
    setStatus({ kind: "sending" });
    try {
      const res = await post(body, attempt.current.key);
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & T;
      if (!res.ok) {
        setStatus({
          kind: "error",
          signedOut: data.code === "signed_out",
          text: data.error ?? "Your message wasn't sent. Your draft is kept, so you can try again.",
        });
        return null;
      }
      // Saved: clear the draft and start a fresh key for the next message.
      attempt.current = null;
      setTextState("");
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      setStatus({ kind: "sent", text: "Message sent." });
      return data;
    } catch {
      setStatus({ kind: "error", text: "Couldn't reach CorkBack. Your draft is kept; check your connection and try again." });
      return null;
    } finally {
      lock.current = false;
    }
  }

  return { text, setText, status, setStatus, send, sending: status.kind === "sending" };
}
