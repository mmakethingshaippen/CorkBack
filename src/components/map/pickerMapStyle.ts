/**
 * Map style for the location picker. A copy of the board's tan style so the
 * board files stay untouched. Free OSM raster tiles, no key, on a darker tan
 * backdrop so white roads and dark-red pins pop (location-rules).
 */
import type { StyleSpecification } from "maplibre-gl";

export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

/** MapLibre renders a source attribution as HTML. */
export const OSM_ATTRIBUTION_HTML = `<a href="${OSM_COPYRIGHT_URL}">© OpenStreetMap contributors</a>`;

export const PICKER_PIN_COLOR = "#8C2B1F";
export const PICKER_AREA_COLOR = "#1F2E4D";

export const PICKER_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: OSM_ATTRIBUTION_HTML,
      maxzoom: 19,
    },
  },
  layers: [
    { id: "tan-bg", type: "background", paint: { "background-color": "#C9A77C" } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.9, "raster-saturation": -0.2 } },
  ],
};
