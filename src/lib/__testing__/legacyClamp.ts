// TEST-ONLY COPY of MAX_NUDGE_METERS, clampPinNudge and its private helpers from src/lib/domain.ts
// as they were before the location-confirmation feature retires the clamp (task 3.1).
// It keeps the postingInputBaseline oracle working. Do not import from app code.
import { haversineMeters } from "../domain";

export const MAX_NUDGE_METERS = 150;
const EARTH_RADIUS_M = 6_371_000;

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

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
