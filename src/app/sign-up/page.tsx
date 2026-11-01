import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { CorkBand } from "@/components/ui/CorkBand";
import { SignUpForm } from "./SignUpForm";
import { NavyLink } from "@/components/ui/actions";

export default function SignUpPage() {
  return (
    <main className="min-h-screen pb-12">
      <TopBar back={{ href: "/", label: "Back to map" }} right={<Link href="/sign-in" className="text-sm font-bold text-deep-navy">Sign in</Link>} />
      <div className="px-4">
        <CorkBand>
          <h1 className="text-2xl font-bold text-paper">Join the board.</h1>
          <p className="mt-1 text-paper/90">Email only. Your username is the only public name.</p>
        </CorkBand>
      </div>
      <div className="mx-auto max-w-md px-4 pt-6">
        <SignUpForm />
        <p className="mt-4 text-sm text-ink/70">
          Already have an account? <NavyLink href="/sign-in">Sign in</NavyLink>.
        </p>
      </div>
    </main>
  );
}
