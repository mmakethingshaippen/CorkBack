import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";

// Radius email alerts are Stage 2. The alerts table lands day one; the UI ships next stage.
export default function AlertsPage() {
  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="px-4 pt-4">
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Set an alert</h1>
          <p className="mt-1 text-paper/90">
            Radius email alerts by category, from 1 to 25 miles or a whole town, arrive in Stage 2.
          </p>
        </CorkBand>
      </div>
      <BottomNav />
    </main>
  );
}
