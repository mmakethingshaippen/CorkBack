"use client";

import { useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, TextAreaField } from "@/components/ui/Field";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { CATEGORIES } from "@/lib/categories";
import { categoryKind, fieldSpec, locationLabels } from "@/lib/postingKinds";
import { LocationPicker } from "@/components/map/LocationPicker";
import { StaticPinMap } from "@/components/map/StaticPinMap";
import { buildRetryBody, MESSAGES } from "@/components/map/locationPickerActions";
import { canPublishWithLeaks, findAddressLeaks, type AddressLeak } from "@/lib/addressLeaks";
import { timeZoneForPin } from "@/lib/lifecycle";
import {
  emptyDraft,
  locationReducer,
  publicPin,
  publishableLocation,
  type LocationDraft,
  type LocationEvent,
  type StoredPrecision,
} from "@/lib/postingLocation";
import { TAKEDOWN_ZONE_NOTE, takedownLine } from "@/lib/takedownLine";

export interface EditInitial {
  title: string;
  body: string;
  categorySlug: string;
  rsvpUrl: string;
  eventDate: string;
  eventTime: string;
  endDate: string;
  endTime: string;
  placeLabel: string;
}

/** Stored lifecycle values the takedown line needs. takedownAt is the saved Takedown_Time (ISO). */
export interface EditLifecycle {
  expiresAt: string;
  timeZone: string | null;
  lat: number;
  lng: number;
  takedownAt: string;
}

/** The stored pin, as read by the edit page. Precision comes from a separate read. */
export interface EditPin {
  lat: number;
  lng: number;
  precision: StoredPrecision;
}

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

const UNREVIEWED_NOTE = "This pin was set from where the posting was published. Check that it marks where this takes place.";
const CONFIRMED_NOTE = "The pin marks where this takes place.";
const APPROX_NOTE = "This posting already uses an approximate pin. To change it, choose the place again.";

/** The edit draft adds one event: back out of a location change and keep the stored pin. */
type EditEvent = LocationEvent | { type: "reset_to_stored" };

const COMMUNITY_SHORTER_NOTE = "Adding a date means this comes down when the event ends, if that is sooner.";
const SHORTER_NOTE = "This change makes your posting come down earlier than before.";

/** A calendar date ("YYYY-MM-DD") as "Nov 16", no time zone shift. */
function shortDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/**
 * Owner edit. Same fields and rules as the publish review form. The stored pin
 * is shown on a read-only map and nothing about it is sent unless the owner
 * opens the picker and confirms a new place. How long the posting stays up and
 * the flyer image cannot be changed. One dark-red main action: "Save changes".
 * Failure keeps everything entered, including a chosen pin whose save failed.
 */
