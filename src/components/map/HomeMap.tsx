"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { maplibre, maplibregl } from "./maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Posting } from "@/lib/types";
import { CategoryFilter } from "@/components/ui/CategoryFilter";
import { RadiusSelect } from "@/components/ui/RadiusSelect";
import {
  buildBoardView,
  DEFAULT_RADIUS_MILES,
  METERS_PER_MILE,
  nextLargerRadius,
  postingCountHeading,
  referenceAfterSearch,
  referenceLabel,
  type BoardReference,
  type BoardView,
} from "@/lib/nearby";
import { boundsForRadius } from "@/lib/mapBounds";
import { buildMapRequest } from "@/lib/mapRequestModel";
import { useMapPostings } from "@/lib/useMapPostings";
import { clearSavedCenter, readRadius, readSavedCenter, writeRadius, writeSavedCenter } from "@/lib/boardStorage";
import { PostingCardGrid } from "@/components/ui/PostingCardGrid";
import { WorldMapSection } from "./WorldMapSection";
import { geolocationAlreadyGranted } from "@/lib/geoPermission";

/**
 * Home map: local-first and radius-bound.
 *
 * Reference point (what distance is measured from), by precedence:
 *   1. the most recent explicit action (a place search or "Use my location"),
 *   2. the saved centre in localStorage (read in the mount effect),
 *   3. the signed-in user's alert home (homePoint),
 *   4. Berkeley.
 * With no saved centre, one automatic device-location request on mount may
 * replace 3 or 4 with a device reference, unless an explicit action (1) has
 * already happened; failure is silent.
 * The first render always uses 3 or 4 (the server-safe reference); storage is
 * read only in the mount effect. Panning and zooming never change it.
 *
 * Candidates come from useMapPostings (cards mode, snapped radius box,
 * category); buildBoardView then applies the exact distance test, and the pins,
 * the cards and the heading all read that one view. The exact reference point
 * never leaves the browser and is never shown as text.
 */

const BERKELEY = { lat: 37.8715, lng: -122.273 };
const LOCAL_ZOOM = 15; // street level
const TOWN_ZOOM = 13;

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

const VIEWER_CIRCLE_SOURCE = "viewer-accuracy";
const VIEWER_CIRCLE_LAYER = "viewer-accuracy-fill";
const RING_SOURCE = "radius-ring";
const RING_LAYER = "radius-ring-line";

const TRUNCATED_NOTICE = "Showing the first 100 postings. Choose a smaller radius to see them all.";

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

/** The server-safe reference: alert home when signed in with one, else Berkeley. */
function serverSafeReference(homePoint: { lat: number; lng: number; townName: string | null } | null): BoardReference {
  return homePoint
    ? { lat: homePoint.lat, lng: homePoint.lng, kind: "home", name: homePoint.townName }
    : { ...BERKELEY, kind: "default", name: null };
}

function requestKeyFor(reference: BoardReference, radiusMiles: number, category: string | null): string {
  return buildMapRequest({ bounds: boundsForRadius(reference, radiusMiles), category, mode: "cards" }).key;
}

interface Shown {
  view: BoardView;
  reference: BoardReference;
  radiusMiles: number;
}

