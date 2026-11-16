"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, TextAreaField } from "@/components/ui/Field";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { CATEGORIES } from "@/lib/categories";
import { categoryKind, fieldSpec } from "@/lib/postingKinds";
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

const COMMUNITY_SHORTER_NOTE = "Adding a date means this comes down when the event ends, if that is sooner.";
const SHORTER_NOTE = "This change makes your posting come down earlier than before.";

/** A calendar date ("YYYY-MM-DD") as "Nov 16", no time zone shift. */
function shortDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

/**
 * Owner edit. Same fields and rules as the publish review form, minus what is
 * fixed at publish: the pin location, how long it stays up, and the flyer are
 * shown but cannot be changed. One dark-red main action: "Save changes".
 * Failure keeps everything entered.
 */
export function EditPostingForm({
  postingId,
  initial,
  pinNote,
  lifecycle,
}: {
  postingId: string;
  initial: EditInitial;
  pinNote: string;
  lifecycle: EditLifecycle;
}) {
  const router = useRouter();
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

  // Notices shown before saving. The legacy flag is sent only when one of these was on screen.
  const legacyNotice = kind === "listing" && legacyDate ? legacyDate : null;
  const eventToListing = kind === "listing" && storedKind !== "listing";
  const replaceLegacyEventDate = Boolean(legacyNotice) || (eventToListing && Boolean(initial.eventDate));

  // Takedown line: derived from state on every render, so it is current immediately after any change.
  const takedown = useMemo(() => {
    const base = { expiresAt: lifecycle.expiresAt, timeZone: lifecycle.timeZone, categorySlug: v.categorySlug };
    let fields: { eventDate: string | null; endDate: string | null; endTime: string | null };
    if (kind === "listing") fields = { eventDate: null, endDate: deadline || null, endTime: null };
    else if (kind === "event-optional" && !v.eventDate) fields = { eventDate: null, endDate: null, endTime: null };
    else fields = { eventDate: v.eventDate || null, endDate: v.endDate || null, endTime: v.endTime || null };
    return takedownLine({ ...base, ...fields });
  }, [lifecycle.expiresAt, lifecycle.timeZone, v.categorySlug, v.eventDate, v.endDate, v.endTime, deadline, kind]);

  const earlier = takedown.at.getTime() < new Date(lifecycle.takedownAt).getTime();
  const communityAddsDate = kind === "event-optional" && storedKind === "event-optional" && !initial.eventDate && Boolean(v.eventDate);
  const shorterNote = earlier ? (communityAddsDate ? COMMUNITY_SHORTER_NOTE : SHORTER_NOTE) : null;

  function payload() {
    const common = { title: v.title, body: v.body, categorySlug: v.categorySlug, rsvpUrl: v.rsvpUrl || null, placeLabel: v.placeLabel };
    // Only the fields of the current kind are sent; hidden fields keep their typed values in state.
    if (kind === "listing") return { ...common, deadline: deadline || null, replaceLegacyEventDate };
    if (optionalNoDate) return { ...common, eventDate: null, eventTime: null, endDate: null, endTime: null };
    return { ...common, eventDate: v.eventDate || null, eventTime: v.eventTime || null, endDate: v.endDate || null, endTime: v.endTime || null };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setStatus({ kind: "saving" });
    try {
      const res = await fetch(`/api/postings/${postingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus({ kind: "error", text: data.error ?? "Couldn't save your changes. They are kept here; try again." });
        setTimeout(() => statusRef.current?.focus(), 0);
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

      <Field
        label={kind === "listing" ? "Place (optional)" : "Event place"}
        name="placeLabel"
        value={v.placeLabel}
        onChange={(e) => set("placeLabel", e.target.value)}
        hint="This is the text on the flyer, not the map pin."
      />
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

      <div className="rounded-card border border-board bg-board/20 p-4 text-sm">
        <p className="font-bold text-ink">Fixed after publishing</p>
        <p className="mt-1 text-ink/70">{pinNote}</p>
        <p className="mt-1 text-ink/70">The pin, how long the posting stays on the board, and the flyer image can&apos;t be changed. To change them, delete this posting and publish a new one.</p>
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
