// Geocoder configuration. Pure: takes an env object and never reads process.env itself.
// The geocoder is disabled unless every policy condition holds, so a missing User-Agent,
// secret or shared store can never turn into unthrottled traffic to a public provider.
// No value (especially the cache secret or the API key) is ever placed in a reason.

export type GeocoderConfig =
  | {
      enabled: true;
      endpoint: string;
      host: string;
      publicNominatim: boolean;
      userAgent: string;
      referer: string | null;
      apiKey: { param: string; value: string } | null;
      cacheSecret: string;
    }
  | { enabled: false; reason: "no_supabase" | "bad_endpoint" | "bad_user_agent" | "no_cache_secret" };

const DEFAULT_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const PUBLIC_NOMINATIM_HOST = "nominatim.openstreetmap.org";
const MIN_CACHE_SECRET_LENGTH = 32;
const MAX_USER_AGENT_LENGTH = 300;
const DEFAULT_KEY_PARAM = "key";

// name/version (…contact: an email or an https URL…)
const USER_AGENT_PATTERN = /^[A-Za-z][\w.-]*\/\d[\w.-]* \(.*(\S+@\S+\.\S+|https:\/\/\S+).*\)$/;
// Header values must not carry control characters.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function clean(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function isValidUserAgent(ua: string | undefined): boolean {
  if (typeof ua !== "string") return false;
  if (ua.length === 0 || ua.length > MAX_USER_AGENT_LENGTH) return false;
  if (CONTROL_CHARS.test(ua)) return false;
  return USER_AGENT_PATTERN.test(ua);
}

export function resolveGeocoderConfig(env: Record<string, string | undefined>): GeocoderConfig {
  try {
    const e = env ?? {};

    if (!clean(e.NEXT_PUBLIC_SUPABASE_URL) || !clean(e.SUPABASE_SERVICE_ROLE_KEY)) {
      return { enabled: false, reason: "no_supabase" };
    }

    let url: URL;
    try {
      url = new URL(clean(e.GEOCODER_URL) ?? DEFAULT_ENDPOINT);
    } catch {
      return { enabled: false, reason: "bad_endpoint" };
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      return { enabled: false, reason: "bad_endpoint" };
    }

    const userAgent = clean(e.GEOCODER_USER_AGENT);
    if (!isValidUserAgent(userAgent)) {
      return { enabled: false, reason: "bad_user_agent" };
    }

    // Not trimmed: the secret is used as given, but whitespace padding must not count toward length.
    const rawSecret = e.GEOCODER_CACHE_SECRET;
    if (typeof rawSecret !== "string" || rawSecret.trim().length < MIN_CACHE_SECRET_LENGTH) {
      return { enabled: false, reason: "no_cache_secret" };
    }

    const host = url.host.toLowerCase();
    const publicNominatim = url.hostname.toLowerCase() === PUBLIC_NOMINATIM_HOST;

    const keyValue = clean(e.GEOCODER_API_KEY);
    const keyParamRaw = clean(e.GEOCODER_API_KEY_PARAM);
    const keyParam = keyParamRaw && /^[A-Za-z_][\w.-]*$/.test(keyParamRaw) ? keyParamRaw : DEFAULT_KEY_PARAM;

    return {
      enabled: true,
      endpoint: url.toString(),
      host,
      publicNominatim,
      userAgent: userAgent as string,
      referer: clean(e.GEOCODER_REFERER) ?? clean(e.NEXT_PUBLIC_APP_URL) ?? null,
      apiKey: keyValue && !publicNominatim ? { param: keyParam, value: keyValue } : null,
      cacheSecret: rawSecret.trim(),
    };
  } catch {
    return { enabled: false, reason: "bad_endpoint" };
  }
}
