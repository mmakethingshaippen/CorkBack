import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isReportReason, type PostingState, type ReportReason } from "./moderation";

/**
 * Admin reads. Every call goes through a database function that checks
 * is_admin() itself (a non-admin gets SQLSTATE 42501), as the signed-in viewer.
 * Usernames only: reporter and author emails are never selected. Messages are
 * never read.
 */

export type QueueStatus = "pending" | "resolved" | "all";
export const QUEUE_PAGE_SIZE = 50;

export interface QueueItem {
  reportId: string;
  reason: ReportReason;
  details: string | null;
  status: "pending" | "dismissed" | "actioned";
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  resolvedByUsername: string | null;
  reporterUsername: string | null;
  postingId: string;
  postingTitle: string;
  postingAuthorUsername: string | null;
  postingState: PostingState;
  postingPendingReports: number;
}

export interface PostingDetail {
  id: string;
  title: string;
  body: string;
  categorySlug: string | null;
  placeLabel: string | null;
  eventDate: string | null;
  eventTime: string | null;
  endDate: string | null;
  endTime: string | null;
  createdAt: string;
  expiresAt: string;
  authorUsername: string | null;
  state: PostingState;
  hiddenAt: string | null;
}

export interface LogItem {
  id: number;
  action: "dismiss_report" | "hide_posting" | "restore_posting";
  postingId: string | null;
  postingTitle: string | null;
  reportId: string | null;
  adminUsername: string;
  reason: string | null;
  createdAt: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; code: string | undefined };

export function parseQueueStatus(v: string | null | undefined): QueueStatus {
  return v === "resolved" || v === "all" ? v : "pending";
}
export function parseReasonFilter(v: string | null | undefined): ReportReason | null {
  return isReportReason(v) ? v : null;
}

export async function fetchQueue(
  supabase: SupabaseClient,
  opts: { status: QueueStatus; reason: ReportReason | null; offset: number },
): Promise<Result<{ items: QueueItem[]; hasMore: boolean }>> {
  const { data, error } = await supabase.rpc("admin_report_queue", {
    p_status: opts.status,
    p_reason: opts.reason,
    p_limit: QUEUE_PAGE_SIZE + 1,
    p_offset: Math.max(0, opts.offset),
  });
  if (error) return { ok: false, code: error.code };
  const rows = (data ?? []) as Record<string, unknown>[];
  const items = rows.slice(0, QUEUE_PAGE_SIZE).map((r) => ({
    reportId: String(r.report_id),
    reason: r.reason as ReportReason,
    details: (r.details as string) ?? null,
    status: r.status as QueueItem["status"],
    createdAt: String(r.created_at),
    resolvedAt: (r.resolved_at as string) ?? null,
    resolutionNote: (r.resolution_note as string) ?? null,
    resolvedByUsername: (r.resolved_by_username as string) ?? null,
    reporterUsername: (r.reporter_username as string) ?? null,
    postingId: String(r.posting_id),
    postingTitle: String(r.posting_title),
    postingAuthorUsername: (r.posting_author_username as string) ?? null,
    postingState: r.posting_state as PostingState,
    postingPendingReports: Number(r.posting_pending_reports ?? 0),
  }));
  return { ok: true, value: { items, hasMore: rows.length > QUEUE_PAGE_SIZE } };
}

export async function fetchPostingDetail(supabase: SupabaseClient, postingId: string): Promise<Result<PostingDetail | null>> {
  const { data, error } = await supabase.rpc("admin_posting_detail", { p_posting_id: postingId });
  if (error) return { ok: false, code: error.code };
  const r = ((data ?? []) as Record<string, unknown>[])[0];
  if (!r) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      id: String(r.id), title: String(r.title), body: String(r.body ?? ""), categorySlug: (r.category_slug as string) ?? null,
      placeLabel: (r.place_label as string) ?? null, eventDate: (r.event_date as string) ?? null, eventTime: (r.event_time as string) ?? null,
      endDate: (r.end_date as string) ?? null, endTime: (r.end_time as string) ?? null, createdAt: String(r.created_at),
      expiresAt: String(r.expires_at), authorUsername: (r.author_username as string) ?? null, state: r.state as PostingState,
      hiddenAt: (r.hidden_at as string) ?? null,
    },
  };
}

export async function fetchLog(supabase: SupabaseClient, postingId: string | null, limit = 30): Promise<Result<LogItem[]>> {
  const { data, error } = await supabase.rpc("admin_moderation_log", { p_posting_id: postingId, p_limit: limit });
  if (error) return { ok: false, code: error.code };
  return {
    ok: true,
    value: ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id), action: r.action as LogItem["action"], postingId: (r.posting_id as string) ?? null,
      postingTitle: (r.posting_title as string) ?? null, reportId: (r.report_id as string) ?? null,
      adminUsername: String(r.admin_username), reason: (r.reason as string) ?? null, createdAt: String(r.created_at),
    })),
  };
}

/**
 * username -> stored photo path for the admin screens, whose database functions
 * return usernames only. One `profiles` read (public columns); an empty list
 * makes no request. Failure just means fallback avatars.
 */
export async function lookupAvatarPaths(supabase: SupabaseClient, usernames: (string | null | undefined)[]): Promise<Record<string, string | null>> {
  const unique = [...new Set(usernames.filter((u): u is string => typeof u === "string" && u.length > 0))].slice(0, 200);
  if (unique.length === 0) return {};
  const { data, error } = await supabase.from("profiles").select("username, avatar_path").in("username", unique);
  if (error || !data) return {};
  const out: Record<string, string | null> = {};
  for (const r of data as { username: string; avatar_path: string | null }[]) out[r.username] = r.avatar_path ?? null;
  return out;
}