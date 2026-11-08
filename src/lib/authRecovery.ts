/**
 * Password-recovery session detection.
 *
 * On this Supabase project, a session created from a recovery link records its
 * auth method as "otp" (verified 2026-11-03), the same as an email
 * confirmation, so the token alone cannot say "this is a password reset". The
 * auth routes therefore mark a recovery explicitly with a short-lived cookie,
 * and fall back to recent `recovery_sent_at` only when the link type is
 * unknown. Nothing here logs or returns a token.
 */

/** Short-lived marker set by /auth/confirm, /auth/callback, or the reset page. */
export const RECOVERY_COOKIE = "cb_recovery";
export const RECOVERY_COOKIE_MAX_AGE = 15 * 60; // seconds

/** A recovery email counts as "recent" for this long when the link type is unknown. */
const RECENT_RECOVERY_MS = 60 * 60 * 1000;

/** True if the token's amr claim says "recovery" (some GoTrue versions do). */
export function hasRecoveryAmr(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json =
      typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("utf8");
    const claims = JSON.parse(json) as { amr?: Array<{ method?: string } | string> };
    return (claims.amr ?? []).some((m) =>
      typeof m === "string" ? m === "recovery" : m?.method === "recovery",
    );
  } catch {
    return false;
  }
}

/** True if the user requested a recovery email within the last hour. */
export function isRecentRecovery(
  user: { recovery_sent_at?: string | null } | null | undefined,
  now: number = Date.now(),
): boolean {
  const sent = user?.recovery_sent_at ? Date.parse(user.recovery_sent_at) : NaN;
  return Number.isFinite(sent) && now - sent >= 0 && now - sent <= RECENT_RECOVERY_MS;
}
