import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";

// Following view ships in a later stage. Nav target exists so the app has no dead links.
export default function FollowingPage() {
  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="px-4 pt-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Following</h1>
          <p className="mt-1 text-paper/90">
            Postings from posters you follow will appear here. Social features ship in a later stage.
          </p>
        </CorkBand>
      </div>
      <BottomNav />
    </main>
  );
}
