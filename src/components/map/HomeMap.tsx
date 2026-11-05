"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Posting } from "@/lib/types";
import { CATEGORIES } from "@/lib/categories";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { PostingCard } from "@/components/ui/PostingCard";
import { tiltFor } from "@/components/ui/Card";

/**
 * Home map: local-first. Centering order on load:
 *   1. a saved town/center in localStorage, else
 *   2. ask the browser for location; if allowed → center at street level, show
 *      "Near me", save the center; if denied/unavailable/timeout →
 *   3. the signed-in user's alert home town (homePoint), else
 *   4. Berkeley.
 * A town search box (OSM geocoder) flies the map and saves the town. The
 * category filter (full list) filters both the pins and the posting rail.
 *
 * The user's exact location is used ONLY to center the map and is never shown
 * publicly (not rendered as text, not attached to any posting).
 */

const BERKELEY = { lat: 37.8715, lng: -122.273 };
const LOCAL_ZOOM = 15; // street level
const TOWN_ZOOM = 13;
const SAVE_KEY = "corkback.mapCenter";

// Free OSM raster tiles with the darker-tan local backdrop (location-rules.md).
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "tan-bg", type: "background", paint: { "background-color": "#C9A77C" } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.9, "raster-saturation": -0.2 } },
  ],
};

interface SavedCenter {
  lat: number;
  lng: number;
  zoom?: number;
  town?: string | null;
}

function loadSaved(): SavedCenter | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedCenter;
    if (typeof v?.lat === "number" && typeof v?.lng === "number") return v;
  } catch {
    /* ignore */
  }
  return null;
}

function save(center: SavedCenter) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(center));
  } catch {
    /* ignore */
  }
}

