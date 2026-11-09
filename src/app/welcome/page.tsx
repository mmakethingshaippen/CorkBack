import { redirect } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import { CorkBand } from "@/components/ui/CorkBand";
import { SignInToTakePart } from "@/components/ui/SignInToTakePart";
import { getViewer } from "@/lib/auth";
import { safeNextPath } from "@/lib/appUrl";
import { ChooseUsernameForm } from "./ChooseUsernameForm";

/**
 * Finish setting up an account that has no profile yet (for example, its
 * chosen username was taken while it was being created). Signed-in owners
 * only; accounts that already have a username go straight on.
 */
export const dynamic = "force-dynamic";

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const dest = safeNextPath(next, "/");
  const viewer = await getViewer();
  if (viewer?.username) redirect(dest);

  return (
    <main className="min-h-screen pb-12">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="px-4">
        <CorkBand>
          <h1 className="text-2xl font-bold text-paper">Choose your username.</h1>
          <p className="mt-1 text-paper/90">One last step. Your username is the only public name on CorkBack.</p>
        </CorkBand>
      </div>
      <div className="mx-auto max-w-md px-4 pt-6">
        {viewer ? <ChooseUsernameForm next={dest} /> : <SignInToTakePart action="finish setting up your account" />}
      </div>
    </main>
  );
}
