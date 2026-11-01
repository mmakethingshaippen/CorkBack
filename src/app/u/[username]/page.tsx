import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { PosterHandle } from "@/components/ui/PosterHandle";
import { NeutralAction } from "@/components/ui/actions";

/**
 * Minimal poster profile — the target of the navy @handle link. Follow/Connect
 * are independent (follow-connect-independence.md); the full social surface
 * ships in a later stage, so the controls are present but inert here.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  return (
    <main className="min-h-screen pb-24">
      <TopBar back={{ href: "/", label: "Back to map" }} />
      <div className="space-y-4 px-4">
        <PosterHandle username={username} className="text-2xl" />
        <p className="text-ink/70">Neighbour on CorkBack.</p>

        <div className="flex gap-3">
          <NeutralAction disabled>Follow</NeutralAction>
          <NeutralAction disabled>Connect</NeutralAction>
        </div>
        <p className="text-sm text-ink/60">
          Follow is one-way and never mutual. Connect is a separate friend request. Changing one never changes the other.
          Social features ship in a later stage.
        </p>
      </div>
      <BottomNav />
    </main>
  );
}
