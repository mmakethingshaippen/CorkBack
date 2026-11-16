"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, TextAreaField } from "@/components/ui/Field";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { CATEGORIES } from "@/lib/categories";
import { EXPIRY_PRESETS, computeExpiresAt, type ExpiryPreset } from "@/lib/domain";
import { isIsoDate, timeZoneForPin } from "@/lib/lifecycle";
import { fieldSpec } from "@/lib/postingKinds";
import { TAKEDOWN_ZONE_NOTE, takedownLine } from "@/lib/takedownLine";
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
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  // Listing Deadline. Pre-filled from a readable scanned date, clearable.
  const [deadline, setDeadline] = useState("");
  // Set after mount (never during render) so the takedown preview is stable.
  const [now, setNow] = useState<Date | null>(null);
  // A scanned date whose year was not printed on the flyer is uncertain: the
  // poster must confirm the full date before publishing. Never assume silently.
  const [yearUncertain, setYearUncertain] = useState(false);
  const [dateConfirmed, setDateConfirmed] = useState(false);
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
      setDeadline(isIsoDate(e.eventDate) ? e.eventDate : "");
      setYearUncertain(Boolean(e.eventDate) && e.eventDateYearPrinted !== true);
      setEventTime(e.eventTime ?? "");
      setPlaceLabel(e.placeLabel ?? "");
      setCategory(e.categorySlug ?? "community");
      setRsvpUrl(e.rsvpUrl ?? "");
    }
    setNow(new Date());
    setLoaded(true);
  }, []);

  const hasEventDate = Boolean(eventDate);
  const spec = fieldSpec(category, { hasEventDate });
  const isListing = spec.kind === "listing";
  // The date the poster must confirm: the Deadline for listings, else the event date.
  const activeDate = isListing ? deadline : eventDate;
  const needsDateConfirmation = yearUncertain && Boolean(activeDate);
  const pinZone = useMemo(() => (coords ? timeZoneForPin(coords.lat, coords.lng) : null), [coords]);
  const takedown = useMemo(() => {
    if (!now) return null;
    return takedownLine({
      categorySlug: category,
      expiresAt: computeExpiresAt(now, expiry),
      eventDate: isListing ? null : eventDate || null,
      endDate: isListing ? deadline || null : eventDate ? endDate || null : null,
      endTime: isListing || !eventDate ? null : endTime || null,
      timeZone: pinZone,
    });
  }, [now, category, expiry, isListing, eventDate, endDate, endTime, deadline, pinZone]);

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
    if (needsDateConfirmation && !dateConfirmed) {
      setStatus("Confirm the full event date, including the year, before publishing.");
      document.getElementById("dateConfirmed")?.focus();
      return;
    }
    if (!coords) {
      setStatus("Allow your current location to place the pin before publishing.");
      return;
    }
    // Only the current kind's fields are sent; hidden values stay in state.
    const dateFields = isListing
      ? { deadline: deadline || null }
      : {
          eventDate: eventDate || null,
          eventTime: hasEventDate ? eventTime || null : null,
          endDate: hasEventDate ? endDate || null : null,
          endTime: hasEventDate ? endTime || null : null,
        };
    setStatus("Publishing…");
    const res = await fetch("/api/postings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        body,
        categorySlug: category,
        ...dateFields,
        dateNeedsConfirmation: needsDateConfirmation,
        dateConfirmed: needsDateConfirmation ? dateConfirmed : undefined,
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

  const fullDateLabel = activeDate
    ? new Date(`${activeDate}T00:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  return (
    <form onSubmit={publish} className="space-y-5">
      <Field label="Title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} />

      {isListing ? (
        <Field
          label={spec.deadlineLabel ?? "Deadline (optional)"}
          name="deadline"
          type="date"
          value={deadline}
          hint={spec.deadlineHint ?? undefined}
          onChange={(e) => {
            setDeadline(e.target.value);
            setDateConfirmed(false); // a changed date must be confirmed again
          }}
          aria-describedby={needsDateConfirmation ? "year-warning" : undefined}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={spec.eventDateOptional ? "Event date (optional)" : "Event date"}
            name="eventDate"
            type="date"
            value={eventDate}
            onChange={(e) => {
              setEventDate(e.target.value);
              setDateConfirmed(false); // a changed date must be confirmed again
            }}
            aria-describedby={needsDateConfirmation ? "year-warning" : undefined}
            hint={spec.kind === "event-optional" ? "Leave empty for a general notice." : undefined}
          />
          <Field
            label="Time"
            name="eventTime"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
            placeholder="19:30"
            disabled={spec.kind === "event-optional" && !hasEventDate}
          />
        </div>
      )}

      {needsDateConfirmation ? (
        <div id="year-warning" className="rounded-card border-2 border-dark-red bg-white p-4 text-sm">
          <p className="font-bold text-ink">Check the year</p>
          <p className="mt-1 text-ink/80">
            The flyer does not show a year, so the year above is a guess. Check the full date before
            publishing.
          </p>
          <label htmlFor="dateConfirmed" className="mt-2 flex items-start gap-2 text-ink">
            <input
              id="dateConfirmed"
              type="checkbox"
              checked={dateConfirmed}
              onChange={(e) => setDateConfirmed(e.target.checked)}
              className="mt-1 h-4 w-4 accent-deep-navy"
            />
            <span>
              I checked the full date: <span className="font-bold">{fullDateLabel}</span>
            </span>
          </label>
        </div>
      ) : null}

      {isListing ? null : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="End date (optional)"
              name="endDate"
              type="date"
              value={endDate}
              min={eventDate || undefined}
              disabled={spec.kind === "event-optional" && !hasEventDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <Field
              label="End time (optional)"
              name="endTime"
              type="time"
              value={endTime}
              disabled={spec.kind === "event-optional" && !hasEventDate}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
          <p className="-mt-3 text-xs text-ink/60">
            Without an end, an event comes down at the end of its event day, in local time where it is
            pinned.
          </p>
        </>
      )}

      <Field
        label={isListing ? "Place (optional)" : "Event place"}
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
        label={spec.actionLabel}
        name="rsvpUrl"
        value={rsvpUrl}
        onChange={(e) => setRsvpUrl(e.target.value)}
        hint={`${spec.actionHint} Shown as a public button.`}
        placeholder="https://"
      />

      <div>
        <p className="mb-2 text-sm font-bold text-ink">Keep this posting on the board for</p>
        <div className="flex flex-wrap gap-2">
          {EXPIRY_PRESETS.map((p) => (
            <CategoryChip key={p} label={PRESET_LABEL[p]} selected={expiry === p} onClick={() => setExpiry(p)} />
          ))}
        </div>
        {takedown ? (
          <p className="mt-2 text-sm text-ink" data-testid="takedown-line">
            {takedown.text}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-ink/60">
          {TAKEDOWN_ZONE_NOTE} You can delete a posting at any time.
        </p>
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
