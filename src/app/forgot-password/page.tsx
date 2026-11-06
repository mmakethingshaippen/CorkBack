import { TopBar } from "@/components/ui/TopBar";
import { CorkBand } from "@/components/ui/CorkBand";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { NavyLink } from "@/components/ui/actions";

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen pb-12">
      <TopBar back={{ href: "/sign-in", label: "Back to sign in" }} right={<span />} />
      <div className="px-4">
        <CorkBand>
          <h1 className="text-2xl font-bold text-paper">Reset your password.</h1>
          <p className="mt-1 text-paper/90">Enter your email and we&apos;ll send a reset link.</p>
        </CorkBand>
      </div>
      <div className="mx-auto max-w-md px-4 pt-6">
        <ForgotPasswordForm />
        <p className="mt-4 text-sm text-ink/70">
          Remembered it? <NavyLink href="/sign-in">Back to sign in</NavyLink>.
        </p>
      </div>
    </main>
  );
}