export function HomeMap({
  postings,
  homePoint,
  signedIn = false,
  followedCategories = [],
  truncated = false,
}: {
  /** The server's capped initial list around homePoint or Berkeley at the default radius. */
  postings: Posting[];
  /** The server cap was hit for the initial list. */
  truncated?: boolean;
  homePoint: { lat: number; lng: number; townName: string | null } | null;
  signedIn?: boolean;
  followedCategories?: string[];
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const myLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  // True once the viewer has chosen a reference this visit (place search or
  // "Use my location"). The automatic device result must never overwrite it.
  const explicitReferenceRef = useRef(false);
  // The viewer's location dot (navy + white ring) and its soft accuracy circle.
  // Browser-only: never sent to the server, never a posting, never shown to
  // another user. Posting pins stay dark red; this dot is navy so it can never
  // look like a posting.
  const viewerDotRef = useRef<maplibregl.Marker | null>(null);

  // Server-safe first render; the saved centre and radius apply in the mount effect.
  const [initialReference] = useState<BoardReference>(() => serverSafeReference(homePoint));
  const [initialKey] = useState(() => requestKeyFor(initialReference, DEFAULT_RADIUS_MILES, null));
  const [reference, setReference] = useState<BoardReference>(initialReference);
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_RADIUS_MILES);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  /** True once the viewer has searched or changed the radius since the last device fix. */
  const [adjusted, setAdjusted] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const [townQuery, setTownQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasNearMe, setHasNearMe] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [approxNote, setApproxNote] = useState<string | null>(null);

  // Latest reference for async geolocation callbacks.
  const referenceRef = useRef(reference);
  useEffect(() => {
    referenceRef.current = reference;
  }, [reference]);
  const radiusRef = useRef(radiusMiles);
  useEffect(() => {
    radiusRef.current = radiusMiles;
  }, [radiusMiles]);

  // ---- Data: the server list while the request matches it, else the hook. ----
  const currentKey = requestKeyFor(reference, radiusMiles, activeCategory);
  const matchesInitial = currentKey === initialKey;
  const fetched = useMapPostings<Posting>({
    mode: "cards",
    category: activeCategory,
    bounds: matchesInitial ? null : boundsForRadius(reference, radiusMiles),
  });
  // Last successful fetch, tagged with its request key. Starts as the server list.
  const [base, setBase] = useState<{ items: Posting[]; truncated: boolean; key: string }>(() => ({
    items: postings,
    truncated,
    key: initialKey,
  }));
  useEffect(() => {
    if (fetched.status === "ready") setBase({ items: fetched.items, truncated: fetched.truncated, key: currentKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched.status, fetched.items, fetched.truncated]);

  const source = matchesInitial ? { items: postings, truncated } : base;
  const failed = !matchesInitial && fetched.status === "error";
  const loading = !matchesInitial && !failed && (fetched.status === "loading" || base.key !== currentKey);

  const view = useMemo(
    () =>
      buildBoardView(source.items, {
        category: activeCategory,
        reference,
        radiusMiles,
        truncated: source.truncated,
      }),
    [source.items, source.truncated, activeCategory, reference, radiusMiles],
  );

  // What the viewer sees. After a failed fetch this stays on the last good view
  // so the cards and pins do not change.
  const [held, setHeld] = useState<Shown | null>(null);
  useEffect(() => {
    if (!failed && !loading) setHeld({ view, reference, radiusMiles });
  }, [failed, loading, view, reference, radiusMiles]);
  const shown: Shown = failed && held ? held : { view, reference, radiusMiles };

  const distanceLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const n of shown.view.nearby) out[n.posting.id] = n.distanceLabel;
    return out;
  }, [shown.view]);

  // ---- Map drawing ----
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

  // Pins come from the same view as the cards. Waits for the map's load event.
  useEffect(() => {
    if (mapReady) drawPins(shown.view.nearby.map((n) => n.posting));
  }, [mapReady, shown.view, drawPins]);

  // Navy dashed radius ring: its own source and layer, apart from the viewer's accuracy fill.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const poly = circlePolygon(reference.lng, reference.lat, radiusMiles * METERS_PER_MILE);
    const data: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: poly.geometry.coordinates[0] },
      properties: {},
    };
    const existing = map.getSource(RING_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
    } else {
      map.addSource(RING_SOURCE, { type: "geojson", data });
      map.addLayer({
        id: RING_LAYER,
        type: "line",
        source: RING_SOURCE,
        paint: { "line-color": "#1F2E4D", "line-width": 2, "line-dasharray": [2, 2] },
      });
    }
  }, [mapReady, reference.lat, reference.lng, radiusMiles]);

  const fitRing = useCallback((ref: BoardReference, miles: number) => {
    const map = mapRef.current;
    if (!map) return;
    const b = boundsForRadius(ref, miles);
    map.fitBounds(
      [
        [b.west, b.south],
        [b.east, b.north],
      ],
      { padding: 24, maxZoom: 15, duration: 800 },
    );
  }, []);

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

  // Initialise the map once. The saved centre (precedence 2) and the saved
  // radius are read here, never during render.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const saved = readSavedCenter();
    const storedRadius = readRadius();
    if (saved) {
      setReference({ lat: saved.lat, lng: saved.lng, kind: saved.kind, name: saved.town ?? null });
    }
    if (storedRadius !== null) setRadiusMiles(storedRadius);

    const start = saved ?? homePoint ?? BERKELEY;
    const startZoom = saved?.zoom ?? TOWN_ZOOM;

    const map = new (maplibre().Map)({
      container: containerRef.current,
      style: STYLE,
      center: [start.lng, start.lat],
      zoom: startZoom,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    map.once("load", () => setMapReady(true));

    // No saved centre: use the device location automatically ONLY when the
    // browser already has location permission for this site. The page never
    // triggers a permission prompt on its own; otherwise it waits for
    // "Use my location". A late result never overrides an explicit choice
    // (a search or "Use my location", counted from the moment it starts);
    // failure is silent and keeps the current reference.
    let unmounted = false;
    if (!saved) {
      void geolocationAlreadyGranted().then((granted) => {
        if (!granted || unmounted || explicitReferenceRef.current) return;
        navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (unmounted || explicitReferenceRef.current) return;
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          myLocationRef.current = here;
          setHasNearMe(true);
          map.flyTo({ center: [here.lng, here.lat], zoom: LOCAL_ZOOM, duration: 800 });
          setReference({ lat: here.lat, lng: here.lng, kind: "device", name: null });
          setAdjusted(false);
          writeSavedCenter({ lat: here.lat, lng: here.lng, zoom: LOCAL_ZOOM, town: null, kind: "device" });
          setLocationNote("Showing near you");
          showViewerDot(here.lat, here.lng, pos.coords.accuracy);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
        );
      });
    }

    return () => {
      unmounted = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (viewerDotRef.current) {
        viewerDotRef.current.remove();
        viewerDotRef.current = null;
      }
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function nearMe() {
    const map = mapRef.current;
    const here = myLocationRef.current;
    if (map && here) {
      map.flyTo({ center: [here.lng, here.lat], zoom: LOCAL_ZOOM, duration: 800 });
    }
  }

  function changeRadius(miles: number) {
    if (miles === radiusMiles) return;
    setRadiusMiles(miles);
    writeRadius(miles);
    setAdjusted(true);
    fitRing(reference, miles);
  }

  // "Use my location" button handler (the explicit request; the automatic one is in the mount effect).
  // Always requests a FRESH position on every tap (never uses the saved
  // center). Uses high accuracy, 10s timeout, maximumAge 0. If the first fix is
  // coarse (accuracy > 50 m), it keeps sampling for up to 10 s and uses the
  // reading with the lowest accuracy number. Centers on the best fix at street
  // level (zoom 17 under 30 m, else 15 with an "approximate" note) and makes it
  // the reference. On deny/unavailable/timeout the reference is kept and a
  // message says so; browsing is never blocked.
  function useMyLocation() {
    const map = mapRef.current;
    if (!map) return;
    explicitReferenceRef.current = true;

    const keepMessage = () => `Couldn't get your location. Still showing ${referenceLabel(referenceRef.current)}.`;

    if (!("geolocation" in navigator)) {
      setLocationNote(keepMessage());
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
        // No usable fix: keep the current reference and say so.
        setLocationNote(keepMessage());
        return;
      }

      explicitReferenceRef.current = true;
      const here = { lat: best.lat, lng: best.lng };
      myLocationRef.current = here;
      setHasNearMe(true);

      const precise = best.accuracy <= PRECISE;
      const zoom = precise ? 17 : 15;
      // Street zoom is kept on purpose; "Show full radius" refits the ring.
      map.flyTo({ center: [here.lng, here.lat], zoom, duration: 800 });

      // The device location becomes the reference. Clear the old saved centre,
      // then save ONLY the best reading (browser storage only).
      setReference({ lat: here.lat, lng: here.lng, kind: "device", name: null });
      setAdjusted(false);
      clearSavedCenter();
      writeSavedCenter({ lat: here.lat, lng: here.lng, zoom, town: null, kind: "device" });

      setLocationNote("Showing near you");
      setApproxNote(precise ? null : "Location is approximate.");

      // Browser-only viewer dot. Soft circle widens with accuracy when coarse.
      showViewerDot(here.lat, here.lng, best.accuracy);
    };

    const consider = (pos: GeolocationPosition) => {
      const acc = pos.coords.accuracy;
      if (!best || acc < best.accuracy) {
        best = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: acc };
      }
      if (best.accuracy <= ACCURACY_GOOD) applyBest();
    };

    const onError = () => {
      // Use any reading we already have; otherwise keep the reference.
      applyBest();
    };

    // Stop sampling after at most 10 s and use the best reading so far.
    const timer = setTimeout(applyBest, MAX_SAMPLE_MS);

    const opts: PositionOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
    watchId = navigator.geolocation.watchPosition(consider, onError, opts);
  }

  async function searchTown(e: React.FormEvent) {
    e.preventDefault();
    const q = townQuery.trim();
    if (!q) return;
    // From this moment an automatic location result may no longer move the board.
    explicitReferenceRef.current = true;
    setSearching(true);
    setSearchError(null);
    try {
      // The shared geocoder service: one application-wide throttle and one
      // cache for every lookup, signed in or not (purpose=place serves a
      // signed-out viewer). HomeMap only makes this network call; it imports no
      // server-only geocoder module and stays a client component.
      const res = await fetch(`/api/geocode?purpose=place&q=${encodeURIComponent(q)}`);
      const body = (await res.json().catch(() => null)) as
        | { state?: string; matches?: Array<{ point?: { lat: number; lng: number } }> }
        | null;
      const state = body?.state;
      const first = state === "ok" ? body?.matches?.[0]?.point : undefined;
      if (state !== "ok" || !first) {
        // No match is a plain "not found"; every other non-ok state
        // (unavailable/busy/rate_limited/query_refused/…) is a quiet
        // "search unavailable". Browsing and the board keep working either way.
        setSearchError(
          state === "ok"
            ? `Couldn't find "${q}". Try a nearby town or city.`
            : "Town search is unavailable right now. Please try again.",
        );
        return;
      }
      const { lat, lng } = first;
      // The searched place becomes the reference until the viewer acts again.
      const next = referenceAfterSearch({ lat, lng, name: q });
      explicitReferenceRef.current = true;
      setReference(next);
      setAdjusted(true);
      fitRing(next, radiusRef.current);
      writeSavedCenter({ lat, lng, zoom: TOWN_ZOOM, town: q, kind: "town" });
      setLocationNote(`Showing ${q}.`);
      // The map has moved away from the viewer: hide the dot/circle and the
      // approximate note. They return only when Use my location is tapped.
      hideViewerDot();
      setApproxNote(null);
    } catch {
      setSearchError("Town search is unavailable right now. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  const next = nextLargerRadius(shown.radiusMiles);
  const showFullRadius = reference.kind === "device" && !adjusted;

  return (
    <div className="space-y-3">
      {/* One wrapping controls row: town search, Use my location, category filter. */}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={searchTown} className="flex min-w-[14rem] flex-1 gap-2">
          <input
            value={townQuery}
            onChange={(e) => setTownQuery(e.target.value)}
            placeholder="Search a town or city"
            aria-label="Search a town or city"
            className="min-h-[44px] min-w-0 flex-1 rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none"
          />
          <button
            type="submit"
            disabled={searching || !townQuery.trim()}
            className="min-h-[44px] rounded-control bg-deep-navy px-4 py-2 font-bold text-white disabled:opacity-60"
          >
            {searching ? "…" : "Search"}
          </button>
        </form>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="min-h-[44px] rounded-control border-2 border-deep-navy bg-white px-3 py-2 text-sm font-bold text-deep-navy transition-colors hover:bg-deep-navy/5 disabled:opacity-60"
        >
          {locating ? "Locating…" : "Use my location"}
        </button>
        <CategoryFilter
          value={activeCategory}
          onChange={setActiveCategory}
          followed={followedCategories}
          signedIn={signedIn}
        />
      </div>
      {searchError ? <p className="text-sm text-dark-red">{searchError}</p> : null}

      {/* Map with overlays: Near me / Show full radius (top left), radius (bottom left, no layout height). */}
      <div className="relative">
        <div ref={containerRef} className="h-72 w-full overflow-hidden sm:h-96 rounded-card border border-board" />
        <div className="absolute left-2 top-2 z-10 flex flex-col items-start gap-2">
          {hasNearMe ? (
            <button
              type="button"
              onClick={nearMe}
              className="rounded-control bg-deep-navy px-3 py-1.5 text-sm font-bold text-white shadow-md"
            >
              Near me
            </button>
          ) : null}
          {showFullRadius ? (
            <button
              type="button"
              onClick={() => fitRing(reference, radiusMiles)}
              className="rounded-control bg-deep-navy px-3 py-1.5 text-sm font-bold text-white shadow-md"
            >
              Show full radius
            </button>
          ) : null}
        </div>
        <div className="absolute bottom-5 left-2 right-12 z-10 w-fit max-w-[calc(100%-4rem)] rounded-control bg-paper/90 px-2 py-1 shadow-md">
          <RadiusSelect value={radiusMiles} onChange={changeRadius} />
        </div>
      </div>
      {locationNote ? <p className="text-xs text-ink/60">{locationNote}</p> : null}
      {approxNote ? <p className="text-xs text-ink/60">{approxNote}</p> : null}

      {/* Posting rail (nearby, filtered). */}
      <section className="pt-2">
        <h2 className="text-lg font-bold text-ink">On your doorstep</h2>
        <p className="mb-3 text-sm text-ink/70" aria-live="polite">
          {postingCountHeading(shown.view.nearby.length, shown.radiusMiles, shown.reference)}
        </p>
        {loading ? <p className="mb-3 text-sm text-ink/70">Loading postings…</p> : null}
        {failed ? (
          <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-dark-red">
            <span>Could not load postings for this area. Showing the last results.</span>
            <button
              type="button"
              onClick={fetched.retry}
              className="min-h-[44px] rounded-control border-2 border-deep-navy bg-white px-3 py-2 font-bold text-deep-navy"
            >
              Try again
            </button>
          </div>
        ) : null}
        {shown.view.truncated ? <p className="mb-3 text-sm text-ink/70">{TRUNCATED_NOTICE}</p> : null}
        {shown.view.nearby.length === 0 ? (
          loading ? null : (
            <div className="cork-band rounded-edge p-6">
              <p className="text-paper">
                Nothing within {shown.radiusMiles} mi of {shown.view.referenceLabel}
              </p>
              {next !== null ? (
                <button
                  type="button"
                  onClick={() => changeRadius(next)}
                  className="mt-3 min-h-[44px] rounded-control bg-deep-navy px-4 py-2 font-bold text-white"
                >
                  Try {next} mi
                </button>
              ) : null}
            </div>
          )
        ) : (
          <PostingCardGrid
            postings={shown.view.nearby.map((n) => n.posting)}
            signedIn={signedIn}
            distanceLabels={distanceLabels}
          />
        )}
      </section>

      {/* Secondary: the world map, under the same category state. */}
      <div className="-mx-4">
        <WorldMapSection category={activeCategory} onClearCategory={() => setActiveCategory(null)} />
      </div>
    </div>
  );
}
