import { TopBar } from "@/components/ui/TopBar";
import { BottomNav } from "@/components/ui/BottomNav";
import { PosterHandle } from "@/components/ui/PosterHandle";

/**
 * Minimal poster profile — the target of the navy @handle link. Follow and
 * Connect are not part of this release (only the data model landed day-one; no
 * API/UI was built), so no control is shown — a disabled control would be a
 * dead button and the earlier "later stage" note was a false promise.
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

        <p className="text-sm text-ink/60">
          Follow is one-way and never mutual. Connect is a separate friend request. Changing one never changes the
          other. Following and Connect are not part of this release.
        </p>
      </div>
      <BottomNav />
    </main>
  );
}
