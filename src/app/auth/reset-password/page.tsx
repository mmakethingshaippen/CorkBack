import { Suspense } from "react";
import { TopBar } from "@/components/ui/TopBar";
import { CorkBand } from "@/components/ui/CorkBand";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen pb-12">
      <TopBar back={{ href: "/sign-in", label: "Back to sign in" }} right={<span />} />
      <div className="px-4">
        <CorkBand>
          <h1 className="text-2xl font-bold text-paper">Set a new password.</h1>
          <p className="mt-1 text-paper/90">Choose a new password for your account.</p>
        </CorkBand>
      </div>
      <div className="mx-auto max-w-md px-4 pt-6">
        <Suspense fallback={<p className="text-sm text-ink/70">Loading…</p>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
