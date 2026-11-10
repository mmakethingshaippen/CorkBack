"use client";

import { useRef, useState } from "react";
import { Field } from "@/components/ui/Field";
import { usernameRejection } from "@/lib/domain";

/**
 * Sign-up: EMAIL + USERNAME + password only. No full name is ever collected
 * (account-model.md). Username validated live against the locked rule.
 */
export function SignUpForm() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "done" | "error"; text: string }>({ kind: "idle", text: "" });
  // One request at a time: a double click or double submit never sends twice
  // (a second sign-up for the same details would report the username as taken).
  const lock = useRef(false);

  const usernameError = username.length > 0 ? usernameRejection(username) : null;
  const sending = status.kind === "sending";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    const rejection = usernameRejection(username);
    if (rejection) {
      setStatus({ kind: "error", text: rejection });
      return;
    }
    lock.current = true;
    setStatus({ kind: "sending", text: "Creating your account…" });
    try {
      const res = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.ok) setStatus({ kind: "done", text: body.message ?? "Check your email to confirm your account." });
      else setStatus({ kind: "error", text: body.error ?? "Sign-up didn't go through. Please try again." });
    } catch {
      setStatus({ kind: "error", text: "Couldn't reach CorkBack. Your details are still here; check your connection and try again." });
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
      {usernameError ? <p className="text-sm text-dark-red">{usernameError}</p> : null}

      <Field
        label="Email address"
        name="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        hint="Kept private. Never shown publicly."
        autoComplete="email"
      />
      <Field
        label="Password"
        name="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
      />

      <button
        type="submit"
        disabled={!!usernameError || !username || !email || !password || status.kind === "done"}
        aria-disabled={sending}
        className={`w-full rounded-control bg-dark-red px-5 py-3 font-bold text-white disabled:opacity-60 ${sending ? "cursor-wait opacity-70" : ""}`}
      >
        {sending ? "Creating account…" : "Create account"}
      </button>

      <p
        role="status"
        aria-live="polite"
        className={`min-h-[1.25rem] text-sm ${status.kind === "error" ? "font-bold text-dark-red" : "text-ink/70"}`}
      >
        {status.text}
      </p>
    </form>
  );
}
