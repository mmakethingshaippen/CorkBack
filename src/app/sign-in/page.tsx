import { TopBar } from "@/components/ui/TopBar";
import { CorkBand } from "@/components/ui/CorkBand";
import { SignInForm } from "./SignInForm";
import { NavyLink } from "@/components/ui/actions";

export default function SignInPage() {
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
        <SignInForm />
        <p className="mt-4 text-sm text-ink/70">
          New here? <NavyLink href="/sign-up">Create an account</NavyLink>.
        </p>
      </div>
    </main>
  );
}
