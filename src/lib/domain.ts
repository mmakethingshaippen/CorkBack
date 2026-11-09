/**
 * CorkBack core domain logic — pure, dependency-free, property-testable.
 * These functions encode the LOCKED product rules from the steering docs.
 */

// ---------------------------------------------------------------------------
// Username rule (LOCKED): 3-20 chars, letters / numbers / underscore only.
// ---------------------------------------------------------------------------
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

/** Specific rejection reason for UX, or null when valid. */
export function usernameRejection(username: string): string | null {
  if (username.length < 3) return "Username must be at least 3 characters.";
  if (username.length > 20) return "Username must be at most 20 characters.";
  if (/\s/.test(username)) return "Username cannot contain spaces.";
  if (!/^[A-Za-z0-9_]+$/.test(username))
    return "Username may use only letters, numbers, and underscores.";
  return null;
}

// ---------------------------------------------------------------------------
// Expiry presets (LOCKED): 24h, 3d, 1w, 2w, 1m.
// ---------------------------------------------------------------------------
export type ExpiryPreset = "24h" | "3d" | "1w" | "2w" | "1m";

export const EXPIRY_PRESETS: ExpiryPreset[] = ["24h", "3d", "1w", "2w", "1m"];

const PRESET_MS: Record<ExpiryPreset, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "2w": 14 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000, // "1 month" preset = 30 days
};

/** expires_at = created_at + preset. */
export function computeExpiresAt(createdAt: Date, preset: ExpiryPreset): Date {
  return new Date(createdAt.getTime() + PRESET_MS[preset]);
}

// When a posting ends (expiry vs. event end, in the posting's time zone) lives
// in ./lifecycle.ts: `postingTakedown` / `isPostingActive`.

// ---------------------------------------------------------------------------
// Pin nudge (LOCKED): a posting pins near the poster's real location. A short
// nudge to the exact board/venue is allowed, but the pin must STAY NEAR the
// real location. We cap the nudge at a small radius so the pin can never drift.
// ---------------------------------------------------------------------------
export const MAX_NUDGE_METERS = 150;
const EARTH_RADIUS_M = 6_371_000;

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in meters between two lat/lng points (haversine). */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing (radians) from point a to point b. */
function bearingRad(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return Math.atan2(y, x);
}

/** Destination point given a start, a distance in meters, and a bearing (rad). */
function destinationPoint(
  start: { lat: number; lng: number },
  meters: number,
  bearing: number,
): { lat: number; lng: number } {
  const ang = meters / EARTH_RADIUS_M;
  const lat1 = toRad(start.lat);
  const lng1 = toRad(start.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) +
      Math.cos(lat1) * Math.sin(ang) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
  // Normalize longitude to [-180, 180].
  const lngDeg = ((toDeg(lng2) + 540) % 360) - 180;
  return { lat: toDeg(lat2), lng: lngDeg };
}

/**
 * Clamp a desired pin to within MAX_NUDGE_METERS of the poster's real location.
 * If the requested nudge is within bounds it is kept; otherwise it is pulled
 * back onto the boundary circle along the true geodesic bearing. Using a proper
 * geographic offset (not naive lat/lng interpolation) keeps this correct near
 * the poles and the antimeridian. Guarantees the pin stays near the real spot.
 */
export function clampPinNudge(
  real: { lat: number; lng: number },
  desired: { lat: number; lng: number },
): { lat: number; lng: number } {
  const dist = haversineMeters(real, desired);
  if (dist <= MAX_NUDGE_METERS) return desired;
  const bearing = bearingRad(real, desired);
  return destinationPoint(real, MAX_NUDGE_METERS, bearing);
}

// ---------------------------------------------------------------------------
// Card tilt (Choice B, LOCKED): uneven 2deg..8deg, varied directions, no
// mirrored pair between adjacent cards, no uniform rule. Derived from the
// card id so it is stable across renders but visually irregular.
// ---------------------------------------------------------------------------
export const TILT_MIN = 2;
export const TILT_MAX = 8;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic tilt in degrees for a card, given its id and the previous
 * card's tilt (to avoid a mirrored pair). Returns a signed value in
 * [-8,-2] U [2,8]. `prevTilt` may be null for the first card.
 */
export function cardTilt(id: string, prevTilt: number | null): number {
  const h = hashString(id);
  const span = TILT_MAX - TILT_MIN; // 6 degrees
  const steps = span * 10 + 1; // 61 discrete 0.1-degree steps: 2.0 .. 8.0 inclusive
  const magnitude = TILT_MIN + (h % steps) / 10; // 2.0 .. 8.0
  let sign = (h & 0x100) === 0 ? 1 : -1;
  let tilt = +(magnitude * sign).toFixed(1);
  // No mirrored pair: a mirror is same magnitude, opposite sign.
  if (prevTilt !== null && Math.abs(Math.abs(tilt) - Math.abs(prevTilt)) < 0.05 && Math.sign(tilt) !== Math.sign(prevTilt)) {
    sign = -sign;
    tilt = +(magnitude * sign).toFixed(1);
    // If flipping now equals the previous exactly, nudge magnitude to break uniformity.
    if (Math.abs(tilt - prevTilt) < 0.05) {
      const bumped = Math.min(TILT_MAX, magnitude + 0.5) === magnitude ? magnitude - 0.5 : Math.min(TILT_MAX, magnitude + 0.5);
      tilt = +(Math.max(TILT_MIN, bumped) * sign).toFixed(1);
    }
  }
  return tilt;
}
