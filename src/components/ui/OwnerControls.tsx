"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Edit and Delete for the posting's AUTHOR only (the parent renders this only
 * for the author; the database enforces it either way).
 * - Edit: navy link to /p/[id]/edit (hidden when the posting has ended or is
 *   moderated: only active, visible postings are editable).
 * - Delete: neutral button, then an inline confirm. Escape cancels; focus moves
 *   into the confirm and returns to the Delete button. One dark-red main action
 *   per screen, so the confirm uses a dark-red OUTLINE.
 * - Works on active, ended and moderated postings (soft delete).
 */
export function OwnerControls({
  postingId,
  title,
  canEdit,
  variant,
  after,
}: {
  postingId: string;
  title: string;
  canEdit: boolean;
  variant: "page" | "card";
  /** page: go to the profile with a status message. card: refresh the list in place. */
  after: { kind: "profile"; username: string } | { kind: "refresh" };
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const deleteBtn = useRef<HTMLButtonElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) cancelBtn.current?.focus();
  }, [confirming]);

  function close() {
    setConfirming(false);
    setError(null);
    deleteBtn.current?.focus();
  }

  async function remove() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/postings/${postingId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Couldn't delete the posting. Try again.");
        return;
      }
      if (after.kind === "profile") router.push(`/u/${after.username}?deleted=1`);
      else {
        setConfirming(false);
        router.refresh();
      }
    } catch {
      setError("Couldn't reach CorkBack. Nothing was deleted; try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const btn = "inline-flex min-h-[44px] items-center rounded-control px-4 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy";

  return (
    <div className={variant === "card" ? "mt-2" : ""}>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <Link href={`/p/${postingId}/edit`} aria-label={`Edit ${title}`} className={`${btn} border-2 border-deep-navy text-deep-navy`}>
            Edit
          </Link>
        ) : null}
        <button
          ref={deleteBtn}
          type="button"
          aria-label={`Delete ${title}`}
          aria-expanded={confirming}
          onClick={() => setConfirming(true)}
          className={`${btn} border border-board bg-white text-ink`}
        >
          Delete{variant === "page" ? " posting" : ""}
        </button>
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-modal="false"
          aria-labelledby={`del-${postingId}`}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          className="mt-2 rounded-card border-2 border-dark-red bg-white p-3"
        >
          <p id={`del-${postingId}`} className="text-sm font-bold text-ink">Delete this posting?</p>
          <p className="mt-1 text-xs text-ink/70">It comes off the map and your profile now. This can&apos;t be undone.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button ref={cancelBtn} type="button" onClick={close} disabled={busy} className={`${btn} border border-board bg-white text-ink`}>
              Keep it
            </button>
            <button type="button" onClick={remove} aria-disabled={busy} disabled={busy} className={`${btn} border-2 border-dark-red bg-white text-dark-red disabled:opacity-60`}>
              {busy ? "Deleting…" : "Yes, delete it"}
            </button>
          </div>
          <p role="status" aria-live="polite" className="mt-1 min-h-[1.25rem] text-sm font-bold text-dark-red">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
