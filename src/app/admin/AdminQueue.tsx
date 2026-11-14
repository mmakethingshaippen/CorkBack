"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NavyLink } from "@/components/ui/actions";
import { POSTING_STATE_LABEL, REPORT_REASON_LABEL, MODERATION_REASON_MAX } from "@/lib/moderation";
import type { LogItem, PostingDetail, QueueItem } from "@/lib/adminData";
import { Avatar } from "@/components/ui/Avatar";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " UTC";

type Avatars = Record<string, string | null>;

/** An avatar and @handle, or the deleted-account text. Usernames only. */
function Who({ name, avatars }: { name: string | null | undefined; avatars: Avatars }) {
  if (!name) return <>a deleted account</>;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <Avatar username={name} path={avatars[name] ?? null} size={20} />@{name}
    </span>
  );
}
type Panel = { reportId: string; kind: "dismiss" | "hide" | "restore" } | null;

/**
 * The moderation queue. Only ONE action panel is open at a time, so the screen
 * has exactly one dark-red main action (the hide confirm). Dismiss and restore
 * use navy. Hide and restore need a reason; dismiss takes an optional note.
 * Every action is idempotent on the server; the result message says what
 * happened (already hidden, already resolved, ...). Escape closes the panel and
 * returns focus to the button that opened it.
 */
