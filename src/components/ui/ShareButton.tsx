"use client";

import { useState } from "react";
import { ShareIcon } from "@/components/icons";

/**
 * Share a posting. Uses the Web Share API when available, else copies the link
 * to the clipboard. Existing tokens only (navy link / neutral). No new color.
 *
 * `variant="link"` renders inline navy text (posting-page header);
 * `variant="button"` renders a bordered control (PostingActions row).
 */
export function ShareButton({
  title,
  variant = "link",
}: {
  title?: string;
  variant?: "link" | "button";
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: title ?? "CorkBack", url });
        return;
      }
    } catch {
      // user cancelled or share unavailable — fall through to copy
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op, but the control is still responsive
    }
  }

  if (variant === "button") {
    return (
      <button
        onClick={share}
        className="inline-flex items-center gap-1 rounded-control border border-board px-3 py-2 text-ink"
      >
        <ShareIcon /> {copied ? "Link copied" : "Share"}
      </button>
    );
  }

  return (
    <button onClick={share} className="inline-flex items-center gap-1 text-deep-navy">
      {copied ? "Link copied" : "Share"}
    </button>
  );
}
