"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { maplibre, maplibregl } from "./maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Posting } from "@/lib/types";
import { CATEGORIES } from "@/lib/categories";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { CategoryFollowButton } from "@/components/ui/CategoryFollowButton";
import { PostingCardGrid } from "@/components/ui/PostingCardGrid";

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

function clearSaved() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

const VIEWER_CIRCLE_SOURCE = "viewer-accuracy";
const VIEWER_CIRCLE_LAYER = "viewer-accuracy-fill";

/** A geodesic circle polygon (GeoJSON) of `radiusMeters` around a point. */
function circlePolygon(
  lng: number,
  lat: number,
  radiusMeters: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const points = 48;
  const coords: [number, number][] = [];
  const earth = 6371000; // metres
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusMeters * Math.cos(angle)) / earth;
    const dLng = (radiusMeters * Math.sin(angle)) / (earth * Math.cos(latRad));
    coords.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] }, properties: {} };
}

export function HomeMap({
  postings,
  homePoint,
  signedIn = false,
  followedCategories = [],
}: {
  postings: Posting[];
  homePoint: { lat: number; lng: number; townName: string | null } | null;
  signedIn?: boolean;
  followedCategories?: string[];
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const myLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  // The viewer's location dot (navy + white ring) and its soft accuracy circle.
  // Browser-only: never sent to the server, never a posting, never shown to
  // another user. Posting pins stay dark red; this dot is navy so it can never
  // look like a posting.
  const viewerDotRef = useRef<maplibregl.Marker | null>(null);

  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [townQuery, setTownQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasNearMe, setHasNearMe] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [approxNote, setApproxNote] = useState<string | null>(null);

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

  // Show the viewer dot (navy dot + white ring) at the location used to center
  // the map. When accuracy is coarse (> 30 m), draw a soft circle whose radius
  // matches the accuracy, so the uncertainty is visible. Browser-only; nothing
  // is sent to the server or saved as a posting.
  const showViewerDot = useCallback((lat: number, lng: number, accuracy: number | null) => {
    const map = mapRef.current;
    if (!map) return;

    // Dot marker (navy fill, white ring). Deliberately NOT dark red so it can
    // never be mistaken for a posting pin.
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText =
      "width:14px;height:14px;border-radius:9999px;background:#1F2E4D;border:3px solid #fff;box-shadow:0 0 0 1px rgba(31,46,77,.35)";
    if (viewerDotRef.current) viewerDotRef.current.remove();
    viewerDotRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);

    // Soft accuracy circle only when accuracy is coarse (> 30 m).
    const drawCircle = () => {
      const widen = accuracy !== null && accuracy > 30;
      const data = widen
        ? circlePolygon(lng, lat, accuracy as number)
        : ({ type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection);
      const existing = map.getSource(VIEWER_CIRCLE_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data as GeoJSON.GeoJSON);
      } else {
        map.addSource(VIEWER_CIRCLE_SOURCE, { type: "geojson", data: data as GeoJSON.GeoJSON });
        map.addLayer({
          id: VIEWER_CIRCLE_LAYER,
          type: "fill",
          source: VIEWER_CIRCLE_SOURCE,
          paint: { "fill-color": "#1F2E4D", "fill-opacity": 0.12 },
        });
      }
    };
    if (map.isStyleLoaded()) drawCircle();
    else map.once("load", drawCircle);
  }, []);

  // Hide the viewer dot and its accuracy circle (e.g. after a town search).
  const hideViewerDot = useCallback(() => {
    const map = mapRef.current;
    if (viewerDotRef.current) {
      viewerDotRef.current.remove();
      viewerDotRef.current = null;
    }
    const src = map?.getSource(VIEWER_CIRCLE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features: [] } as GeoJSON.GeoJSON);
  }, []);

  // Initialise the map once, choosing the center per the order above.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const saved = loadSaved();
    const start = saved ?? homePoint ?? BERKELEY;
    const startZoom = saved?.zoom ?? (saved ? TOWN_ZOOM : homePoint ? TOWN_ZOOM : TOWN_ZOOM);

    const map = new (maplibre().Map)({
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
          // Draw the browser-only viewer dot at the centering location.
          setLocationNote("Showing near you");
          showViewerDot(here.lat, here.lng, pos.coords.accuracy);
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
      if (viewerDotRef.current) {
        viewerDotRef.current.remove();
        viewerDotRef.current = null;
      }
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

  // "Use my location" button handler. Always requests a FRESH position on every
  // tap (never uses the saved center). Uses high accuracy, 10s timeout,
  // maximumAge 0. If the first fix is coarse (accuracy > 50 m), it keeps
  // sampling for up to 10 s and uses the reading with the lowest accuracy
  // number. Centers on the best fix: zoom 17 under 30 m, else zoom 15 with an
  // "approximate" note. Clears the old saved center, then saves only the best
  // reading. On deny/unavailable/timeout → stay on Berkeley; never block.
  function useMyLocation() {
    const map = mapRef.current;
    if (!map) return;

    if (!("geolocation" in navigator)) {
      setLocationNote("Location is unavailable. Showing Berkeley.");
      return;
    }

    setLocating(true);
    setApproxNote(null);

    const ACCURACY_GOOD = 50; // metres: good enough to stop sampling early
    const PRECISE = 30; // metres: zoom 17 vs 15
    const MAX_SAMPLE_MS = 10000;

    let best: { lat: number; lng: number; accuracy: number } | null = null;
    let watchId: number | null = null;
    let settled = false;

    const applyBest = () => {
      if (settled) return;
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      setLocating(false);

      if (!best) {
        // No usable fix → stay on Berkeley; do not block.
        setLocationNote("Location unavailable. Staying on Berkeley.");
        return;
      }

      const here = { lat: best.lat, lng: best.lng };
      myLocationRef.current = here;
      setHasNearMe(true);

      const precise = best.accuracy <= PRECISE;
      const zoom = precise ? 17 : 15;
      map.flyTo({ center: [here.lng, here.lat], zoom, duration: 800 });

      // Clear the old saved center, then save ONLY the best reading.
      clearSaved();
      save({ lat: here.lat, lng: here.lng, zoom, town: null });

      setLocationNote("Showing near you");
      setApproxNote(precise ? null : "Location is approximate.");

      // Browser-only viewer dot at the centering location. Soft circle widens
      // with accuracy when the fix is coarse (> 30 m).
      showViewerDot(here.lat, here.lng, best.accuracy);
    };

    const consider = (pos: GeolocationPosition) => {
      const acc = pos.coords.accuracy;
      if (!best || acc < best.accuracy) {
        best = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: acc };
      }
      // Good enough on the first/any sufficiently-accurate reading → stop early.
      if (best.accuracy <= ACCURACY_GOOD) applyBest();
    };

    const onError = () => {
      // If we already have some reading, use it; otherwise fall back.
      applyBest();
    };

    // Stop sampling after at most 10 s and use the best reading so far.
    const timer = setTimeout(applyBest, MAX_SAMPLE_MS);

    const opts: PositionOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    // Use watchPosition so we can keep improving accuracy within the window.
    watchId = navigator.geolocation.watchPosition(consider, onError, opts);
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
      // The map has moved away from the viewer → hide the viewer dot/circle and
      // the approximate note. It returns only when Use my location is tapped.
      hideViewerDot();
      setApproxNote(null);
    } catch {
      setSearchError("Town search is unavailable right now. Please try again.");
    } finally {
      setSearching(false);
    }
  }

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
          <span key={c.slug} className="inline-flex items-center gap-1">
            <CategoryChip
              label={c.label}
              selected={activeCategory === c.slug}
              onClick={() => setActiveCategory(activeCategory === c.slug ? null : c.slug)}
            />
            <CategoryFollowButton
              slug={c.slug}
              label={c.label}
              initialFollowing={followedCategories.includes(c.slug)}
              signedIn={signedIn}
            />
          </span>
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
      {approxNote ? <p className="text-xs text-ink/60">{approxNote}</p> : null}

      {/* Posting rail (filtered). */}
      <section className="pt-2">
        <h2 className="mb-3 text-lg font-bold text-ink">On your doorstep</h2>
        {filtered.length === 0 ? (
          <div className="cork-band rounded-edge p-6">
            <p className="text-paper">
              {activeCategory ? "Nothing in this category nearby yet." : "Nothing posted nearby yet. Be the first — scan a flyer."}
            </p>
          </div>
        ) : (
          <PostingCardGrid postings={filtered} signedIn={signedIn} />
        )}
      </section>
    </div>
  );
}
