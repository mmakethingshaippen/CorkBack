import { TopBar } from "@/components/ui/TopBar";
import { CorkBand } from "@/components/ui/CorkBand";
import { SignInForm } from "./SignInForm";
import { NavyLink } from "@/components/ui/actions";

// Explanations for email-link problems forwarded by /auth/callback, /auth/confirm,
// and the homepage fallback.
const LINK_ERRORS: Record<string, string> = {
  link_expired: "That email link has expired or was already used. Sign in, or use Forgot password for a new link.",
  link_invalid: "That email link couldn't be used. Sign in, or use Forgot password for a new link.",
  other_browser:
    "That email link was opened in a different browser from the one that requested it, or it's no longer valid. Request a new link on this device.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const errKey = typeof sp.error === "string" ? sp.error : undefined;
  const linkError = errKey ? LINK_ERRORS[errKey] : undefined;

  return (
    <main className="min-h-screen pb-12">
      <TopBar back={{ href: "/", label: "Back to map" }} right={<span />} />
      <div className="px-4">
        <CorkBand>
          <h1 className="text-2xl font-bold text-paper">Welcome back.</h1>
          <p className="mt-1 text-paper/90">Sign in with email to post, reply, and set alerts.</p>
        </CorkBand>
      </div>
      <div className="mx-auto max-w-md px-4 pt-6">
        {linkError ? (
          <div className="mb-4 rounded-card border border-board bg-card p-4 text-sm text-ink" role="alert">
            {linkError}
          </div>
        ) : null}
        <SignInForm />
        <p className="mt-4 text-sm text-ink/70">
          <NavyLink href="/forgot-password">Forgot password?</NavyLink>
        </p>
        <p className="mt-2 text-sm text-ink/70">
          New here? <NavyLink href="/sign-up">Create an account</NavyLink>.
        </p>
      </div>
    </main>
  );
}
