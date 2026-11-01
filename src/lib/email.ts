import "server-only";
import { Resend } from "resend";
import type { Posting } from "./types";

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
  posting: Pick<Posting, "id" | "title" | "eventDate" | "eventTime" | "placeLabel" | "categorySlug">;
}

/** Build the subject + text + html for a matched-posting alert. */
export function buildAlertEmail(posting: AlertEmailInput["posting"]) {
  const link = `${appUrl()}/p/${posting.id}`;
  const dateLine = posting.eventDate
    ? `Date: ${posting.eventDate}${posting.eventTime ? ` at ${posting.eventTime}` : ""}`
    : posting.eventTime
      ? `Time: ${posting.eventTime}`
      : "Date: see posting";
  const subject = `New on CorkBack: ${posting.title}`;
  const text = [
    `A new posting matches one of your alerts.`,
    ``,
    posting.title,
    dateLine,
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
      <p style="margin:0">${escapeHtml(dateLine)}</p>
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
