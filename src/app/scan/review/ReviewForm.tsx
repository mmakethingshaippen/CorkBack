"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, TextAreaField } from "@/components/ui/Field";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { CATEGORIES } from "@/lib/categories";
import { EXPIRY_PRESETS, type ExpiryPreset } from "@/lib/domain";
import type { ExtractedFlyer } from "@/lib/types";

const PRESET_LABEL: Record<ExpiryPreset, string> = {
  "24h": "24 hours",
  "3d": "3 days",
  "1w": "1 week",
  "2w": "2 weeks",
  "1m": "1 month",
};

/**
 * Review step: every extracted field is editable before anything is published.
 * Category chips, expiry presets, optional RSVP link, and a current-pin block.
 * The one dark-red main action is "Publish to the map".
 */
export function ReviewForm() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [placeLabel, setPlaceLabel] = useState("");
  const [category, setCategory] = useState<string>("community");
  const [rsvpUrl, setRsvpUrl] = useState("");
  const [expiry, setExpiry] = useState<ExpiryPreset>("1w");
  const [locationAllowed, setLocationAllowed] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("corkback.extracted");
    if (raw) {
      const e = JSON.parse(raw) as ExtractedFlyer;
      setTitle(e.title ?? "");
      setBody(e.body ?? "");
      setEventDate(e.eventDate ?? "");
      setEventTime(e.eventTime ?? "");
      setPlaceLabel(e.placeLabel ?? "");
      setCategory(e.categorySlug ?? "community");
      setRsvpUrl(e.rsvpUrl ?? "");
    }
    setLoaded(true);
  }, []);

  function requestLocation() {
    if (!("geolocation" in navigator)) {
      setStatus("Location is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationAllowed(true);
      },
      () => setStatus("Location permission is needed to pin your flyer."),
    );
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!coords) {
      setStatus("Allow your current location to place the pin before publishing.");
      return;
    }
    setStatus("Publishing…");
    const res = await fetch("/api/postings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        body,
        categorySlug: category,
        eventDate: eventDate || null,
        eventTime: eventTime || null,
        placeLabel,
        rsvpUrl: rsvpUrl || null,
        expiry,
        real: coords,
        desired: coords, // nudge handled server-side; no manual drag in Stage 1
      }),
    });
    const resp = await res.json();
    if (res.ok) {
      sessionStorage.removeItem("corkback.extracted");
      router.push(`/p/${resp.id}`);
    } else {
      setStatus(resp.error ?? "Publishing failed.");
    }
  }

  if (!loaded) return null;

  return (
    <form onSubmit={publish} className="space-y-5">
      <Field label="Title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Event date" name="eventDate" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        <Field label="Time" name="eventTime" value={eventTime} onChange={(e) => setEventTime(e.target.value)} placeholder="19:30" />
      </div>

      <Field
        label="Event place"
        name="placeLabel"
        value={placeLabel}
        onChange={(e) => setPlaceLabel(e.target.value)}
        hint="This is the text on the flyer, not the map pin."
      />

      <TextAreaField label="Details" name="body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />

      <div>
        <p className="mb-2 text-sm font-bold text-ink">Category</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <CategoryChip key={c.slug} label={c.label} selected={category === c.slug} onClick={() => setCategory(c.slug)} />
          ))}
        </div>
      </div>

      <Field
        label="RSVP link (optional)"
        name="rsvpUrl"
        value={rsvpUrl}
        onChange={(e) => setRsvpUrl(e.target.value)}
        hint="Optional. Exactly one external link, shown as a public button."
        placeholder="https://"
      />

      <div>
        <p className="mb-2 text-sm font-bold text-ink">Keep this posting on the board for</p>
        <div className="flex flex-wrap gap-2">
          {EXPIRY_PRESETS.map((p) => (
            <CategoryChip key={p} label={PRESET_LABEL[p]} selected={expiry === p} onClick={() => setExpiry(p)} />
          ))}
        </div>
        <p className="mt-1 text-xs text-ink/60">Events also come down after the event date passes. You can delete a posting at any time.</p>
      </div>

      <div className="rounded-card border border-board bg-board/20 p-4 text-sm">
        <p className="font-bold text-ink">
          Your current pin · {locationAllowed ? "Location allowed" : "Location needed"}
        </p>
        <p className="mt-1 text-ink/70">
          Your flyer pins near where you are, not at a venue read from the paper. Your exact location is never shown publicly.
        </p>
        {!locationAllowed ? (
          <button type="button" onClick={requestLocation} className="mt-2 rounded-control border border-deep-navy px-4 py-2 font-bold text-deep-navy">
            Use my current location
          </button>
        ) : (
          <p className="mt-2 text-ink">Pin set near your current location.</p>
        )}
      </div>

      {/* One dark-red main action per screen. */}
      <button type="submit" className="w-full rounded-control bg-dark-red px-5 py-3 font-bold text-white">
        Publish to the map
      </button>

      {status ? <p className="text-sm text-ink/70">{status}</p> : null}
    </form>
  );
}
