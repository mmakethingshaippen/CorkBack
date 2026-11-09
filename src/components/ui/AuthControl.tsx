"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { UserRoundIcon } from "@/components/icons";

/**
 * Header auth control. Signed in: a profile chip (links to the user's profile)
 * plus a working Sign out button. Signed out: a Sign in link. Rendered by
 * TopBar on every page, so the header always reflects the session state.
 */
export function AuthControl({ username }: { username: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!username && username !== "") {
    // Not signed in (null means no viewer).
    return (
      <Link href="/sign-in" className="text-sm font-bold text-deep-navy">
        Sign in
      </Link>
    );
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/sign-out", { method: "POST" });
    router.refresh();
    router.push("/");
  }

  return (
    <div className="flex items-center gap-2">
      {username === "" ? (
        // Signed in but no profile yet: finish setup.
        <Link href="/welcome" className="text-sm font-bold text-dark-red underline underline-offset-2">
          Choose username
        </Link>
      ) : null}
      <Link
        href={username ? `/u/${username}` : "/welcome"}
        aria-label={username ? `@${username}` : "Your profile"}
        className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-deep-navy bg-white text-deep-navy"
      >
        <UserRoundIcon />
      </Link>
      <button
        onClick={signOut}
        disabled={busy}
        className="text-sm font-bold text-deep-navy disabled:opacity-60"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
