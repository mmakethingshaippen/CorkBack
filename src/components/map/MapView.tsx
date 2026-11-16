"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { maplibre, maplibregl } from "./maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Posting } from "@/lib/types";
import type { Bounds } from "@/lib/mapBounds";
import { diffMarkers } from "@/lib/markerDiff";

/**
 * Real interactive map (MapLibre) with free raster tiles. Local style uses a
 * darker-tan paper backdrop so white roads and dark-red pins pop
 * (location-rules.md). Pins are dark red; clicking a pin opens the posting.
 *
 * One map instance per mount. Data changes only add or remove markers by id;
 * the view is fitted once, on the first load that has pins.
 */

// Free OSM raster tiles — no API key. Tan backdrop behind for the local look.
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

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Viewport as {west,south,east,north}, clamped to valid ranges. */
function readBounds(map: maplibregl.Map): Bounds {
  const b = map.getBounds();
  return {
    west: clamp(b.getWest(), -180, 180),
    south: clamp(b.getSouth(), -90, 90),
    east: clamp(b.getEast(), -180, 180),
    north: clamp(b.getNorth(), -90, 90),
  };
}

export function MapView({
  postings,
  onBoundsChange,
}: {
  postings: Posting[];
  /** Called after each moveend (and once when the map first loads). */
  onBoundsChange?: (bounds: Bounds) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const fittedRef = useRef(false);
  const postingsRef = useRef(postings);
  const routerRef = useRef(router);
  const boundsCbRef = useRef(onBoundsChange);
  postingsRef.current = postings;
  routerRef.current = router;
  boundsCbRef.current = onBoundsChange;

  // Create the map once; remove it only on unmount.
  useEffect(() => {
    if (!containerRef.current) return;
    const first = postingsRef.current[0];
    const map = new (maplibre().Map)({
      container: containerRef.current,
      style: STYLE,
      center: first ? [first.lng, first.lat] : [-0.1035, 51.5465],
      zoom: first ? 12 : 3,
      // No maxBounds: in MapLibre 6.17 it throws in resize() -> constrainInternal
      // on first layout. Reported bounds are clamped in readBounds() instead.
      minZoom: 1,
      renderWorldCopies: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    const markers = markersRef.current;

    const report = () => boundsCbRef.current?.(readBounds(map));
    map.on("moveend", report);
    map.once("load", report);

    return () => {
      map.off("moveend", report);
      markers.clear();
      mapRef.current = null;
      fittedRef.current = false;
      map.remove();
    };
  }, []);

  // Sync markers by id whenever the postings change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const { add, remove } = diffMarkers(markers.keys(), postings);

    for (const id of remove) {
      markers.get(id)?.remove();
      markers.delete(id);
    }
    for (const p of add) {
      const el = document.createElement("button");
      el.setAttribute("aria-label", p.title);
      el.style.cssText =
        "width:18px;height:18px;border-radius:50% 50% 50% 0;background:#8C2B1F;border:2px solid #fff;transform:rotate(-45deg);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.4)";
      el.addEventListener("click", () => routerRef.current.push(`/p/${p.id}`));
      markers.set(p.id, new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map));
    }

    // Fit once, on the first load that has pins. Never refit afterwards.
    if (!fittedRef.current && postings.length > 0) {
      fittedRef.current = true;
      if (postings.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        postings.forEach((p) => bounds.extend([p.lng, p.lat]));
        map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
      }
    }
  }, [postings]);

  return <div ref={containerRef} className="h-full w-full rounded-card" />;
}
