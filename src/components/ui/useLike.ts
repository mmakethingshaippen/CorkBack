"use client";

import { useRef, useState } from "react";
import { applyLike, likeErrorMessage } from "@/lib/reactionState";
import { initialLike, setConfirmedLike, type LikeEntry } from "@/lib/likeStore";

/**
 * Like toggle for a posting card. Same contract as the posting page:
 * PUT /api/postings/[id]/like { liked } (desired state, idempotent). The view
 * updates immediately; extra clicks while a save is in flight are ignored; a
 * failed save rolls back to the last saved state and explains why. An ended or
 * unavailable posting closes the control.
 */
export function useLike(postingId: string, server: LikeEntry, renderedAt: string | null | undefined) {
  const [saved, setSaved] = useState<LikeEntry>(() => initialLike(postingId, server, renderedAt));
  const [view, setView] = useState<LikeEntry>(saved);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const inFlight = useRef(false);

  async function toggle() {
    if (inFlight.current || closed) return; // a save is in flight: ignore extra clicks
    inFlight.current = true;
    const liked = !view.liked;
    const next = { liked, likes: applyLike({ likes: view.likes, going: 0, interested: 0 }, view.liked, liked).likes };
    setPending(true);
    setMessage(null);
    setView(next); // immediate feedback
    try {
      const res = await fetch(`/api/postings/${postingId}/like`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liked }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        liked?: boolean;
        counts?: { likes?: number };
        at?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        setView(saved); // roll back
        if (data.code === "ended" || data.code === "not_found") setClosed(true);
        setMessage(likeErrorMessage(data.code, data.error));
        return;
      }
      const confirmed: LikeEntry = { liked: Boolean(data.liked), likes: data.counts?.likes ?? next.likes };
      setSaved(confirmed);
      setView(confirmed);
      setConfirmedLike(postingId, confirmed, data.at);
    } catch {
      setView(saved);
      setMessage("Could not reach CorkBack. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { view, pending, message, closed, toggle };
}
