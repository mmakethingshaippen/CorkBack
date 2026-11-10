"use client";

import * as maplibregl from "maplibre-gl"; // v6 ships named exports only

/**
 * MapLibre with its worker URL set. v6 loads its module worker from a file
 * next to the library script; inside a Next chunk that file doesn't exist, so
 * point it at the copy served from /maplibre/ (copied by next.config.mjs).
 * The version query keeps browsers from reusing a worker from another release.
 */
let configured = false;
export function maplibre(): typeof maplibregl {
  if (!configured && typeof window !== "undefined") {
    maplibregl.setWorkerUrl(new URL(`/maplibre/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`, window.location.origin).href);
    configured = true;
  }
  return maplibregl;
}

export { maplibregl };
