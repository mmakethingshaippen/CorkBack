import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";

// Friends attendance visibility ships in a later stage. Nav target exists.
export default function FriendsPage() {
  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="px-4 pt-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Friends</h1>
          <p className="mt-1 text-paper/90">
            Connected friends and their Going/Interested plans will appear here. Social features ship in a later stage.
          </p>
        </CorkBand>
      </div>
      <BottomNav />
    </main>
  );
}
