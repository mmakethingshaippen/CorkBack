/**
 * Device location for the posting form's explicit "Use my location" button.
 *
 * One getCurrentPosition call, nothing stored. Independent of the home board's
 * browsing-location code (geoPermission, HomeMap). This is the only file in the
 * posting flow that references navigator.geolocation.
 */

export interface DevicePoint {
  lat: number;
  lng: number;
}

export type DeviceResult =
  | { ok: true; point: DevicePoint }
  | { ok: false; reason: "unsupported" | "denied" | "unavailable" | "timeout" };

export const DEVICE_TIMEOUT_MS = 10_000;

/** One getCurrentPosition call (timeout 10 s, maximumAge 0). Called only from the picker's "Use my location" handler. */
export function requestDeviceLocation(
  nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator,
): Promise<DeviceResult> {
  return new Promise<DeviceResult>((resolve) => {
    const geo = nav?.geolocation;
    if (!geo || typeof geo.getCurrentPosition !== "function") {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    try {
      geo.getCurrentPosition(
        (pos) => {
          const lat = pos?.coords?.latitude;
          const lng = pos?.coords?.longitude;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            resolve({ ok: false, reason: "unavailable" });
            return;
          }
          resolve({ ok: true, point: { lat, lng } });
        },
        (err) => {
          // GeolocationPositionError codes: 1 denied, 2 unavailable, 3 timeout.
          const reason = err?.code === 1 ? "denied" : err?.code === 3 ? "timeout" : "unavailable";
          resolve({ ok: false, reason });
        },
        { enableHighAccuracy: false, timeout: DEVICE_TIMEOUT_MS, maximumAge: 0 },
      );
    } catch {
      resolve({ ok: false, reason: "unavailable" });
    }
  });
}
