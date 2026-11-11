"use client";

import { useEffect, useRef, useState } from "react";
import { NavyLink } from "./actions";
import { REPORT_DETAILS_MAX, REPORT_REASONS, REPORT_REASON_LABEL, type ReportReason } from "@/lib/moderation";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "created" }
  | { kind: "already" }
  | { kind: "error"; text: string; signedOut?: boolean; limited?: boolean; retry?: boolean };

/**
 * "Report posting" for signed-in users who are not the author (the parent does
 * not render it for the author). Signed-out visitors get a sign-in prompt.
 * States: closed, open, submitting, created, already reported, error (details
 * kept). A ref lock ignores repeat submits; the database makes concurrent ones
 * idempotent. The reporter's identity is never shown to the poster.
 * Outline button: the posting page's one dark-red action stays elsewhere.
 */
export function ReportPosting({
  postingId,
  signedIn,
  initiallyReported,
}: {
  postingId: string;
  signedIn: boolean;
  initiallyReported: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [reported, setReported] = useState(initiallyReported);
  const lock = useRef(false);
  const returnFocus = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstRadio = useRef<HTMLInputElement>(null);
  const message = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (open) firstRadio.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [open]);

  if (!signedIn) {
    return (
      <p className="text-sm text-ink/70">
        <NavyLink href="/sign-in">Sign in</NavyLink> to report this posting.
      </p>
    );
  }

  function close() {
    setOpen(false);
    setStatus((s) => (s.kind === "submitting" ? s : { kind: "idle" }));
    returnFocus.current = true; // the trigger isn't mounted while the form is open; focus it once it is back
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (!reason) {
      setStatus({ kind: "error", text: "Choose a reason for the report." });
      firstRadio.current?.focus();
      return;
    }
    lock.current = true;
    setStatus({ kind: "submitting" });
    try {
      const res = await fetch(`/api/postings/${postingId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, details: details.trim() || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { result?: string; error?: string; code?: string };
      if (!res.ok) {
        setStatus({ kind: "error", retry: true, text: data.error ?? "Your report wasn't sent. Your details are kept, so you can try again.", signedOut: data.code === "signed_out", limited: data.code === "rate_limited" });
        return;
      }
      setReported(true);
      setDetails("");
      setReason(null);
      setStatus(data.result === "already_reported" ? { kind: "already" } : { kind: "created" });
    } catch {
      setStatus({ kind: "error", retry: true, text: "Couldn't reach CorkBack. Your details are kept; check your connection and try again." });
    } finally {
      lock.current = false;
      // Move focus to the result so keyboard and screen-reader users hear it.
      setTimeout(() => message.current?.focus(), 0);
    }
  }

  const done = status.kind === "created" || status.kind === "already";
  const btn = "inline-flex min-h-[44px] items-center rounded-control px-4 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy";

  return (
    <section aria-labelledby={`report-h-${postingId}`} className="text-sm">
      {!open && !done ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            ref={trigger}
            type="button"
            onClick={() => { setOpen(true); setStatus({ kind: "idle" }); }}
            aria-expanded={false}
            className={`${btn} border-2 border-deep-navy bg-white text-deep-navy`}
          >
            Report posting
          </button>
          {reported ? <span className="text-ink/70">You reported this. Moderators will review it.</span> : null}
        </div>
      ) : null}

      {open && !done ? (
        <form
          onSubmit={submit}
          onKeyDown={(e) => { if (e.key === "Escape" && status.kind !== "submitting") close(); }}
          aria-busy={status.kind === "submitting"}
          className="space-y-3 rounded-card border border-board bg-white p-4"
        >
          <fieldset className="space-y-1">
            <legend id={`report-h-${postingId}`} className="text-base font-bold text-ink">Report this posting</legend>
            <p className="text-xs text-ink/60">Reports go to CorkBack moderators. The poster won&apos;t see who reported it.</p>
            {REPORT_REASONS.map((r, i) => (
              <label key={r} className="flex min-h-[44px] items-center gap-2 text-ink">
                <input
                  ref={i === 0 ? firstRadio : undefined}
                  type="radio"
                  name={`reason-${postingId}`}
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="h-5 w-5 accent-deep-navy"
                />
                {REPORT_REASON_LABEL[r]}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor={`report-details-${postingId}`} className="mb-1 block font-bold text-ink">Details (optional)</label>
            <textarea
              id={`report-details-${postingId}`}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              maxLength={REPORT_DETAILS_MAX}
              className="w-full rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-deep-navy/30"
            />
            <p className="mt-1 text-xs text-ink/60" aria-live="polite">{details.length} / {REPORT_DETAILS_MAX}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={status.kind === "submitting"} aria-disabled={status.kind === "submitting"} className={`${btn} bg-deep-navy text-white disabled:opacity-60`}>
              {status.kind === "submitting" ? "Sending…" : status.kind === "error" && status.retry ? "Try again" : "Send report"}
            </button>
            <button type="button" onClick={close} disabled={status.kind === "submitting"} className={`${btn} border border-board bg-white text-ink`}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <p
        ref={message}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className={`mt-2 min-h-[1.25rem] outline-none ${status.kind === "error" ? "font-bold text-dark-red" : "text-ink"}`}
      >
        {status.kind === "created" ? "Thanks, your report was sent to CorkBack moderators. The poster won't see who reported it." : null}
        {status.kind === "already" ? "You've already reported this posting. Moderators will review it." : null}
        {status.kind === "error" ? (
          <>
            {status.text} {status.signedOut ? <NavyLink href="/sign-in">Sign in</NavyLink> : null}
          </>
        ) : null}
      </p>
    </section>
  );
}
