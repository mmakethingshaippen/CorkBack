"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { NavyLink } from "@/components/ui/actions";
import { normalizeUsername, usernameRejection } from "@/lib/domain";
/**
 * Owner-only inline rename on the profile page. Same style as ChooseUsernameForm:
 * one input, live validation with usernameRejection, Save and Cancel. One request
 * at a time. Postings, follows, connections and messages use the user id, so a
 * rename changes none of them.
 */
export function EditUsernameForm({ current }: { current: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(current);
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "error"; text: string; signedOut?: boolean }>({ kind: "idle", text: "" });
  const lock = useRef(false);
  const liveError = username.length > 0 ? usernameRejection(username) : null;
  const sending = status.kind === "sending";
  function close() {
    setOpen(false);
    setUsername(current);
    setStatus({ kind: "idle", text: "" });
  }
  if (!open) {
    return (
      <p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-control border-2 border-deep-navy bg-white px-4 py-1 font-bold text-deep-navy"
        >
          Edit username
        </button>
      </p>
    );
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    const rejection = usernameRejection(username);
    if (rejection) return setStatus({ kind: "error", text: rejection });
    const next = normalizeUsername(username);
    if (next === current) return close();
    lock.current = true;
    setStatus({ kind: "sending", text: "Saving…" });
    try {
      const res = await fetch("/api/profile/username", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; username?: string };
      if (res.ok) {
        router.push(`/u/${encodeURIComponent(body.username ?? next)}`);
        router.refresh();
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
    <form onSubmit={onSubmit} className="space-y-3">
      <Field
        label="Username"
        name="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        hint="3 to 20 characters. Letters, numbers, underscore. Your only public name."
        autoComplete="username"
      />
      {liveError ? <p className="text-sm text-dark-red">{liveError}</p> : null}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!!liveError || !username}
          aria-disabled={sending}
          className={`rounded-control bg-dark-red px-5 py-2 font-bold text-white disabled:opacity-60 ${sending ? "cursor-wait opacity-70" : ""}`}
        >
          {sending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={sending}
          className="rounded-control border-2 border-deep-navy bg-white px-5 py-2 font-bold text-deep-navy disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
      <p role="status" aria-live="polite" className={`min-h-[1.25rem] text-sm ${status.kind === "error" ? "font-bold text-dark-red" : "text-ink/70"}`}>
        {status.text} {status.signedOut ? <NavyLink href="/sign-in">Sign in</NavyLink> : null}
      </p>
    </form>
  );
}
