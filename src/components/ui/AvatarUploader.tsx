"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NavyLink } from "./actions";
import { ALLOWED_TYPES } from "@/lib/avatars/constants";
import { AVATAR_ERRORS, avatarErrorMessage } from "@/lib/avatars/errors";
import { precheckFile } from "@/lib/avatars/validate";

type Status =
  | { kind: "idle" }
  | { kind: "uploading"; percent: number | null }
  | { kind: "processing" }
  | { kind: "removing" }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string; signedOut?: boolean };

const control =
  "inline-flex min-h-[50px] items-center rounded-control border-2 border-deep-navy bg-white px-5 font-bold text-deep-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy focus-visible:ring-offset-2 disabled:opacity-60";

/**
 * Owner-only photo control. Rendered by the profile page ONLY for the signed-in
 * owner; the API independently enforces that the session user is the target.
 * Checks type and size before sending (the server checks again, from the
 * bytes), shows real upload progress, and keeps the current photo on any
 * failure. Secondary styling (navy): the page's one dark-red action is elsewhere.
 */
export function AvatarUploader({ hasPhoto }: { hasPhoto: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const busy = status.kind === "uploading" || status.kind === "processing" || status.kind === "removing";

  function pick() {
    if (lock.current) return;
    setConfirmRemove(false);
    input.current?.click();
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = ""; // choosing the same file again still fires change
    if (!file || lock.current) return;
    const pre = precheckFile(file);
    if (pre) return setStatus({ kind: "error", text: AVATAR_ERRORS[pre].message });
    upload(file);
  }

  function upload(file: File) {
    lock.current = true;
    setStatus({ kind: "uploading", percent: 0 });
    const form = new FormData();
    form.set("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/profile/avatar");
    xhr.responseType = "json";
    xhr.upload.onprogress = (ev) => {
      setStatus({ kind: "uploading", percent: ev.lengthComputable ? Math.round((ev.loaded / ev.total) * 100) : null });
    };
    xhr.upload.onload = () => setStatus({ kind: "processing" });
    xhr.onload = () => {
      lock.current = false;
      const body = (xhr.response ?? {}) as { ok?: boolean; code?: string; message?: string };
      if (xhr.status >= 200 && xhr.status < 300 && body.ok) {
        setStatus({ kind: "done", text: "Your photo is saved." });
        router.refresh();
        return;
      }
      setStatus({ kind: "error", text: body.message ?? avatarErrorMessage(body.code), signedOut: body.code === "signed_out" || xhr.status === 401 });
    };
    xhr.onerror = () => {
      lock.current = false;
      setStatus({ kind: "error", text: "Couldn't reach CorkBack. Check your connection and try again. Your current photo was not changed." });
    };
    xhr.send(form);
  }

  async function remove() {
    if (lock.current) return;
    lock.current = true;
    setStatus({ kind: "removing" });
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; message?: string };
      if (res.ok && body.ok) {
        setConfirmRemove(false);
        setStatus({ kind: "done", text: "Your photo was removed." });
        router.refresh();
      } else {
        setStatus({ kind: "error", text: body.message ?? avatarErrorMessage(body.code), signedOut: res.status === 401 });
      }
    } catch {
      setStatus({ kind: "error", text: "Couldn't reach CorkBack. Check your connection and try again." });
    } finally {
      lock.current = false;
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        onChange={onFile}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={pick} disabled={busy} aria-describedby="avatar-hint" className={control}>
          {status.kind === "uploading" || status.kind === "processing" ? "Uploading…" : hasPhoto ? "Change profile photo" : "Add profile photo"}
        </button>
        {hasPhoto && !confirmRemove ? (
          <button type="button" onClick={() => { setConfirmRemove(true); setStatus({ kind: "idle" }); }} disabled={busy} className={control}>
            Remove photo
          </button>
        ) : null}
      </div>
      <p id="avatar-hint" className="text-xs text-ink/60">JPEG, PNG or WebP, up to 2 MB. Location data in the photo is removed.</p>

      {confirmRemove ? (
        <div role="group" aria-label="Remove your photo" className="flex flex-wrap items-center gap-3 rounded-card border border-board bg-white p-3">
          <span className="text-sm text-ink">Remove your photo? Your initial is shown instead.</span>
          <button type="button" onClick={remove} disabled={busy} className={control}>
            {status.kind === "removing" ? "Removing…" : "Remove photo"}
          </button>
          <button type="button" onClick={() => setConfirmRemove(false)} disabled={busy} className="inline-flex min-h-[50px] items-center rounded-control border border-board bg-white px-5 font-bold text-ink disabled:opacity-60">
            Keep photo
          </button>
        </div>
      ) : null}

      {status.kind === "uploading" ? (
        <div className="flex items-center gap-3">
          <progress
            max={100}
            value={status.percent ?? undefined}
            aria-label="Photo upload progress"
            className="h-2 w-48 overflow-hidden rounded-full [&::-moz-progress-bar]:bg-deep-navy [&::-webkit-progress-bar]:bg-board [&::-webkit-progress-value]:bg-deep-navy"
          />
          <span className="text-sm text-ink/70">{status.percent === null ? "Uploading…" : `${status.percent}%`}</span>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-ink/70">
        {status.kind === "processing" ? "Preparing your photo…" : status.kind === "done" ? status.text : ""}
      </p>
      {status.kind === "error" ? (
        <p role="alert" className="text-sm font-bold text-dark-red">
          {status.text} {status.signedOut ? <NavyLink href="/sign-in">Sign in</NavyLink> : null}
        </p>
      ) : null}
    </div>
  );
}