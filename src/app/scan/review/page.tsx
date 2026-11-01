import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { ReviewForm } from "./ReviewForm";
import { getViewer } from "@/lib/auth";
import { SignInToTakePart } from "@/components/ui/SignInToTakePart";

export default async function ReviewPage() {
  const viewer = await getViewer();

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/scan", label: "Review your scan" }} />
      <div className="px-4">
        <h1 className="text-2xl font-bold text-ink">Make the details clear.</h1>
        <p className="mt-1 text-ink/70">We read the flyer. Check and edit before it is public.</p>
      </div>
      <div className="mx-auto max-w-md px-4 pt-4">
        {viewer ? <ReviewForm /> : <SignInToTakePart action="publish a flyer" />}
      </div>
      <BottomNav />
    </main>
  );
}
