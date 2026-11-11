"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, TextAreaField } from "@/components/ui/Field";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { CATEGORIES } from "@/lib/categories";

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

/**
 * Owner edit. Same fields and rules as the publish review form, minus what is
 * fixed at publish: the pin location, how long it stays up, and the flyer are
 * shown but cannot be changed. One dark-red main action: "Save changes".
 * Failure keeps everything entered.
 */
export function EditPostingForm({ postingId, initial, pinNote }: { postingId: string; initial: EditInitial; pinNote: string }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "error"; text?: string }>({ kind: "idle" });
  const lock = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const set = <K extends keyof EditInitial>(k: K, val: EditInitial[K]) => setV((cur) => ({ ...cur, [k]: val }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setStatus({ kind: "saving" });
    try {
      const res = await fetch(`/api/postings/${postingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: v.title, body: v.body, categorySlug: v.categorySlug, rsvpUrl: v.rsvpUrl || null,
          eventDate: v.eventDate || null, eventTime: v.eventTime || null, endDate: v.endDate || null, endTime: v.endTime || null,
          placeLabel: v.placeLabel,
        }),
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

      <div className="grid grid-cols-2 gap-3">
        <Field label="Event date" name="eventDate" type="date" value={v.eventDate} onChange={(e) => set("eventDate", e.target.value)} />
        <Field label="Time" name="eventTime" value={v.eventTime} onChange={(e) => set("eventTime", e.target.value)} placeholder="19:30" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="End date (optional)" name="endDate" type="date" value={v.endDate} min={v.eventDate || undefined} onChange={(e) => set("endDate", e.target.value)} />
        <Field label="End time (optional)" name="endTime" type="time" value={v.endTime} onChange={(e) => set("endTime", e.target.value)} />
      </div>
      <p className="-mt-3 text-xs text-ink/60">
        Without an end, an event comes down at the end of its event day, in local time where it is pinned.
      </p>

      <Field label="Event place" name="placeLabel" value={v.placeLabel} onChange={(e) => set("placeLabel", e.target.value)} hint="This is the text on the flyer, not the map pin." />
      <TextAreaField label="Details" name="body" rows={5} value={v.body} onChange={(e) => set("body", e.target.value)} />

      <div role="group" aria-label="Category">
        <p className="mb-2 text-sm font-bold text-ink">Category</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <CategoryChip key={c.slug} label={c.label} selected={v.categorySlug === c.slug} onClick={() => set("categorySlug", c.slug)} />
          ))}
        </div>
      </div>

      <Field label="RSVP link (optional)" name="rsvpUrl" value={v.rsvpUrl} onChange={(e) => set("rsvpUrl", e.target.value)} hint="Optional. Exactly one external link, shown as a public button." placeholder="https://" />

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
