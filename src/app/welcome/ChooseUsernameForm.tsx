"use client";

import { useRef, useState } from "react";
import { Field } from "@/components/ui/Field";
import { NavyLink } from "@/components/ui/actions";
import { usernameRejection } from "@/lib/domain";

/** Choose a username for an account that has none yet. One request at a time. */
export function ChooseUsernameForm({ next }: { next: string }) {
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "error"; text: string; signedOut?: boolean }>({ kind: "idle", text: "" });
  const lock = useRef(false);
  const liveError = username.length > 0 ? usernameRejection(username) : null;
  const sending = status.kind === "sending";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    const rejection = usernameRejection(username);
    if (rejection) return setStatus({ kind: "error", text: rejection });
    lock.current = true;
    setStatus({ kind: "sending", text: "Saving…" });
    try {
      const res = await fetch("/api/profile/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (res.ok) {
        window.location.href = next;
        return;
      }
      setStatus({ kind: "error", text: body.error ?? "Couldn't save your username. Please try again.", signedOut: body.code === "signed_out" });
    } catch {
      setStatus({ kind: "error", text: "Couldn't reach CorkBack. Check your connection and try again." });
    } finally {
      lock.current = false;
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field
        label="Username"
        name="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        hint="3–20 characters · letters, numbers, underscore · your only public name"
        autoComplete="username"
      />
      {liveError ? <p className="text-sm text-dark-red">{liveError}</p> : null}
      <button
        type="submit"
        disabled={!!liveError || !username}
        aria-disabled={sending}
        className={`w-full rounded-control bg-dark-red px-5 py-3 font-bold text-white disabled:opacity-60 ${sending ? "cursor-wait opacity-70" : ""}`}
      >
        {sending ? "Saving…" : "Save username"}
      </button>
      <p role="status" aria-live="polite" className={`min-h-[1.25rem] text-sm ${status.kind === "error" ? "font-bold text-dark-red" : "text-ink/70"}`}>
        {status.text} {status.signedOut ? <NavyLink href="/sign-in">Sign in</NavyLink> : null}
      </p>
    </form>
  );
}
