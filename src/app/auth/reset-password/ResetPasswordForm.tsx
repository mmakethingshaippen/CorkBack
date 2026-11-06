"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { NavyLink } from "@/components/ui/actions";
import { createClient } from "@/lib/supabase/client";

type Phase = "exchanging" | "ready" | "saved" | "invalid";

/**
 * Reset password page. The email link lands here with a PKCE `code`. On mount
 * we exchange it for a session; once established the user sets a new password
 * via updateUser({ password }). On success we sign them out of the temporary
 * recovery session and point them to sign in with the new password.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("exchanging");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function establish() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setPhase("invalid");
          setStatus("This reset link is invalid or has expired. Request a new one.");
          return;
        }
        // Clean the code out of the URL so a refresh doesn't re-exchange it.
        window.history.replaceState({}, "", "/auth/reset-password");
        setPhase("ready");
        return;
      }

      // Some Supabase setups deliver a recovery session directly (hash tokens),
      // handled by the client. If a session already exists, allow the reset.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setPhase("ready");
      } else {
        setPhase("invalid");
        setStatus("This reset link is invalid or has expired. Request a new one.");
      }
    }

    establish();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setStatus("Use at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setStatus("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setStatus(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setStatus(error.message);
      return;
    }
    // Sign out of the temporary recovery session so the user signs in fresh
    // with the new password.
    await supabase.auth.signOut();
    setBusy(false);
    setPhase("saved");
  }

  if (phase === "exchanging") {
    return <p className="text-sm text-ink/70">Verifying your reset link…</p>;
  }

  if (phase === "invalid") {
    return (
      <div className="rounded-card border border-board bg-card p-4">
        <p className="font-bold text-ink">Link not valid</p>
        <p className="mt-1 text-sm text-ink/70">{status}</p>
        <p className="mt-3 text-sm text-ink/70">
          <NavyLink href="/forgot-password">Request a new reset link</NavyLink>.
        </p>
      </div>
    );
  }

  if (phase === "saved") {
    return (
      <div className="rounded-card border border-board bg-card p-4">
        <p className="font-bold text-ink">Password updated</p>
        <p className="mt-1 text-sm text-ink/70">You can now sign in with your new password.</p>
        <button
          onClick={() => router.push("/sign-in")}
          className="mt-3 rounded-control bg-dark-red px-5 py-3 font-bold text-white"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field
        label="New password"
        name="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        hint="At least 6 characters."
      />
      <Field
        label="Confirm new password"
        name="confirm"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
      />
      <button
        type="submit"
        disabled={busy || !password || !confirm}
        className="w-full rounded-control bg-dark-red px-5 py-3 font-bold text-white disabled:opacity-60"
      >
        {busy ? "Saving…" : "Set new password"}
      </button>
      {status ? <p className="text-sm text-dark-red">{status}</p> : null}
    </form>
  );
}
