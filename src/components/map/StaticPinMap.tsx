"use client";

import { useEffect, useRef } from "react";
import { maplibre, maplibregl } from "./maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { PICKER_MAP_STYLE, PICKER_PIN_COLOR } from "./pickerMapStyle";

/**
 * Read-only map with one dark-red pin. Used on the edit page to show the stored
 * pin. It cannot be moved, reads no device location and sends no request other
 * than the map tiles. Imports nothing from the board modules.
 */
export function StaticPinMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new (maplibre().Map)({
      container: ref.current,
      style: PICKER_MAP_STYLE,
      center: [lng, lat],
      zoom: 14,
      minZoom: 1,
      renderWorldCopies: false,
      interactive: false,
    });
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = `width:22px;height:22px;border-radius:50% 50% 50% 0;background:${PICKER_PIN_COLOR};border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 3px rgba(0,0,0,.4)`;
    const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    return () => {
      marker.remove();
      map.remove();
    };
  }, [lat, lng]);

  return <div ref={ref} role="img" aria-label={label} className="h-48 w-full overflow-hidden rounded-card border border-board" />;
}
