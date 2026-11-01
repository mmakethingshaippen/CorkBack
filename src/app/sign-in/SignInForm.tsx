"use client";

import { useState } from "react";
import { Field } from "@/components/ui/Field";

/** Sign-in: email + password only. Social login is deferred past the contest. */
export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Signing in…");
    const res = await fetch("/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (res.ok) {
      window.location.href = "/";
    } else {
      setStatus(body.error ?? "Sign-in failed.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field
        label="Email address"
        name="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <Field
        label="Password"
        name="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      <button
        type="submit"
        disabled={!email || !password}
        className="w-full rounded-control bg-dark-red px-5 py-3 font-bold text-white disabled:opacity-60"
      >
        Sign in
      </button>
      {status ? <p className="text-sm text-ink/70">{status}</p> : null}
    </form>
  );
}
