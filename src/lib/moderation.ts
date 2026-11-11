/**
 * Stage 8 — reporting and moderation helpers. Pure and DB-free so the rules and
 * the database-error mapping are unit-testable. The database functions
 * (supabase/stage8_moderation.sql) are the enforcement; these give readable,
 * consistent responses and shared wording.
 */

export const REPORT_REASONS = ["spam_scam", "inappropriate", "misleading", "personal_info", "duplicate", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  spam_scam: "Spam or scam",
  inappropriate: "Inappropriate content",
  misleading: "Misleading information",
  personal_info: "Personal information",
  duplicate: "Duplicate",
  other: "Other",
};

export const REPORT_DETAILS_MAX = 1000;
export const MODERATION_REASON_MAX = 500;

export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === "string" && (REPORT_REASONS as readonly string[]).includes(v);
}

export type ReportInput = { reason: ReportReason; details: string | null };

/** Validate a report request body. Details are optional for every reason. */
export function validateReportInput(b: unknown): { ok: true; value: ReportInput } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "Invalid request." };
  const r = b as Record<string, unknown>;
  if (!isReportReason(r.reason)) return { ok: false, error: "Choose a reason for the report." };
  let details: string | null = null;
  if (r.details != null && r.details !== "") {
    if (typeof r.details !== "string") return { ok: false, error: "Details must be text." };
    const t = r.details.trim();
    if (t.length > REPORT_DETAILS_MAX) return { ok: false, error: `Details must be ${REPORT_DETAILS_MAX} characters or fewer.` };
    details = t || null;
  }
  return { ok: true, value: { reason: r.reason, details } };
}

export type ApiFailure = { status: number; code: string; error: string };

/** Map a submit_posting_report database error (SQLSTATE) to an HTTP response. */
export function reportErrorResponse(code: string | undefined): ApiFailure {
  switch (code) {
    case "42501":
      return { status: 401, code: "signed_out", error: "Sign in to report a posting." };
    case "CB404":
      return { status: 404, code: "not_found", error: "This posting isn't available." };
    case "CB400":
      return { status: 400, code: "invalid", error: "You can't report your own posting." };
    case "CB413":
      return { status: 413, code: "too_long", error: `Details must be ${REPORT_DETAILS_MAX} characters or fewer.` };
    case "CB429":
      return { status: 429, code: "rate_limited", error: "You've sent several reports recently. Please wait a few minutes and try again." };
    default:
      return { status: 500, code: "failed", error: "Your report wasn't sent. Your details are kept, so you can try again." };
  }
}

export const ADMIN_ACTIONS = ["dismiss", "hide", "restore"] as const;
export type AdminActionKind = (typeof ADMIN_ACTIONS)[number];

export type AdminAction =
  | { kind: "dismiss"; reportId: string; note: string | null }
  | { kind: "hide"; postingId: string; reason: string; reportId: string | null }
  | { kind: "restore"; postingId: string; reason: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

/** Whitespace-only reasons are blank (same class as the database's cb_has_text). */
export function validateAdminAction(b: unknown): { ok: true; value: AdminAction } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "Invalid request." };
  const r = b as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (r.kind === "dismiss") {
    if (!isUuid(r.reportId)) return { ok: false, error: "Invalid report." };
    const note = text(r.note);
    if (note && note.length > MODERATION_REASON_MAX) return { ok: false, error: `The note must be ${MODERATION_REASON_MAX} characters or fewer.` };
    return { ok: true, value: { kind: "dismiss", reportId: r.reportId, note } };
  }
  if (r.kind === "hide" || r.kind === "restore") {
    if (!isUuid(r.postingId)) return { ok: false, error: "Invalid posting." };
    const reason = text(r.reason);
    if (!reason) return { ok: false, error: r.kind === "hide" ? "A reason is required to hide a posting." : "A reason is required to restore a posting." };
    if (reason.length > MODERATION_REASON_MAX) return { ok: false, error: `The reason must be ${MODERATION_REASON_MAX} characters or fewer.` };
    if (r.kind === "restore") return { ok: true, value: { kind: "restore", postingId: r.postingId, reason } };
    if (r.reportId != null && !isUuid(r.reportId)) return { ok: false, error: "Invalid report." };
    return { ok: true, value: { kind: "hide", postingId: r.postingId, reason, reportId: (r.reportId as string | null | undefined) ?? null } };
  }
  return { ok: false, error: "Unknown action." };
}

/** Map an admin_* database error to an HTTP response. Non-admins get 404 (the dashboard does not exist for them). */
export function adminErrorResponse(code: string | undefined): ApiFailure {
  switch (code) {
    case "42501":
      return { status: 404, code: "not_found", error: "Not found." };
    case "CB422":
      return { status: 400, code: "invalid", error: "A reason is required (1 to 500 characters)." };
    case "CB404":
      return { status: 404, code: "not_found", error: "That posting or report was not found." };
    case "CB400":
      return { status: 400, code: "wrong_report", error: "That report belongs to a different posting." };
    case "CB409":
      return { status: 409, code: "deleted_by_author", error: "The author deleted this posting, so it can't be hidden." };
    default:
      return { status: 500, code: "failed", error: "That action didn't complete. Nothing was changed. Try again." };
  }
}

/** Human wording for the database's idempotent outcomes. */
export function adminOutcomeMessage(result: string): string {
  switch (result) {
    case "hidden": return "Hidden. Pending reports on it were marked actioned.";
    case "already_hidden": return "It was already hidden. Nothing changed.";
    case "restored": return "Restored.";
    case "not_hidden": return "It wasn't hidden. Nothing changed.";
    case "dismissed": return "Report dismissed.";
    case "not_pending": return "That report was already resolved. Nothing changed.";
    default: return "Done.";
  }
}

export type PostingState = "active" | "ended" | "hidden" | "deleted_by_author";
export const POSTING_STATE_LABEL: Record<PostingState, string> = {
  active: "Active",
  ended: "Ended",
  hidden: "Hidden by moderators",
  deleted_by_author: "Deleted by author",
};