export function AdminQueue({ items, avatars = {} }: { items: QueueItem[]; avatars?: Avatars }) {
  const [extraAvatars, setExtraAvatars] = useState<Avatars>({});
  const known: Avatars = { ...avatars, ...extraAvatars };
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [detail, setDetail] = useState<{ id: string; data: { posting: PostingDetail; history: LogItem[] } | "loading" | "error" } | null>(null);
  const lock = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (panel) field.current?.focus();
  }, [panel]);

  function open(reportId: string, kind: "dismiss" | "hide" | "restore", e: React.MouseEvent<HTMLElement>) {
    opener.current = e.currentTarget;
    setPanel({ reportId, kind });
    setText("");
    setMessage(null);
  }
  function close() {
    setPanel(null);
    setText("");
    opener.current?.focus();
  }

  async function run(item: QueueItem) {
    if (!panel || lock.current) return;
    const reason = text.trim();
    if (panel.kind !== "dismiss" && !reason) {
      setMessage({ ok: false, text: panel.kind === "hide" ? "A reason is required to hide a posting." : "A reason is required to restore a posting." });
      field.current?.focus();
      return;
    }
    const body: Record<string, unknown> =
      panel.kind === "dismiss"
        ? { kind: "dismiss", reportId: item.reportId, note: reason || null }
        : panel.kind === "hide"
          ? { kind: "hide", postingId: item.postingId, reason, reportId: item.reportId }
          : { kind: "restore", postingId: item.postingId, reason };
    lock.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? "That action didn't complete. Nothing was changed." });
        return;
      }
      setMessage({ ok: true, text: data.message ?? "Done." });
      setPanel(null);
      setText("");
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Couldn't reach CorkBack. Nothing was changed; try again." });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function toggleDetail(postingId: string) {
    if (detail?.id === postingId) return setDetail(null);
    setDetail({ id: postingId, data: "loading" });
    try {
      const res = await fetch(`/api/admin/postings/${postingId}`);
      if (!res.ok) return setDetail({ id: postingId, data: "error" });
      const json = (await res.json()) as { posting: PostingDetail; history: LogItem[]; avatars?: Avatars };
      if (json.avatars) setExtraAvatars((cur) => ({ ...cur, ...json.avatars }));
      setDetail({ id: postingId, data: { posting: json.posting, history: json.history } });
    } catch {
      setDetail({ id: postingId, data: "error" });
    }
  }

  const btn = "inline-flex min-h-[44px] items-center rounded-control px-4 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy";

  return (
    <div>
      <p role="status" aria-live="polite" className={`min-h-[1.5rem] text-sm font-bold ${message?.ok === false ? "text-dark-red" : "text-ink"}`}>
        {message?.text}
      </p>
      {items.length === 0 ? (
        <p className="rounded-card border border-board bg-white p-4 text-ink/70">No reports here.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const isOpen = panel?.reportId === it.reportId;
            const canHide = it.postingState === "active" || it.postingState === "ended";
            const canRestore = it.postingState === "hidden";
            return (
              <li key={it.reportId} className="rounded-card border border-board bg-white p-4" data-report-id={it.reportId}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-bold text-ink">
                    {REPORT_REASON_LABEL[it.reason]}{" "}
                    <span className="text-sm font-normal text-ink/60">· {when(it.createdAt)}</span>
                  </p>
                  <span className="rounded-control border-2 border-deep-navy px-2 py-0.5 text-xs font-bold text-deep-navy">
                    {it.status === "pending" ? "Pending" : it.status === "dismissed" ? "Dismissed" : "Actioned"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink">
                  Reported by <Who name={it.reporterUsername} avatars={known} />
                </p>
                {it.details ? <p className="mt-1 whitespace-pre-wrap break-words rounded-[12px] bg-board/30 p-2 text-sm text-ink">{it.details}</p> : null}

                <p className="mt-2 break-words text-ink">
                  <span className="font-bold">{it.postingTitle}</span>{" "}
                  <span className="text-sm text-ink/70">
                    by <Who name={it.postingAuthorUsername} avatars={known} /> · {POSTING_STATE_LABEL[it.postingState]}
                  </span>
                </p>
                {it.postingPendingReports > 1 ? <p className="text-xs text-ink/60">{it.postingPendingReports} pending reports on this posting</p> : null}
                {it.status !== "pending" && it.resolvedAt ? (
                  <p className="mt-1 text-xs text-ink/60">
                    Resolved {when(it.resolvedAt)}{it.resolvedByUsername ? <> by <Who name={it.resolvedByUsername} avatars={known} /></> : ""}
                    {it.resolutionNote ? `: ${it.resolutionNote}` : ""}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => toggleDetail(it.postingId)} aria-expanded={detail?.id === it.postingId} className={`${btn} border-2 border-deep-navy bg-white text-deep-navy`}>
                    {detail?.id === it.postingId ? "Hide details" : "Posting details"}
                  </button>
                  {it.status === "pending" ? (
                    <button type="button" onClick={(e) => open(it.reportId, "dismiss", e)} className={`${btn} border border-board bg-white text-ink`}>
                      Dismiss
                    </button>
                  ) : null}
                  {canHide ? (
                    <button type="button" onClick={(e) => open(it.reportId, "hide", e)} className={`${btn} border-2 border-deep-navy bg-white text-deep-navy`}>
                      Hide posting…
                    </button>
                  ) : null}
                  {canRestore ? (
                    <button type="button" onClick={(e) => open(it.reportId, "restore", e)} className={`${btn} border-2 border-deep-navy bg-white text-deep-navy`}>
                      Restore posting…
                    </button>
                  ) : null}
                </div>

                {isOpen && panel ? (
                  <div role="group" aria-labelledby={`panel-${it.reportId}`} onKeyDown={(e) => { if (e.key === "Escape" && !busy) close(); }} className="mt-3 rounded-card border border-board bg-board/20 p-3">
                    <label id={`panel-${it.reportId}`} htmlFor={`reason-${it.reportId}`} className="block text-sm font-bold text-ink">
                      {panel.kind === "dismiss" ? "Note (optional)" : panel.kind === "hide" ? "Reason for hiding (required, shown to the author)" : "Reason for restoring (required)"}
                    </label>
                    <textarea
                      id={`reason-${it.reportId}`}
                      ref={field}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={2}
                      maxLength={MODERATION_REASON_MAX}
                      className="mt-1 w-full rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-deep-navy/30"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      {panel.kind === "hide" ? (
                        <button type="button" onClick={() => run(it)} disabled={busy} className={`${btn} bg-dark-red text-white disabled:opacity-60`}>
                          {busy ? "Hiding…" : "Hide this posting"}
                        </button>
                      ) : (
                        <button type="button" onClick={() => run(it)} disabled={busy} className={`${btn} bg-deep-navy text-white disabled:opacity-60`}>
                          {busy ? "Saving…" : panel.kind === "dismiss" ? "Dismiss report" : "Restore posting"}
                        </button>
                      )}
                      <button type="button" onClick={close} disabled={busy} className={`${btn} border border-board bg-white text-ink`}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {detail?.id === it.postingId ? (
                  <div className="mt-3 rounded-card border border-board bg-board/10 p-3 text-sm text-ink" aria-live="polite">
                    {detail.data === "loading" ? "Loading…" : detail.data === "error" ? "Couldn't load the posting details." : (
                      <>
                        <p className="font-bold">{detail.data.posting.title}</p>
                        <p className="text-ink/70">
                          {POSTING_STATE_LABEL[detail.data.posting.state]} · by <Who name={detail.data.posting.authorUsername} avatars={known} />
                          {detail.data.posting.placeLabel ? ` · ${detail.data.posting.placeLabel}` : ""}
                          {detail.data.posting.eventDate ? ` · ${detail.data.posting.eventDate}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-ink/60">Posted {when(detail.data.posting.createdAt)} · up until {when(detail.data.posting.expiresAt)}</p>
                        <p className="mt-2 whitespace-pre-wrap break-words">{detail.data.posting.body || "(no details)"}</p>
                        {detail.data.history.length ? (
                          <ul className="mt-2 list-disc pl-5 text-xs text-ink/70">
                            {detail.data.history.map((h) => (
                              <li key={h.id}>{when(h.createdAt)}: {h.action.replace("_", " ")} by <Who name={h.adminUsername} avatars={known} />{h.reason ? ` (${h.reason})` : ""}</li>
                            ))}
                          </ul>
                        ) : <p className="mt-2 text-xs text-ink/60">No moderation history for this posting.</p>}
                        {detail.data.posting.state === "active" || detail.data.posting.state === "ended" ? (
                          <p className="mt-2"><NavyLink href={`/p/${detail.data.posting.id}`}>View posting</NavyLink></p>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
