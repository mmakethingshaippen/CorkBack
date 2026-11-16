import "server-only";
import { Resend } from "resend";
import type { Posting } from "./types";
import { fieldSpec } from "./postingKinds";

/**
 * Resend email — server only. RESEND_API_KEY is read here and NEVER logged or
 * returned to the client. The alert email contains only the posting's public
 * fields (title, date, time, place, link). It never contains the alert's home
 * point, radius, or any other user's email.
 */

const FROM = process.env.ALERTS_FROM_EMAIL || "CorkBack <alerts@corkback.app>";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export interface AlertEmailInput {
  to: string;
  posting: Pick<Posting, "id" | "title" | "eventDate" | "eventTime" | "placeLabel" | "categorySlug"> &
    Partial<Pick<Posting, "endDate">>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Dec 1" from a YYYY-MM-DD (or ISO timestamp's date part), with no timezone shift. null if invalid. */
function shortMonthDay(value: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((value ?? "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(Number(m[1]), month - 1, day));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${MONTHS[month - 1]} ${day}`;
}

/** The date line for the email, or null when there is nothing safe to show. */
function alertDateLine(posting: AlertEmailInput["posting"]): string | null {
  const spec = fieldSpec(posting.categorySlug);
  const time = posting.eventTime ? String(posting.eventTime) : "";

  if (posting.eventDate) {
    // Includes legacy listing postings that still carry an event date.
    if (!shortMonthDay(posting.eventDate)) return null;
    return `Date: ${posting.eventDate}${time ? ` at ${time}` : ""}`;
  }
  if (spec.kind === "listing") {
    const day = shortMonthDay(posting.endDate);
    return spec.cardPrefix && day ? `${spec.cardPrefix} ${day}` : null;
  }
  if (spec.kind === "event-optional") return null;
  return time ? `Time: ${time}` : "Date: see posting";
}

/** Build the subject + text + html for a matched-posting alert. */
export function buildAlertEmail(posting: AlertEmailInput["posting"]) {
  const link = `${appUrl()}/p/${posting.id}`;
  const dateLine = alertDateLine(posting);
  const subject = `New on CorkBack: ${posting.title}`;
  const text = [
    `A new posting matches one of your alerts.`,
    ``,
    posting.title,
    ...(dateLine ? [dateLine] : []),
    `Place: ${posting.placeLabel || "see posting"}`,
    ``,
    `View it: ${link}`,
    ``,
    `You received this because it matched a CorkBack alert you created. Your alert's location and radius are private and are never shared.`,
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,sans-serif;color:#1E1E1C">
      <p>A new posting matches one of your alerts.</p>
      <h2 style="margin:0 0 4px">${escapeHtml(posting.title)}</h2>
      ${dateLine ? `<p style="margin:0">${escapeHtml(dateLine)}</p>` : ""}
      <p style="margin:0 0 12px">Place: ${escapeHtml(posting.placeLabel || "see posting")}</p>
      <p><a href="${link}" style="color:#1F2E4D;font-weight:bold">View the posting</a></p>
      <p style="font-size:12px;color:#8a857c">You received this because it matched a CorkBack alert you created. Your alert's location and radius are private and are never shared.</p>
    </div>`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string),
  );
}

/** Send one alert email. Returns { ok } or { ok:false, error } — never leaks the key. */
export async function sendAlertEmail(input: AlertEmailInput): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not configured." };

  const resend = new Resend(key);
  const { subject, text, html } = buildAlertEmail(input.posting);
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: input.to,
      subject,
      text,
      html,
    });
    if (error) {
      // Resend error messages do not contain the key, but we still never log the key.
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed." };
  }
}
