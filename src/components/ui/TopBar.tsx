import Link from "next/link";
import { Wordmark } from "./Wordmark";
import { ArrowLeftIcon } from "@/components/icons";

/**
 * Top bar with the text wordmark. Optional back link (dark-red "Back" lives in
 * the wordmark; the back control uses an arrow + label). Right slot for sign-in.
 */
export function TopBar({
  back,
  right,
}: {
  back?: { href: string; label: string };
  right?: React.ReactNode;
}) {
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
      {right ?? (
        <Link href="/sign-in" className="text-sm font-bold text-deep-navy">
          Sign in
        </Link>
      )}
    </header>
  );
}
