/**
 * Whether the browser ALREADY has geolocation permission for this site.
 * Used to decide if the board may read the device location on its own.
 * Never triggers a permission prompt: it only reads the Permissions API.
 * Anything other than an explicit "granted" (prompt, denied, no Permissions
 * API, no geolocation, an error) returns false, so the board then waits for
 * the viewer to tap "Use my location". Call only from effects or handlers.
 */
export async function geolocationAlreadyGranted(nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator): Promise<boolean> {
  if (!nav || !("geolocation" in nav)) return false;
  const perms = (nav as Navigator & { permissions?: Permissions }).permissions;
  if (!perms || typeof perms.query !== "function") return false;
  try {
    const status = await perms.query({ name: "geolocation" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}
