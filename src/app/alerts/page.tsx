import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { CorkBand } from "@/components/ui/CorkBand";
import { AlertsManager } from "./AlertsManager";
import { getViewer } from "@/lib/auth";
import { SignInToTakePart } from "@/components/ui/SignInToTakePart";

// Stage 2: radius email alerts, signed-in users only. Public browsing unchanged.
export default async function AlertsPage() {
  const viewer = await getViewer();

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="px-4 pt-4">
        {/* Cork only on the header band (Choice A). */}
        <CorkBand>
          <h1 className="text-xl font-bold text-paper">Set an alert</h1>
          <p className="mt-1 text-paper/90">
            Get an email when a new posting appears in a category and area you watch. Your home point and radius stay private.
          </p>
        </CorkBand>
      </div>
      <div className="mx-auto max-w-md px-4 pt-6">
        {viewer ? <AlertsManager /> : <SignInToTakePart action="set up alerts" />}
      </div>
      <BottomNav />
    </main>
  );
}
