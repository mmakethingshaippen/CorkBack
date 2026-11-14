import Link from "next/link";
import { Wordmark } from "./Wordmark";
import { ArrowLeftIcon } from "@/components/icons";
import { AuthControl } from "./AuthControl";
import { getViewer } from "@/lib/auth";

/**
 * Top bar with the text wordmark. Optional back link. The right slot shows the
 * session state on EVERY page: signed in → profile chip + Sign out; signed out
 * → Sign in. Pass an explicit `right` to override (rare).
 */
export async function TopBar({
  back,
  right,
}: {
  back?: { href: string; label: string };
  right?: React.ReactNode;
}) {
  const viewer = right === undefined ? await getViewer() : null;

  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3">
        {back ? (
          <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-ink/70">
            <ArrowLeftIcon /> {back.label}
          </Link>
        ) : null}
        <Wordmark />
      </div>
      {right ?? <AuthControl username={viewer ? viewer.username ?? "" : null} avatarPath={viewer?.avatarPath ?? null} />}
    </header>
  );
}