export function HomeMap({
  postings,
  homePoint,
}: {
  postings: Posting[];
  homePoint: { lat: number; lng: number; townName: string | null } | null;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const myLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [townQuery, setTownQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasNearMe, setHasNearMe] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const filtered = activeCategory
    ? postings.filter((p) => p.categorySlug === activeCategory)
    : postings;

  // Draw pins for the currently filtered postings.
  const drawPins = useCallback(
    (list: Posting[]) => {
      const map = mapRef.current;
      if (!map) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      for (const p of list) {
        const el = document.createElement("button");
        el.setAttribute("aria-label", p.title);
        el.style.cssText =
          "width:18px;height:18px;border-radius:50% 50% 50% 0;background:#8C2B1F;border:2px solid #fff;transform:rotate(-45deg);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.4)";
        el.addEventListener("click", () => router.push(`/p/${p.id}`));
        const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
        markersRef.current.push(marker);
      }
    },
    [router],
  );

  // Initialise the map once, choosing the center per the order above.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const saved = loadSaved();
    const start = saved ?? homePoint ?? BERKELEY;
    const startZoom = saved?.zoom ?? (saved ? TOWN_ZOOM : homePoint ? TOWN_ZOOM : TOWN_ZOOM);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: [start.lng, start.lat],
      zoom: startZoom,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    map.once("load", () => drawPins(filtered));

    // If nothing is saved, try device location (non-blocking).
    if (!saved && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          myLocationRef.current = here;
          setHasNearMe(true);
          map.flyTo({ center: [here.lng, here.lat], zoom: LOCAL_ZOOM, duration: 800 });
          // Save only the center (never shown publicly; used only to center).
          save({ lat: here.lat, lng: here.lng, zoom: LOCAL_ZOOM, town: null });
        },
        () => {
          // Denied / unavailable / timeout → fall back (map already centered on
          // homePoint or Berkeley). Never block browsing.
          setLocationNote(
            homePoint?.townName
              ? `Showing your alert home town: ${homePoint.townName}.`
              : homePoint
                ? "Showing your alert home area."
                : "Showing Berkeley. Search a town or allow location.",
          );
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
      );
    }

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw pins whenever the category filter changes.
  useEffect(() => {
    drawPins(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory]);

  function nearMe() {
    const map = mapRef.current;
    const here = myLocationRef.current;
    if (map && here) {
      map.flyTo({ center: [here.lng, here.lat], zoom: LOCAL_ZOOM, duration: 800 });
    }
  }

  // "Use my location" button handler. If the user's location is already known
  // (e.g. after a town search, requirement 5), return the map there without
  // re-prompting. Otherwise ask the browser once. On allow: center at street
  // level, save the center, set the note. On deny/unavailable: stay on Berkeley
  // (do not move the map) and never block browsing.
  function useMyLocation() {
    const map = mapRef.current;
    if (!map) return;

    const known = myLocationRef.current;
    if (known) {
      map.flyTo({ center: [known.lng, known.lat], zoom: LOCAL_ZOOM, duration: 800 });
      save({ lat: known.lat, lng: known.lng, zoom: LOCAL_ZOOM, town: null });
      setLocationNote("Showing near you");
      return;
    }

    if (!("geolocation" in navigator)) {
      setLocationNote("Location is unavailable. Showing Berkeley.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        myLocationRef.current = here;
        setHasNearMe(true);
        map.flyTo({ center: [here.lng, here.lat], zoom: LOCAL_ZOOM, duration: 800 });
        // Save only the center (never shown publicly; no pin for the user).
        save({ lat: here.lat, lng: here.lng, zoom: LOCAL_ZOOM, town: null });
        setLocationNote("Showing near you");
        setLocating(false);
      },
      () => {
        // Denied / unavailable / timeout → stay on Berkeley; do not block.
        setLocationNote("Location unavailable. Staying on Berkeley.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
    );
  }

  async function searchTown(e: React.FormEvent) {
    e.preventDefault();
    const q = townQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { "Accept-Language": "en" } },
      );
      const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (!rows.length) {
        setSearchError(`Couldn't find "${q}". Try a nearby town or city.`);
        return;
      }
      const lat = Number(rows[0].lat);
      const lng = Number(rows[0].lon);
      mapRef.current?.flyTo({ center: [lng, lat], zoom: TOWN_ZOOM, duration: 800 });
      save({ lat, lng, zoom: TOWN_ZOOM, town: q });
      setLocationNote(`Showing ${q}.`);
    } catch {
      setSearchError("Town search is unavailable right now. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  // Pre-compute tilts so adjacent cards never mirror (Choice B).
  let prev: number | null = null;
  const withTilt = filtered.map((p) => {
    const t = tiltFor(p.id, prev);
    const entry = { posting: p, prevTilt: prev };
    prev = t;
    return entry;
  });

  return (
    <div className="space-y-4">
      {/* Town search box, above the map. */}
      <form onSubmit={searchTown} className="flex gap-2">
        <input
          value={townQuery}
          onChange={(e) => setTownQuery(e.target.value)}
          placeholder="Search a town or city"
          aria-label="Search a town or city"
          className="flex-1 rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none"
        />
        <button
          type="submit"
          disabled={searching || !townQuery.trim()}
          className="rounded-control bg-deep-navy px-4 py-2 font-bold text-white disabled:opacity-60"
        >
          {searching ? "…" : "Search"}
        </button>
      </form>
      {searchError ? <p className="text-sm text-dark-red">{searchError}</p> : null}

      {/* Use my location — under the search box, left aligned, chip-styled
          (white with a navy border, like an unselected category chip). */}
      <div className="flex">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="rounded-control border-2 border-deep-navy bg-white px-3 py-1 text-sm font-bold text-deep-navy transition-colors hover:bg-deep-navy/5 disabled:opacity-60"
        >
          {locating ? "Locating…" : "Use my location"}
        </button>
      </div>

      {/* Category filter — full list; selected chip is dark red. */}
      <div className="flex flex-wrap gap-2">
        <CategoryChip label="All" selected={activeCategory === null} onClick={() => setActiveCategory(null)} />
        {CATEGORIES.map((c) => (
          <CategoryChip
            key={c.slug}
            label={c.label}
            selected={activeCategory === c.slug}
            onClick={() => setActiveCategory(activeCategory === c.slug ? null : c.slug)}
          />
        ))}
      </div>

      {/* Map + optional Near me control. */}
      <div className="relative">
        <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-card border border-board" />
        {hasNearMe ? (
          <button
            onClick={nearMe}
            className="absolute left-2 top-2 z-10 rounded-control bg-deep-navy px-3 py-1.5 text-sm font-bold text-white shadow-md"
          >
            Near me
          </button>
        ) : null}
      </div>
      {locationNote ? <p className="text-xs text-ink/60">{locationNote}</p> : null}

      {/* Posting rail (filtered). */}
      <section className="pt-2">
        <h2 className="mb-3 text-lg font-bold text-ink">On your doorstep</h2>
        {withTilt.length === 0 ? (
          <div className="cork-band rounded-edge p-6">
            <p className="text-paper">
              {activeCategory ? "Nothing in this category nearby yet." : "Nothing posted nearby yet. Be the first — scan a flyer."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {withTilt.map(({ posting, prevTilt }) => (
              <PostingCard key={posting.id} posting={posting} tiltId={posting.id} prevTilt={prevTilt} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
