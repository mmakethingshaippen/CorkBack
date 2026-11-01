import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { ScanCapture } from "./ScanCapture";
import { getViewer } from "@/lib/auth";
import { SignInToTakePart } from "@/components/ui/SignInToTakePart";

// Scanning requires an account (posting requires sign-in).
export default async function ScanPage() {
  const viewer = await getViewer();

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Scan a flyer" }} />
      <div className="px-4">
        <h1 className="text-2xl font-bold text-ink">Give paper a place on the map.</h1>
        <p className="mt-1 text-ink/70">Fit the whole flyer inside the frame. You can check and edit every detail next.</p>
      </div>
      <div className="px-4 pt-4">
        {viewer ? (
          <ScanCapture />
        ) : (
          <SignInToTakePart action="scan and post a flyer" />
        )}
      </div>
      <BottomNav />
    </main>
  );
}
