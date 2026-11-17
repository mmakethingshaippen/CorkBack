"use client";

import { useCallback, useEffect, useId, useRef, useState, type Dispatch } from "react";
import { maplibre, maplibregl } from "./maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  OSM_COPYRIGHT_URL,
  PICKER_AREA_COLOR,
  PICKER_MAP_STYLE,
  PICKER_PIN_COLOR,
} from "./pickerMapStyle";
import { MESSAGES, runLookup, searchFailedEvent } from "./locationPickerActions";
import { requestDeviceLocation } from "@/lib/deviceLocation";
import type { LatLng, PlaceMatch } from "@/lib/geocode";
import { locationLabels } from "@/lib/postingKinds";
import {
  APPROX_MAX_METERS,
  DEFAULT_VIEW,
  circleRing,
  nudgePin,
  type LocationDraft,
  type LocationEvent,
  type LocationNotice,
  type StoredPrecision,
} from "@/lib/postingLocation";
import type { AddressCandidate } from "@/lib/addressCandidates";

/**
 * Location picker for the posting form (location-rules.md). A proposal (flyer
 * address, place match, map tap, drag or "Use my location") never becomes the
 * pin until the poster answers "Yes, use this place". Any change un-confirms.
 *
 * Network: GET /api/geocode only from "Find on map" and the search submit,
 * with the prepared query text only. Device location only from its button.
 * Imports nothing from the board modules (HomeMap, geoPermission).
 */

export const CONFIRM_QUESTION = "Is this where the event or listing takes place?";

export const CONTACT_NOTE = "This looks like a contact or return address. It may be a home.";
export const LOST_FOUND_LINE = "For Lost and Found, this is where the item was lost or found.";
export const NO_ADDRESS_TEXT = "No address was found on the flyer. Search for the place or tap the map.";

// Req 9.3, audited for Req 23.6 and 23.8: this copy describes an approximate area and
// makes no claim that the displaced pin guarantees anonymity or hides the poster, so it
// is kept as-is. The "about a quarter mile (400 m)" and "The street address is not shown"
// statements are preserved. The honest anonymity caveat is carried by FLYER_IMAGE_WARNING.
export const PRIVATE_HOME_EXPLANATION = "Visitors will see a pin about a quarter mile (400 m) from this place, not the exact spot. The street address is not shown. Name the area, such as a neighborhood or street, and leave out the house number.";

// Req 23.7: a separate warning, distinct from the pin and the approximate-area note,
// that the flyer image or the posting text can still reveal an address.
export const FLYER_IMAGE_WARNING = "A flyer image or words in your posting can still show an address. The approximate pin does not hide what the image or text says.";

// Req 22.5, 22.6: shown before any private-home lookup leaves the browser, and again
// if the service refuses a private-home lookup on a public map search service.
export const PRIVATE_HOME_SEARCH_NOTE = MESSAGES.privateHomeSearch;

const NOTICE_TEXT: Record<LocationNotice, string> = {
  label_cleared: "The pin moved, so the place name was cleared. Add a name for the new spot.",
  label_kept: "Your place name was kept. Check that it matches the pin.",
  device_failed: "We could not get your location. You can search or place the pin on the map.",
  no_match: "We could not find that address. Search another way or place the pin on the map.",
  area_match: "This matched the area, not an exact address. Drag the pin to the exact spot.",
  search_unavailable: MESSAGES.unavailable,
  search_busy: MESSAGES.busy,
  query_refused: MESSAGES.refused,
  location_save_failed: MESSAGES.saveFailed,
};

const KIND_TEXT: Record<AddressCandidate["kind"], string> = {
  venue: "Venue",
  contact: "Contact address",
  return: "Return address",
  other: "Other address",
  unknown: "Address",
};

const NAVY_BTN =
  "min-h-[44px] rounded-control border-2 border-deep-navy bg-white px-5 text-sm font-bold text-deep-navy disabled:opacity-50";
const NAVY_SOLID =
  "min-h-[50px] rounded-control border-2 border-deep-navy bg-deep-navy px-6 text-sm font-bold text-white disabled:opacity-50";

type LookupSource = "flyer_candidate" | "search";

export interface LocationPickerProps {
  categorySlug: string;
  hasEventDate: boolean;
  candidates: AddressCandidate[];
  /** Edit only: the stored pin. Used for the start view. */
  initial?: { point: LatLng; precision: StoredPrecision; label: string };
  draft: LocationDraft;
  dispatch: Dispatch<LocationEvent>;
  onLabelChange: (text: string) => void;
}

