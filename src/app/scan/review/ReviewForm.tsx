"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, TextAreaField } from "@/components/ui/Field";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { CATEGORIES } from "@/lib/categories";
import { EXPIRY_PRESETS, computeExpiresAt, type ExpiryPreset } from "@/lib/domain";
import { isIsoDate, timeZoneForPin } from "@/lib/lifecycle";
import { fieldSpec } from "@/lib/postingKinds";
import { LocationPicker } from "@/components/map/LocationPicker";
import { canPublishWithLeaks, findAddressLeaks, type AddressLeak } from "@/lib/addressLeaks";
import { parseStoredExtraction, type AddressCandidate } from "@/lib/addressCandidates";
import { emptyDraft, locationReducer, publicPin, publishableLocation } from "@/lib/postingLocation";
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
 * Category chips, expiry presets, optional RSVP link, and the location picker.
 * Nothing here reads the device location. The pin is whatever the poster confirms.
 * The one dark-red main action is "Publish to the map".
 */
const LEAK_FIELD: Record<AddressLeak["field"], string> = {
  title: "Title",
  body: "Details",
  placeLabel: "Place label",
};
const LEAK_KIND: Record<AddressLeak["reason"], string> = {
  candidate: "street address",
  pattern: "street address",
  phone: "phone number",
  email: "email address",
};

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
  const [draft, dispatch] = useReducer(locationReducer, undefined, emptyDraft);
  const [candidates, setCandidates] = useState<AddressCandidate[]>([]);
  const [leaksAck, setLeaksAck] = useState(false);
  const [scanUnreadable, setScanUnreadable] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<string>("community");
  const [rsvpUrl, setRsvpUrl] = useState("");
  const [expiry, setExpiry] = useState<ExpiryPreset>("1w");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem("corkback.extracted");
    if (raw) {
      const e: ExtractedFlyer | null = parseStoredExtraction(raw);
      if (!e) {
        setScanUnreadable(true);
      } else {
      setTitle(e.title ?? "");
      setBody(e.body ?? "");
      setEventDate(e.eventDate ?? "");
      setDeadline(isIsoDate(e.eventDate) ? e.eventDate : "");
      setYearUncertain(Boolean(e.eventDate) && e.eventDateYearPrinted !== true);
      setEventTime(e.eventTime ?? "");
      setCategory(e.categorySlug || "community");
      setRsvpUrl(e.rsvpUrl ?? "");
      const found = e.addresses ?? [];
      setCandidates(found);
      dispatch({ type: "extracted", candidates: found });
      if (e.placeLabel) dispatch({ type: "label_typed", text: e.placeLabel });
      }
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
  const pin = publicPin(draft);
  const pinLat = pin?.lat;
  const pinLng = pin?.lng;
  const pinZone = useMemo(
    () => (pinLat !== undefined && pinLng !== undefined ? timeZoneForPin(pinLat, pinLng) : null),
    [pinLat, pinLng],
  );
  const placeLabel = draft.label.text;
  const leaks: AddressLeak[] = useMemo(
    () =>
      findAddressLeaks(
        { title, body, placeLabel },
        candidates,
        draft.confirmed?.match ? { addressLine: draft.confirmed.match.addressLine } : null,
        draft.privateHome ? "approximate" : "exact",
      ),
    [title, body, placeLabel, candidates, draft.confirmed, draft.privateHome],
  );
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

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (needsDateConfirmation && !dateConfirmed) {
      setStatus("Confirm the full event date, including the year, before publishing.");
      document.getElementById("dateConfirmed")?.focus();
      return;
    }
    const location = publishableLocation(draft);
    if (!location) {
      setStatus("Choose where this takes place on the map before publishing.");
      pickerRef.current?.focus();
      return;
    }
    if (!canPublishWithLeaks(leaks, leaksAck)) {
      setStatus("Check the box to confirm your posting does not show a home or personal address.");
      document.getElementById("leaksAck")?.focus();
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
        location,
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
      {scanUnreadable ? (
        <p className="rounded-card border-2 border-deep-navy bg-white p-3 text-sm text-ink">
          We could not read the saved scan. Enter the details below.
        </p>
      ) : null}
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

      <div ref={pickerRef} tabIndex={-1} className="outline-none">
        <LocationPicker
          categorySlug={category}
          hasEventDate={hasEventDate}
          candidates={candidates}
          draft={draft}
          dispatch={dispatch}
          onLabelChange={(text) => dispatch({ type: "label_typed", text })}
        />
      </div>

      <p className="text-sm text-ink/70">The flyer photo is not published. Only the text you see here goes public.</p>

      {leaks.length > 0 ? (
        <div id="leaks-warning" className="rounded-card border-2 border-dark-red bg-white p-4 text-sm">
          <p className="font-bold text-ink">Check for personal details</p>
          <p className="mt-1 text-ink/80">
            Your posting includes a street address, phone number or email address that may be personal.
            You can keep public venue or organizer contact details. Remove anything that belongs to a
            home or a private person.
          </p>
          <ul className="mt-2 list-disc pl-5 text-ink">
            {leaks.map((l, i) => (
              <li key={`${l.field}-${l.reason}-${i}`}>
                {LEAK_FIELD[l.field]}: {LEAK_KIND[l.reason]} <span className="font-bold">{l.text}</span>
              </li>
            ))}
          </ul>
          <label htmlFor="leaksAck" className="mt-2 flex items-start gap-2 text-ink">
            <input
              id="leaksAck"
              type="checkbox"
              checked={leaksAck}
              onChange={(e) => setLeaksAck(e.target.checked)}
              className="mt-1 h-4 w-4 accent-deep-navy"
            />
            <span>I checked this. Anything personal is removed. Public venue or organizer details can stay.</span>
          </label>
        </div>
      ) : null}
      {/* One dark-red main action per screen. */}
      <button type="submit" className="w-full rounded-control bg-dark-red px-5 py-3 font-bold text-white">
        Publish to the map
      </button>

      {status ? <p className="text-sm text-ink/70">{status}</p> : null}
    </form>
  );
}
