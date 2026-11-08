/**
 * Canonical public origin for links that leave the app (auth emails).
 *
 * Supabase only honours redirect URLs on its allow-list; anything else falls
 * back to the Site URL (the homepage). So auth emails must never use whatever
 * address the browser happens to be on (a Vercel deployment URL, for example).
 */
export const CANONICAL_APP_URL = "https://corkback.vercel.app";

export function getAppUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") return origin;
  }
  return CANONICAL_APP_URL;
}

/** Allow only same-site relative paths as post-auth destinations. */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export const RESET_PASSWORD_PATH = "/auth/reset-password";
