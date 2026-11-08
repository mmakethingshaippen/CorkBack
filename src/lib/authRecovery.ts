/**
 * Tell a password-recovery session apart from a normal sign-in by reading the
 * `amr` (authentication methods) claim in the session access token. Supabase
 * records `{ method: "recovery" }` for sessions created from a recovery link.
 *
 * Decoding happens locally (the token is not verified here; Supabase verifies
 * it on every API call). The token is never logged or returned.
 */
export function isRecoverySession(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    const claims = JSON.parse(json) as { amr?: Array<{ method?: string } | string> };
    return (claims.amr ?? []).some((m) =>
      typeof m === "string" ? m === "recovery" : m?.method === "recovery",
    );
  } catch {
    return false;
  }
}
