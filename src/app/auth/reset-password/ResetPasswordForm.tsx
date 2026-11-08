"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { NavyLink } from "@/components/ui/actions";
import { createClient } from "@/lib/supabase/client";
import { RECOVERY_COOKIE, RECOVERY_COOKIE_MAX_AGE, hasRecoveryAmr } from "@/lib/authRecovery";
import { RESET_PASSWORD_PATH } from "@/lib/appUrl";

function hasRecoveryMarker(): boolean {
  return document.cookie.split("; ").some((c) => c === `${RECOVERY_COOKIE}=1`);
}
function setRecoveryMarker() {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${RECOVERY_COOKIE}=1; Path=/; Max-Age=${RECOVERY_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}
function clearRecoveryMarker() {
  document.cookie = `${RECOVERY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

type Phase =
  | "checking"
  | "ready"
  | "saved"
  | "expired"
  | "invalid"
  | "other_browser"
  | "signed_in";

const MIN_LENGTH = 8;

/**
 * New-password page. Accepts every way a Supabase recovery link can arrive:
 *  - ?code=…          PKCE code → forwarded to /auth/callback (server exchange)
 *  - #access_token=…  implicit tokens → setSession in the browser
 *  - ?error=…  or #error_code=…  → expired / invalid explanation
 *  - an existing recovery session (e.g. after /auth/confirm, or a refresh)
 * The form is shown only for a RECOVERY session, never for an ordinary sign-in.
 * Tokens and passwords are never logged.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function establish() {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.slice(1));

      // 1. Errors forwarded by the auth routes or attached by Supabase.
      const queryError = url.searchParams.get("error");
      const hashError = hash.get("error_code") ?? hash.get("error");
      if (queryError || hashError) {
        if (queryError === "other_browser") setPhase("other_browser");
        else if (queryError === "link_expired" || hashError === "otp_expired") setPhase("expired");
        else setPhase("invalid");
        window.history.replaceState(null, "", RESET_PASSWORD_PATH);
        return;
      }

      // 2. PKCE code: exchange on the server, which reads the verifier cookie.
      const code = url.searchParams.get("code");
      if (code) {
        window.location.replace(
          `/auth/callback?code=${encodeURIComponent(code)}&next=${encodeURIComponent(RESET_PASSWORD_PATH)}`,
        );
        return;
      }

      // 3. Implicit tokens in the hash: establish the session in the browser.
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error: setErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        // Remove the tokens from the address bar and history straight away.
        window.history.replaceState(null, "", RESET_PASSWORD_PATH);
        if (setErr) {
          setPhase("expired");
          return;
        }
        if (hash.get("type") === "recovery") setRecoveryMarker();
      }

      // 4. Decide from the current session. The form opens only for a session
      //    that came from a recovery link (marker set by the auth routes or
      //    above). A refresh keeps working while the marker is alive.
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      const recovering = Boolean(session) && (hasRecoveryMarker() || hasRecoveryAmr(session?.access_token));
      if (recovering) setPhase("ready");
      else if (session) setPhase("signed_in");
      else setPhase("invalid");
    }

    establish();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setBusy(false);
      const msg = updateErr.message;
      if (/different from the old/i.test(msg)) setError("Choose a password you haven't used before.");
      else if (/session|jwt|expired/i.test(msg)) setPhase("expired");
      else setError(msg);
      return;
    }

    // End the recovery session so the user signs in fresh with the new password.
    clearRecoveryMarker();
    await supabase.auth.signOut();
    setBusy(false);
    setPhase("saved");
    router.refresh(); // update the header's signed-in state
  }

  if (phase === "checking") {
    return <p className="text-sm text-ink/70">Checking your reset link…</p>;
  }

  if (phase === "expired" || phase === "invalid" || phase === "other_browser") {
    const title = phase === "expired" ? "This link has expired" : "This link can't be used";
    const body =
      phase === "expired"
        ? "Reset links work once and only for a limited time. This one has expired or was already used."
        : phase === "other_browser"
          ? "This link was opened in a different browser from the one that requested it, or it's no longer valid. Request a new email and open it on this device."
          : "We couldn't find a valid reset request. The link may be incomplete, or this page was opened directly.";
    return (
      <div className="rounded-card border border-board bg-card p-4">
        <p className="font-bold text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink/70">{body}</p>
        <a
          href="/forgot-password"
          className="mt-3 inline-block rounded-control bg-dark-red px-5 py-3 font-bold text-white"
        >
          Send a new reset email
        </a>
        <p className="mt-3 text-sm text-ink/70">
          Or <NavyLink href="/sign-in">go back to sign in</NavyLink>.
        </p>
      </div>
    );
  }

  if (phase === "signed_in") {
    return (
      <div className="rounded-card border border-board bg-card p-4">
        <p className="font-bold text-ink">You&apos;re already signed in</p>
        <p className="mt-1 text-sm text-ink/70">
          This page is for password reset links. To change your password, sign out and use Forgot password on the
          sign-in page.
        </p>
        <p className="mt-3 text-sm text-ink/70">
          <NavyLink href="/">Back to the map</NavyLink>
        </p>
      </div>
    );
  }

  if (phase === "saved") {
    return (
      <div className="rounded-card border border-board bg-card p-4">
        <p className="font-bold text-ink">Password updated</p>
        <p className="mt-1 text-sm text-ink/70">Your new password is saved. Sign in with it to continue.</p>
        <a
          href="/sign-in"
          className="mt-3 inline-block rounded-control bg-dark-red px-5 py-3 font-bold text-white"
        >
          Sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field
        label="New password"
        name="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        hint={`At least ${MIN_LENGTH} characters. A longer phrase is stronger.`}
      />
      <Field
        label="Confirm password"
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
        {busy ? "Saving…" : "Save new password"}
      </button>
      {error ? (
        <p className="text-sm text-dark-red" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
