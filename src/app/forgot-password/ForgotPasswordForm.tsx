"use client";

import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { createClient } from "@/lib/supabase/client";
import { getAppUrl, RESET_PASSWORD_PATH } from "@/lib/appUrl";

/**
 * Forgot password: email field → Supabase resetPasswordForEmail with a redirect
 * to the live reset page. On submit it shows "Check your email" and does NOT
 * loop back to sign-in. Email-only account model is unchanged.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);

    // Always point the email at the canonical production reset page. Using the
    // browser's own origin (e.g. a Vercel deployment URL) made Supabase reject
    // the redirect and fall back to the Site URL (the homepage).
    const redirectTo = `${getAppUrl()}${RESET_PASSWORD_PATH}`;

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setBusy(false);

    if (error) {
      setStatus(
        /only request this after|rate limit/i.test(error.message)
          ? "A reset email was sent recently. Please wait a minute, then try again."
          : error.message,
      );
      return;
    }
    // Always show the same confirmation (don't reveal whether the email exists).
    setSent(true);
  }

  if (sent) {
    return (
      <div className="rounded-card border border-board bg-card p-4">
        <p className="font-bold text-ink">Check your email</p>
        <p className="mt-1 text-sm text-ink/70">
          If an account exists for {email.trim() || "that address"}, we&apos;ve sent a link to reset your password.
          Open it on this device to set a new password.
        </p>
      </div>
    );
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
        hint="We&apos;ll email you a link to reset your password."
      />
      <button
        type="submit"
        disabled={busy || !email}
        className="w-full rounded-control bg-dark-red px-5 py-3 font-bold text-white disabled:opacity-60"
      >
        {busy ? "Sending…" : "Send reset link"}
      </button>
      {status ? <p className="text-sm text-dark-red">{status}</p> : null}
    </form>
  );
}
