"use client";

import { useState } from "react";
import { MapView } from "./MapView";
import type { Posting } from "@/lib/types";
import { countInView, type Bounds } from "@/lib/mapBounds";
import { CATEGORIES } from "@/lib/categories";
import { worldCaption, worldEmptyText } from "@/lib/nearby";
import { useMapPostings, WORLD_MAP_DEBOUNCE_MS } from "@/lib/useMapPostings";
import { useDelayedFlag } from "@/lib/useDelayedFlag";

// The world map opens on the whole world, so its first (capped) pin request covers every
// region; the map then fits the returned pins once. Starting on one region showed
// "0 postings in view" wherever that region had no postings.
const WORLD_START: { center: [number, number]; zoom: number } = { center: [-30, 25], zoom: 1 };
// Until the map has fitted to its first pins, ask for the whole world whatever the screen
// width (a phone at zoom 1 sees only about 125 degrees of longitude). Still capped at 300.
const WHOLE_WORLD: Bounds = { west: -180, south: -85, east: 180, north: 85 };

const UPDATING_DELAY_MS = 300;

/**
 * Secondary world map. Fetches pins for the visible view (debounced), using the
 * same category as the local map. Pins mode is public and viewer-independent.
 * Previous pins stay on screen while a request is loading or has failed.
 */
export function WorldMapSection({
  category,
  onClearCategory,
}: {
  category: string | null;
  onClearCategory: () => void;
}) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [fitted, setFitted] = useState(false);
  const result = useMapPostings<Posting>({
    mode: "pins",
    category,
    bounds: fitted ? bounds : WHOLE_WORLD,
    debounceMs: WORLD_MAP_DEBOUNCE_MS,
  });
  const updating = useDelayedFlag(result.status === "loading", UPDATING_DELAY_MS);

  const label = category ? CATEGORIES.find((c) => c.slug === category)?.label ?? null : null;
  const caption = worldCaption(label, countInView(result.items, bounds), result.truncated);
  const showEmpty = category !== null && result.status === "ready" && result.items.length === 0;

  return (
    <section className="px-4 pt-8" aria-label="World map">
      <h2 className="mb-2 text-sm font-bold text-ink/70" aria-live="polite">
        {caption}
      </h2>
      <div className="relative h-64 overflow-hidden rounded-card border border-board">
        <MapView postings={result.items} onBoundsChange={setBounds} initialView={WORLD_START} onFirstFit={() => setFitted(true)} />
        {updating ? (
          <p className="absolute left-2 top-2 z-10 rounded-control bg-paper/90 px-2 py-1 text-sm text-ink shadow-md" role="status">
            Updating…
          </p>
        ) : null}
        {showEmpty ? (
          <div className="absolute inset-x-2 bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-control bg-paper/95 p-2 shadow-md">
            <p className="text-sm text-ink">{worldEmptyText(label)}</p>
            <button
              type="button"
              onClick={onClearCategory}
              className="min-h-[44px] rounded-control bg-deep-navy px-4 py-2 font-bold text-white"
            >
              Show all categories
            </button>
          </div>
        ) : null}
      </div>
      {result.status === "error" ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-dark-red">
          <span>Could not load postings for this view. Showing the last results.</span>
          <button
            type="button"
            onClick={result.retry}
            className="min-h-[44px] rounded-control border-2 border-deep-navy bg-white px-3 py-2 font-bold text-deep-navy"
          >
            Try again
          </button>
        </div>
      ) : null}
    </section>
  );
}
