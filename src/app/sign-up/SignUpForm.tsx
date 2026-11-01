"use client";

import { useState } from "react";
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
  const [status, setStatus] = useState<string | null>(null);

  const usernameError = username.length > 0 ? usernameRejection(username) : null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const rejection = usernameRejection(username);
    if (rejection) {
      setStatus(rejection);
      return;
    }
    setStatus("Submitting…");
    const res = await fetch("/api/auth/sign-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, email, password }),
    });
    const body = await res.json();
    setStatus(res.ok ? "Check your email to confirm your account." : body.error ?? "Sign-up failed.");
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
        disabled={!!usernameError || !username || !email || !password}
        className="w-full rounded-control bg-dark-red px-5 py-3 font-bold text-white disabled:opacity-60"
      >
        Create account
      </button>

      {status ? <p className="text-sm text-ink/70">{status}</p> : null}
    </form>
  );
}
