"use client";

import { useState } from "react";
import { HeartIcon, ShareIcon } from "@/components/icons";
import { SignInToTakePart } from "./SignInToTakePart";
import { ShareButton } from "./ShareButton";

/**
 * Like + plan + share controls for a posting page.
 * - Like is for POSTINGS ONLY (locked). No like on replies anywhere.
 * - Going / Interested are the attendance plans.
 * Visitors with no session see "Sign in to take part" instead of active controls.
 */
export function PostingActions({
  likeCount,
  signedIn,
}: {
  likeCount: number;
  signedIn: boolean;
}) {
  const [likes, setLikes] = useState(likeCount);
  const [liked, setLiked] = useState(false);
  const [plan, setPlan] = useState<"going" | "interested" | null>(null);

  if (!signedIn) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-4 text-ink/60">
          <span className="inline-flex items-center gap-1">
            <HeartIcon /> {likes}
          </span>
          <span className="inline-flex items-center gap-1">
            <ShareIcon /> Share
          </span>
        </div>
        <SignInToTakePart action="like, reply, and set plans" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setLiked((v) => !v);
            setLikes((n) => (liked ? n - 1 : n + 1));
          }}
          aria-pressed={liked}
          className={`inline-flex items-center gap-1 rounded-control border px-3 py-2 ${
            liked ? "border-dark-red text-dark-red" : "border-board text-ink"
          }`}
        >
          <HeartIcon /> {likes}
        </button>
        <ShareButton variant="button" />
      </div>

      <div>
        <p className="mb-1 text-sm font-bold text-ink">Your plans — choose one</p>
        <div className="flex gap-3">
          <button
            onClick={() => setPlan(plan === "going" ? null : "going")}
            aria-pressed={plan === "going"}
            className={`flex-1 rounded-control px-4 py-2 font-bold ${
              plan === "going" ? "bg-deep-navy text-white" : "border border-board text-ink"
            }`}
          >
            Going
          </button>
          <button
            onClick={() => setPlan(plan === "interested" ? null : "interested")}
            aria-pressed={plan === "interested"}
            className={`flex-1 rounded-control px-4 py-2 font-bold ${
              plan === "interested" ? "bg-deep-navy text-white" : "border border-board text-ink"
            }`}
          >
            Interested
          </button>
        </div>
      </div>
    </div>
  );
}