function rand(): [number, number] {
  return [Math.random(), Math.random()];
}

export function LocationPicker({
  categorySlug,
  hasEventDate,
  candidates,
  initial,
  draft,
  dispatch,
  onLabelChange,
}: LocationPickerProps) {
  const ids = useId();
  const labels = locationLabels(categorySlug, { hasEventDate });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  // Req 22.2: once the service refuses a private-home lookup on public Nominatim,
  // offer manual pin placement only for a private home and send no more lookups.
  const [privateHomeManualOnly, setPrivateHomeManualOnly] = useState(false);
  const sourceRef = useRef<LookupSource>("search");
  const busyRef = useRef(false);
  const [, setReady] = useState(0);

  // Map plumbing. Handlers read the latest dispatch and state through refs.
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const readyRef = useRef(false);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const initialRef = useRef(initial);
  const confirmedPoint = useRef<LatLng | null>(null);

  const proposal = draft.proposal;
  const confirmed = draft.confirmed;
  const pinPoint = proposal?.point ?? confirmed?.point ?? null;
  const areaCenter = draft.privateHome && confirmed ? draft.approx : null;
  confirmedPoint.current = pinPoint;

  const showArea = useCallback((center: LatLng | null) => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("pick-area") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const ring = center ? circleRing(center, APPROX_MAX_METERS).map((p) => [p.lng, p.lat]) : [];
    src.setData({
      type: "FeatureCollection",
      features: center ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] : [],
    });
  }, []);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    const start = initialRef.current?.point;
    const map = new (maplibre().Map)({
      container: containerRef.current,
      style: PICKER_MAP_STYLE,
      center: start ? [start.lng, start.lat] : DEFAULT_VIEW.center,
      zoom: start ? 14 : DEFAULT_VIEW.zoom,
      minZoom: 1,
      renderWorldCopies: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    map.on("click", (e) => dispatchRef.current({ type: "pin_placed", point: { lat: e.lngLat.lat, lng: e.lngLat.lng } }));
    map.once("load", () => {
      map.addSource("pick-area", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "pick-area-fill",
        type: "fill",
        source: "pick-area",
        paint: { "fill-color": PICKER_AREA_COLOR, "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "pick-area-line",
        type: "line",
        source: "pick-area",
        paint: { "line-color": PICKER_AREA_COLOR, "line-width": 2 },
      });
      readyRef.current = true;
      setReady((n) => n + 1);
    });
    return () => {
      readyRef.current = false;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Keep the draggable marker on the proposal or confirmed point.
  const pinLat = pinPoint?.lat;
  const pinLng = pinPoint?.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pinLat === undefined || pinLng === undefined) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const el = document.createElement("div");
      el.setAttribute("aria-hidden", "true");
      el.style.cssText = `width:22px;height:22px;border-radius:50% 50% 50% 0;background:${PICKER_PIN_COLOR};border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:grab`;
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([pinLng, pinLat]).addTo(map);
      marker.on("dragend", () => {
        const ll = marker.getLngLat();
        dispatchRef.current({ type: "pin_placed", point: { lat: ll.lat, lng: ll.lng } });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([pinLng, pinLat]);
    }
    map.easeTo({ center: [pinLng, pinLat], zoom: Math.max(map.getZoom(), 15), duration: 300 });
  }, [pinLat, pinLng]);

  const areaLat = areaCenter?.lat;
  const areaLng = areaCenter?.lng;
  useEffect(() => {
    showArea(areaLat !== undefined && areaLng !== undefined ? { lat: areaLat, lng: areaLng } : null);
  }, [areaLat, areaLng, showArea]);

  async function lookup(text: string, source: LookupSource) {
    if (busyRef.current) return;
    // A private home on a public map search service never sends a lookup: the
    // poster places the pin by hand. Show the explanation instead of querying.
    if (draft.privateHome && privateHomeManualOnly) {
      setFormMessage(MESSAGES.privateHomeSearch);
      return;
    }
    sourceRef.current = source;
    setFormMessage(null);
    busyRef.current = true;
    setBusy(true);
    try {
      const out = await runLookup(text, false, (url) => fetch(url), draft.privateHome);
      if (out.status === "invalid") {
        setFormMessage(out.message);
        if (out.failure) dispatch(searchFailedEvent(out.failure));
      } else if (out.status === "failed") {
        if (out.privateHomeRefused) {
          // The service refused a private-home lookup. Switch to manual-only and
          // show the explanation; make no further private-home lookup.
          setPrivateHomeManualOnly(true);
          setFormMessage(out.failure.message);
        } else {
          dispatch(searchFailedEvent(out.failure));
        }
      } else if (out.status === "ok") {
        dispatch({ type: "matches_loaded", matches: out.matches, autoPropose: true, source });
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function selectMatch(match: PlaceMatch) {
    dispatch({ type: "match_selected", match, source: sourceRef.current });
  }

  async function handleUseMyLocation() {
    if (deviceBusy) return;
    setDeviceBusy(true);
    try {
      const res = await requestDeviceLocation();
      if (res.ok) dispatch({ type: "device_succeeded", point: { lat: res.point.lat, lng: res.point.lng } });
      else dispatch({ type: "device_failed" });
    } finally {
      setDeviceBusy(false);
    }
  }

  const noticeText = draft.notice ? NOTICE_TEXT[draft.notice] : null;
  // When the place is a private home and the service has refused a public lookup,
  // the search and "Find on map" actions are disabled: the poster places the pin.
  const lookupBlockedForPrivateHome = draft.privateHome && privateHomeManualOnly;
  const searchId = `${ids}-search`;
  const labelId = `${ids}-label`;
  const homeId = `${ids}-home`;

  return (
    <section aria-labelledby={`${ids}-h`} className="space-y-4 rounded-card border border-board bg-white p-4">
      <div>
        <h2 id={`${ids}-h`} className="text-[19px] font-bold text-ink">
          Where does this take place?
        </h2>
        <p className="text-sm text-ink/70">{labels.field}</p>
      </div>

      <div role="status" aria-live="polite" className="min-h-[1px] text-sm text-ink">
        {noticeText ? <p className="rounded-card border-2 border-deep-navy bg-paper p-3">{noticeText}</p> : null}
        {formMessage ? <p className="mt-2 rounded-card border-2 border-deep-navy bg-paper p-3">{formMessage}</p> : null}
      </div>

      {candidates.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-bold text-ink">Addresses found on the flyer</p>
          <ul className="space-y-2">
            {candidates.map((c, i) => (
              <li key={`${i}-${c.text}`} className="rounded-card border border-board p-3">
                <p className="text-xs text-ink/60">{KIND_TEXT[c.kind]}</p>
                <p className="text-sm text-ink">{c.text}</p>
                {c.kind === "contact" || c.kind === "return" ? <p className="mt-1 text-xs text-ink/70">{CONTACT_NOTE}</p> : null}
                <p className="mt-1 text-xs text-ink/70">{CONFIRM_QUESTION}</p>
                <button
                  type="button"
                  className={`${NAVY_BTN} mt-2`}
                  disabled={busy || lookupBlockedForPrivateHome}
                  onClick={() => void lookup(c.text, "flyer_candidate")}
                >
                  Find on map
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {candidates.length === 0 && !initial ? <p className="text-sm text-ink/80">{NO_ADDRESS_TEXT}</p> : null}

      {/* Req 22.5, 22.6: before any private-home lookup leaves the browser, explain
          that a home address is not sent to a public map search service. Navy/neutral. */}
      {draft.privateHome ? (
        <p role="status" aria-live="polite" className="rounded-card border-2 border-deep-navy bg-paper p-3 text-sm text-ink">
          {PRIVATE_HOME_SEARCH_NOTE}
        </p>
      ) : null}

      {/* Not a <form>: the picker sits inside the posting form, and a nested form submits the page natively. */}
      <div role="search" className="space-y-2">
        <label htmlFor={searchId} className="block text-sm font-bold text-ink">
          Search for a place or address
        </label>
        <div className="flex gap-2">
          <input
            id={searchId}
            type="text"
            value={query}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!lookupBlockedForPrivateHome) void lookup(query, "search");
              }
            }}
            className="min-h-[50px] min-w-0 flex-1 rounded-control border-2 border-deep-navy bg-white px-4 text-ink"
          />
          <button
            type="button"
            className={NAVY_SOLID}
            disabled={busy || lookupBlockedForPrivateHome}
            onClick={() => void lookup(query, "search")}
          >
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
        <p className="text-xs text-ink/60">{MESSAGES.sendNote}</p>
      </div>

      {draft.matches.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-bold text-ink">Matches</p>
          <ul className="space-y-2">
            {draft.matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => selectMatch(m)}
                  className="min-h-[44px] w-full rounded-card border-2 border-deep-navy bg-white px-3 py-2 text-left text-sm text-ink"
                >
                  {m.displayName || m.addressLine || m.area}
                  {m.level === "area" ? <span className="ml-1 text-xs text-ink/60">(area)</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink/60">
            Map data ©{" "}
            <a href={OSM_COPYRIGHT_URL} className="text-deep-navy underline" target="_blank" rel="noopener noreferrer">
              OpenStreetMap contributors
            </a>
          </p>
        </div>
      ) : null}

      <div>
        <p id={`${ids}-map-help`} className="mb-2 text-xs text-ink/70">
          Tap the map or drag the pin to place it. The buttons below move the pin 10 meters at a time.
        </p>
        <div
          ref={containerRef}
          role="application"
          aria-label="Map for placing the pin"
          aria-describedby={`${ids}-map-help`}
          className="h-72 w-full overflow-hidden rounded-card border border-board"
        />
      </div>

      {proposal ? (
        <div className="space-y-3 rounded-card border-2 border-deep-navy bg-paper p-3">
          <p className="font-bold text-ink">{CONFIRM_QUESTION}</p>
          {categorySlug === "lost-found" ? <p className="text-sm text-ink/80">{LOST_FOUND_LINE}</p> : null}
          {proposal.match ? (
            <p className="text-sm text-ink/80">{proposal.match.displayName || proposal.match.addressLine}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={NAVY_SOLID} onClick={() => dispatch({ type: "proposal_confirmed", rand: rand() })}>
              Yes, use this place
            </button>
            <button type="button" className={NAVY_BTN} onClick={() => dispatch({ type: "proposal_rejected" })}>
              No, choose another
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["n", "north"],
                ["s", "south"],
                ["e", "east"],
                ["w", "west"],
              ] as const
            ).map(([dir, name]) => (
              <button
                key={dir}
                type="button"
                className={NAVY_BTN}
                onClick={() => dispatch({ type: "pin_placed", point: nudgePin(proposal.point, dir) })}
              >
                Move pin {name}
              </button>
            ))}
          </div>
        </div>
      ) : confirmed ? (
        <p className="rounded-card border border-board bg-paper p-3 text-sm text-ink">
          Pin confirmed. Tap the map to choose a different place.
        </p>
      ) : (
        <p className="text-sm text-ink/70">No place chosen yet.</p>
      )}

      <div>
        <button type="button" className={NAVY_BTN} onClick={() => void handleUseMyLocation()} disabled={deviceBusy}>
          {deviceBusy ? "Finding you…" : "Use my location"}
        </button>
        <p className="mt-1 text-xs text-ink/60">
          Optional. Only use this if you are at the place now.
        </p>
      </div>

      <div>
        <label htmlFor={homeId} className="flex items-start gap-2 text-sm text-ink">
          <input
            id={homeId}
            type="checkbox"
            checked={draft.privateHome}
            onChange={(e) => {
              if (!e.target.checked) setPrivateHomeManualOnly(false);
              dispatch({ type: "private_home_set", value: e.target.checked, rand: rand() });
            }}
            className="mt-1 h-5 w-5 accent-deep-navy"
          />
          <span>This place is a private home</span>
        </label>
        <p className="mt-1 text-xs text-ink/70">{PRIVATE_HOME_EXPLANATION}</p>
        {/* Req 23.7: separate from the pin and the approximate-area note. */}
        <p className="mt-2 text-xs text-ink/70">{FLYER_IMAGE_WARNING}</p>
      </div>

      <div>
        <label htmlFor={labelId} className="block text-sm font-bold text-ink">
          {labels.field} (place label)
        </label>
        <input
          id={labelId}
          type="text"
          value={draft.label.text}
          maxLength={120}
          onChange={(e) => onLabelChange(e.target.value)}
          aria-describedby={`${labelId}-hint`}
          className="mt-1 min-h-[50px] w-full rounded-control border-2 border-deep-navy bg-white px-4 text-ink"
        />
        <p id={`${labelId}-hint`} className="mt-1 text-xs text-ink/70">
          {labels.hint}
        </p>
      </div>
    </section>
  );
}
