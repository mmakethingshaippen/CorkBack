"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Owner-only promote / remove-promotion control for a posting. Rendered only
 * when the viewer is the poster (the parent passes isOwner). Label + placement
 * only — no payment, no price. Uses existing tokens: deep navy for the action,
 * neutral for removal. No new color.
 */
export function PromoteToggle({
  postingId,
  initialPromoted,
}: {
  postingId: string;
  initialPromoted: boolean;
}) {
  const router = useRouter();
  const [promoted, setPromoted] = useState(initialPromoted);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/postings/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ postingId, promoted: !promoted }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setPromoted(data.promoted);
      router.refresh();
    } else {
      setStatus(data.error ?? "Could not update promotion.");
    }
  }

  return (
    <div className="rounded-card border border-board bg-board/20 p-4">
      <p className="text-sm font-bold text-ink">
        {promoted ? "This posting is promoted." : "Promote this posting"}
      </p>
      <p className="mt-1 text-xs text-ink/60">
        Promotion adds a Promoted label and places this posting first in its area and category while it is live. It ends
        when the posting expires or is deleted. No payment.
      </p>
      <button
        onClick={toggle}
        disabled={busy}
        className={`mt-2 rounded-control px-5 py-2 font-bold disabled:opacity-60 ${
          promoted ? "border border-board text-ink" : "bg-deep-navy text-white"
        }`}
      >
        {busy ? "Saving…" : promoted ? "Remove promotion" : "Promote"}
      </button>
      {status ? <p className="mt-1 text-sm text-dark-red">{status}</p> : null}
    </div>
  );
}
