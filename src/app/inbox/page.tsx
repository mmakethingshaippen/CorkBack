import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";
import { InboxList } from "./InboxList";
import { getViewer } from "@/lib/auth";
import { SignInToTakePart } from "@/components/ui/SignInToTakePart";

// Stage 3 inbox — signed-in users see only their own threads. Public unchanged.
export default async function InboxPage() {
  const viewer = await getViewer();
  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="px-4 pt-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Messages</h1>
          <p className="mt-1 text-paper/90">Your private threads. Only you and the other person can read them.</p>
        </CorkBand>
      </div>
      <div className="mx-auto max-w-md px-4 pt-6">
        {viewer ? <InboxList /> : <SignInToTakePart action="see your messages" />}
      </div>
      <BottomNav />
    </main>
  );
}