export function EditPostingForm({
  postingId,
  initial,
  pin,
  lifecycle,
}: {
  postingId: string;
  initial: EditInitial;
  pin: EditPin;
  lifecycle: EditLifecycle;
}) {
  const router = useRouter();
  // The stored pin and label enter the draft through existing_loaded. It never sets a confirmed pin.
  const loadStored = (label: string): LocationDraft =>
    locationReducer(emptyDraft(), { type: "existing_loaded", point: { lat: pin.lat, lng: pin.lng }, precision: pin.precision, label });
  const [draft, dispatch] = useReducer(
    (d: LocationDraft, e: EditEvent): LocationDraft =>
      e.type === "reset_to_stored" ? { ...loadStored(d.label.text), label: d.label } : locationReducer(d, e),
    initial.placeLabel,
    loadStored,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [leaksAck, setLeaksAck] = useState(false);
  // Two-step save: the content saved but the location did not. The chosen pin stays in the draft.
  const [locationFailed, setLocationFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [locationSaved, setLocationSaved] = useState(false);
  const retryLock = useRef(false);
  const storedKind = categoryKind(initial.categorySlug);
  // A listing stored with an old event date opens with that date as its Deadline. Nothing is written until save.
  const legacyDate = storedKind === "listing" && initial.eventDate ? initial.eventDate : null;
  const [v, setV] = useState(initial);
  const [deadline, setDeadline] = useState(storedKind === "listing" ? (legacyDate ?? initial.endDate) : "");
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "error"; text?: string }>({ kind: "idle" });
  const lock = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const set = <K extends keyof EditInitial>(k: K, val: EditInitial[K]) => setV((cur) => ({ ...cur, [k]: val }));

  const kind = categoryKind(v.categorySlug);
  const spec = fieldSpec(v.categorySlug, { hasEventDate: Boolean(v.eventDate) });
  const optionalNoDate = kind === "event-optional" && !v.eventDate;
  const placeLabel = draft.label.text;
  const labels = locationLabels(v.categorySlug, { hasEventDate: Boolean(v.eventDate) });
  // The pin visitors would see after saving: only present once the owner confirmed a new place.
  const newPin = publicPin(draft);
  const newPinLat = newPin?.lat;
  const newPinLng = newPin?.lng;
  const newZone = useMemo(
    () => (newPinLat !== undefined && newPinLng !== undefined ? timeZoneForPin(newPinLat, newPinLng) : null),
    [newPinLat, newPinLng],
  );
  const leaks: AddressLeak[] = useMemo(
    () =>
      findAddressLeaks(
        { title: v.title, body: v.body, placeLabel },
        [],
        draft.confirmed?.match ? { addressLine: draft.confirmed.match.addressLine } : null,
        (draft.confirmed ? draft.privateHome : pin.precision === "approximate") ? "approximate" : "exact",
      ),
    [v.title, v.body, placeLabel, draft.confirmed, draft.privateHome, pin.precision],
  );

  // Notices shown before saving. The legacy flag is sent only when one of these was on screen.
  const legacyNotice = kind === "listing" && legacyDate ? legacyDate : null;
  const eventToListing = kind === "listing" && storedKind !== "listing";
  const replaceLegacyEventDate = Boolean(legacyNotice) || (eventToListing && Boolean(initial.eventDate));

  // Takedown line: derived from state on every render, so it is current immediately after any change.
  const takedown = useMemo(() => {
    const base = { expiresAt: lifecycle.expiresAt, timeZone: newZone ?? lifecycle.timeZone, categorySlug: v.categorySlug };
    let fields: { eventDate: string | null; endDate: string | null; endTime: string | null };
    if (kind === "listing") fields = { eventDate: null, endDate: deadline || null, endTime: null };
    else if (kind === "event-optional" && !v.eventDate) fields = { eventDate: null, endDate: null, endTime: null };
    else fields = { eventDate: v.eventDate || null, endDate: v.endDate || null, endTime: v.endTime || null };
    return takedownLine({ ...base, ...fields });
  }, [lifecycle.expiresAt, lifecycle.timeZone, newZone, v.categorySlug, v.eventDate, v.endDate, v.endTime, deadline, kind]);

  const earlier = takedown.at.getTime() < new Date(lifecycle.takedownAt).getTime();
  const communityAddsDate = kind === "event-optional" && storedKind === "event-optional" && !initial.eventDate && Boolean(v.eventDate);
  const shorterNote = earlier ? (communityAddsDate ? COMMUNITY_SHORTER_NOTE : SHORTER_NOTE) : null;

  function payload() {
    const common = { title: v.title, body: v.body, categorySlug: v.categorySlug, rsvpUrl: v.rsvpUrl || null, placeLabel };
    // The location block is sent only when the owner confirmed a new place. Otherwise the stored pin is not touched.
    const location = publishableLocation(draft);
    const withLocation = location ? { ...common, location } : common;
    // Only the fields of the current kind are sent; hidden fields keep their typed values in state.
    if (kind === "listing") return { ...withLocation, deadline: deadline || null, replaceLegacyEventDate };
    if (optionalNoDate) return { ...withLocation, eventDate: null, eventTime: null, endDate: null, endTime: null };
    return { ...withLocation, eventDate: v.eventDate || null, eventTime: v.eventTime || null, endDate: v.endDate || null, endTime: v.endTime || null };
  }

  function focusStatus() {
    setTimeout(() => statusRef.current?.focus(), 0);
  }

  /** Retry sends only the location block, built from the kept draft. No content fields. */
  async function retryLocation() {
    if (retryLock.current) return;
    const body = buildRetryBody(draft);
    if (!body) {
      setStatus({ kind: "error", text: "Choose where this takes place on the map, then save again." });
      focusStatus();
      return;
    }
    retryLock.current = true;
    setRetrying(true);
    try {
      const res = await fetch(`/api/postings/${postingId}/location`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        dispatch({ type: "location_save_failed" });
        setStatus({ kind: "error", text: data.error ?? "The location was not saved. Try again." });
        focusStatus();
        return;
      }
      setLocationFailed(false);
      setLocationSaved(true);
      setStatus({ kind: "idle" });
      router.refresh();
    } catch {
      setStatus({ kind: "error", text: "Couldn't reach CorkBack. Your chosen location is kept here; try again." });
      focusStatus();
    } finally {
      retryLock.current = false;
      setRetrying(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (!canPublishWithLeaks(leaks, leaksAck)) {
      setStatus({ kind: "error", text: "Check the box to confirm your posting does not show a home or personal address." });
      document.getElementById("leaksAck")?.focus();
      return;
    }
    lock.current = true;
    setStatus({ kind: "saving" });
    setLocationSaved(false);
    try {
      const res = await fetch(`/api/postings/${postingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) {
        if (res.status === 500 && data.code === "location_failed") {
          // The content is saved. The chosen pin and precision stay in the draft for Retry.
          dispatch({ type: "location_save_failed" });
          setLocationFailed(true);
          setPickerOpen(false);
          setStatus({ kind: "idle" });
          focusStatus();
          return;
        }
        setStatus({ kind: "error", text: data.error ?? "Couldn't save your changes. They are kept here; try again." });
        focusStatus();
        return;
      }
      router.push(`/p/${postingId}`);
      router.refresh();
    } catch {
      setStatus({ kind: "error", text: "Couldn't reach CorkBack. Your changes are kept here; try again." });
      setTimeout(() => statusRef.current?.focus(), 0);
    } finally {
      lock.current = false;
    }
  }

  return (
    <form onSubmit={save} className="space-y-5" aria-busy={status.kind === "saving"}>
      <Field label="Title" name="title" value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={140} required />

      {kind === "listing" ? (
        <Field
          label={spec.deadlineLabel ?? "Deadline (optional)"}
          name="deadline"
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          hint={spec.deadlineHint ?? undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={kind === "event-optional" ? "Event date (optional)" : "Event date"}
              name="eventDate"
              type="date"
              value={v.eventDate}
              onChange={(e) => set("eventDate", e.target.value)}
              hint={kind === "event-optional" ? "Add a date if this is an event. Without one, your posting stays up for the duration you choose." : undefined}
            />
            <Field label="Time" name="eventTime" value={v.eventTime} onChange={(e) => set("eventTime", e.target.value)} placeholder="19:30" disabled={optionalNoDate} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="End date (optional)" name="endDate" type="date" value={v.endDate} min={v.eventDate || undefined} onChange={(e) => set("endDate", e.target.value)} disabled={optionalNoDate} />
            <Field label="End time (optional)" name="endTime" type="time" value={v.endTime} onChange={(e) => set("endTime", e.target.value)} disabled={optionalNoDate} />
          </div>
          <p className="-mt-3 text-xs text-ink/60">
            Without an end, an event comes down at the end of its event day, in local time where it is pinned.
          </p>
        </>
      )}

      {legacyNotice ? (
        <p role="note" className="rounded-card border-2 border-board bg-board/40 p-3 text-sm text-ink">
          This posting has an event date ({shortDate(legacyNotice)}). Listings use a deadline instead. Saving replaces the event date with the deadline above.
        </p>
      ) : null}
      {eventToListing ? (
        <p role="note" className="rounded-card border-2 border-board bg-board/40 p-3 text-sm text-ink">
          Listings use a deadline instead of an event date. Saving removes the event date, event time and end time.
        </p>
      ) : null}

      <div aria-live="polite" className="text-sm text-ink">
        <p className="font-bold">{takedown.text}</p>
        <p className="mt-1 text-xs text-ink/60">{TAKEDOWN_ZONE_NOTE}</p>
        {shorterNote ? <p role="note" className="mt-1 text-dark-red">{shorterNote}</p> : null}
      </div>

      {pickerOpen ? null : (
        <Field
          label={labels.field}
          name="placeLabel"
          value={placeLabel}
          onChange={(e) => dispatch({ type: "label_typed", text: e.target.value })}
          hint={labels.hint}
        />
      )}
      <TextAreaField label="Details" name="body" rows={5} value={v.body} onChange={(e) => set("body", e.target.value)} />

      <div role="group" aria-label="Category">
        <p className="mb-2 text-sm font-bold text-ink">Category</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <CategoryChip key={c.slug} label={c.label} selected={v.categorySlug === c.slug} onClick={() => set("categorySlug", c.slug)} />
          ))}
        </div>
      </div>

      <Field label={spec.actionLabel} name="rsvpUrl" value={v.rsvpUrl} onChange={(e) => set("rsvpUrl", e.target.value)} hint={spec.actionHint} placeholder="https://" />

      <section aria-label="Location" className="space-y-3 rounded-card border border-board bg-white p-4">
        <h2 className="text-[19px] font-bold text-ink">Location</h2>
        {pickerOpen ? (
          <>
            <LocationPicker
              categorySlug={v.categorySlug}
              hasEventDate={Boolean(v.eventDate)}
              candidates={[]}
              initial={{ point: { lat: pin.lat, lng: pin.lng }, precision: pin.precision, label: initial.placeLabel }}
              draft={draft}
              dispatch={dispatch}
              onLabelChange={(text) => dispatch({ type: "label_typed", text })}
            />
            <button
              type="button"
              className="min-h-[44px] rounded-control border-2 border-deep-navy bg-white px-5 text-sm font-bold text-deep-navy"
              onClick={() => {
                dispatch({ type: "reset_to_stored" });
                setPickerOpen(false);
              }}
            >
              Keep the current location
            </button>
          </>
        ) : (
          <>
            <StaticPinMap
              lat={newPin ? newPin.lat : pin.lat}
              lng={newPin ? newPin.lng : pin.lng}
              label={newPin ? "Map of the new location" : "Map of the current location"}
            />
            {draft.confirmed ? (
              <p className="text-sm text-ink">
                New location chosen. It is saved when you select Save changes.
                {draft.privateHome ? " Visitors will see an approximate pin." : ""}
              </p>
            ) : (
              <p role="note" className="text-sm text-ink/80">
                {pin.precision === "unreviewed" ? UNREVIEWED_NOTE : CONFIRMED_NOTE}
              </p>
            )}
            {pin.precision === "approximate" && !draft.confirmed ? (
              <div>
                <label className="flex items-start gap-2 text-sm text-ink">
                  <input type="checkbox" checked disabled readOnly className="mt-1 h-5 w-5 accent-deep-navy" />
                  <span>This place is a private home</span>
                </label>
                <p className="mt-1 text-xs text-ink/70">{APPROX_NOTE}</p>
              </div>
            ) : null}
            <button
              type="button"
              className="min-h-[44px] rounded-control border-2 border-deep-navy bg-white px-5 text-sm font-bold text-deep-navy"
              onClick={() => setPickerOpen(true)}
            >
              Change location
            </button>
          </>
        )}
        {locationFailed ? (
          <div role="alert" className="rounded-card border-2 border-deep-navy bg-paper p-3 text-sm text-ink">
            <p className="font-bold">{MESSAGES.saveFailed}</p>
            <button
              type="button"
              onClick={() => void retryLocation()}
              disabled={retrying}
              className="mt-2 min-h-[44px] rounded-control border-2 border-deep-navy bg-white px-5 text-sm font-bold text-deep-navy disabled:opacity-60"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : null}
        {locationSaved ? (
          <p role="status" className="rounded-card border-2 border-board bg-board/40 p-3 text-sm font-bold text-ink">
            Location saved.
          </p>
        ) : null}
      </section>

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

      <div className="rounded-card border border-board bg-board/20 p-4 text-sm">
        <p className="font-bold text-ink">Fixed after publishing</p>
        <p className="mt-1 text-ink/70">How long the posting stays on the board and the flyer image can&apos;t be changed. To change them, delete this posting and publish a new one.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={status.kind === "saving"} aria-disabled={status.kind === "saving"} className="inline-flex min-h-[50px] items-center rounded-control bg-dark-red px-6 font-bold text-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy focus-visible:ring-offset-2">
          {status.kind === "saving" ? "Saving…" : "Save changes"}
        </button>
        <Link href={`/p/${postingId}`} className="inline-flex min-h-[44px] items-center font-bold text-deep-navy underline-offset-2 hover:underline">
          Cancel
        </Link>
      </div>
      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="min-h-[1.25rem] text-sm font-bold text-dark-red outline-none">
        {status.kind === "error" ? status.text : null}
      </p>
    </form>
  );
}
