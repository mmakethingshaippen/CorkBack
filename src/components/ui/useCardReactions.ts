"use client";

import { useRef, useState } from "react";
import { applyLike, applyPlan, likeErrorMessage, nextPlan, planErrorMessage } from "@/lib/reactionState";
import { initialLike, initialPlan, setConfirmedLike, setConfirmedPlan } from "@/lib/likeStore";
import type { PlanKind, ReactionCounts } from "@/lib/types";

export interface CardReactionState {
  liked: boolean;
  plan: PlanKind | null;
  counts: ReactionCounts;
}

/**
 * Like + Going/Interested for a posting card. Same contract as the posting page:
 *   PUT /api/postings/[id]/like { liked }   and   PUT /api/postings/[id]/plan { kind }
 * Both carry the DESIRED state, so a repeat is idempotent. The view updates
 * immediately; one lock covers all three controls, so rapid taps are ignored
 * while a save is in flight; a failed save rolls back to the last saved state
 * and explains why. An ended or unavailable posting closes the controls.
 */
export function useCardReactions(
  postingId: string,
  server: CardReactionState,
  renderedAt: string | null | undefined,
) {
  const [saved, setSaved] = useState<CardReactionState>(() => {
    const l = initialLike(postingId, { liked: server.liked, likes: server.counts.likes }, renderedAt);
    const p = initialPlan(
      postingId,
      { plan: server.plan, going: server.counts.going, interested: server.counts.interested },
      renderedAt,
    );
    return { liked: l.liked, plan: p.plan, counts: { likes: l.likes, going: p.going, interested: p.interested } };
  });
  const [view, setView] = useState<CardReactionState>(saved);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const inFlight = useRef(false);

  async function save(kind: "like" | "plan", next: CardReactionState, body: unknown) {
    if (inFlight.current || closed) return; // a save is in flight: ignore extra taps
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    setView(next); // immediate feedback
    try {
      const res = await fetch(`/api/postings/${postingId}/${kind}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        liked?: boolean;
        plan?: PlanKind | null;
        counts?: Partial<ReactionCounts>;
        at?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        setView(saved); // roll back
        if (data.code === "ended" || data.code === "not_found") setClosed(true);
        setMessage(kind === "plan" ? planErrorMessage(data.code, data.error) : likeErrorMessage(data.code, data.error));
        return;
      }
      const confirmed: CardReactionState = {
        liked: Boolean(data.liked),
        plan: data.plan ?? null,
        counts: {
          likes: data.counts?.likes ?? next.counts.likes,
          going: data.counts?.going ?? next.counts.going,
          interested: data.counts?.interested ?? next.counts.interested,
        },
      };
      setSaved(confirmed);
      setView(confirmed);
      setConfirmedLike(postingId, { liked: confirmed.liked, likes: confirmed.counts.likes }, data.at);
      setConfirmedPlan(
        postingId,
        { plan: confirmed.plan, going: confirmed.counts.going, interested: confirmed.counts.interested },
        data.at,
      );
    } catch {
      setView(saved);
      setMessage("Could not reach CorkBack. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function toggleLike() {
    const liked = !view.liked;
    void save("like", { ...view, liked, counts: applyLike(view.counts, view.liked, liked) }, { liked });
  }

  function choosePlan(clicked: PlanKind) {
    const plan = nextPlan(view.plan, clicked);
    void save("plan", { ...view, plan, counts: applyPlan(view.counts, view.plan, plan) }, { kind: plan });
  }

  return { view, pending, message, closed, toggleLike, choosePlan };
}
