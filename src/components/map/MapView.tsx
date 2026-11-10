"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { maplibre, maplibregl } from "./maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Posting } from "@/lib/types";

/**
 * Real interactive map (MapLibre) with free raster tiles. Local style uses a
 * darker-tan paper backdrop so white roads and dark-red pins pop
 * (location-rules.md). Pins are dark red; clicking a pin opens the posting.
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

export function MapView({ postings }: { postings: Posting[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!containerRef.current) return;

    const first = postings[0];
    const map = new (maplibre().Map)({
      container: containerRef.current,
      style: STYLE,
      center: first ? [first.lng, first.lat] : [-0.1035, 51.5465],
      zoom: first ? 12 : 3,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    for (const p of postings) {
      const el = document.createElement("button");
      el.setAttribute("aria-label", p.title);
      el.style.cssText =
        "width:18px;height:18px;border-radius:50% 50% 50% 0;background:#8C2B1F;border:2px solid #fff;transform:rotate(-45deg);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.4)";
      el.addEventListener("click", () => router.push(`/p/${p.id}`));
      new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
    }

    // Fit to all pins when there is more than one.
    if (postings.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      postings.forEach((p) => bounds.extend([p.lng, p.lat]));
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 });
    }

    return () => map.remove();
  }, [postings, router]);

  return <div ref={containerRef} className="h-full w-full rounded-card" />;
}
