/**
 * Canonical public origin for links that leave the app (auth emails).
 *
 * Supabase only honours redirect URLs on its allow-list; anything else falls
 * back to the Site URL (the homepage). So auth emails must never use whatever
 * address the browser happens to be on (a Vercel deployment URL, for example).
 */
export const CANONICAL_APP_URL = "https://corkback.vercel.app";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Normalise a configured app URL to a bare origin, forcing https for any
 * non-local host. Production had NEXT_PUBLIC_APP_URL = "http://corkback.vercel.app";
 * the http redirect is not on Supabase's allow-list, so recovery links fell
 * back to the Site URL (the homepage). Returns null if the value is unusable.
 */
export function normalizeAppUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!LOCAL_HOSTS.has(u.hostname)) u.protocol = "https:";
    return u.origin;
  } catch {
    return null;
  }
}

export function getAppUrl(): string {
  const configured = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (configured) return configured;
  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (LOCAL_HOSTS.has(hostname)) return origin;
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
