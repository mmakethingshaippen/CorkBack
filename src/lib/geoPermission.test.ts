import { describe, it, expect, vi } from "vitest";
import { geolocationAlreadyGranted } from "./geoPermission";

const nav = (state: string | null, opts: { geo?: boolean; throws?: boolean } = {}) => {
  const query = vi.fn(async () => {
    if (opts.throws) throw new Error("unsupported");
    return { state } as PermissionStatus;
  });
  const n: Record<string, unknown> = {};
  if (opts.geo !== false) n.geolocation = { getCurrentPosition: vi.fn() };
  if (state !== null) n.permissions = { query };
  return { n: n as unknown as Navigator, query, getCurrentPosition: (n.geolocation as { getCurrentPosition?: unknown } | undefined)?.getCurrentPosition };
};

describe("geolocationAlreadyGranted", () => {
  it("is true only for an explicit 'granted'", async () => {
    expect(await geolocationAlreadyGranted(nav("granted").n)).toBe(true);
    expect(await geolocationAlreadyGranted(nav("prompt").n)).toBe(false);
    expect(await geolocationAlreadyGranted(nav("denied").n)).toBe(false);
  });
  it("is false without the Permissions API, without geolocation, on errors or with no navigator", async () => {
    expect(await geolocationAlreadyGranted(nav(null).n)).toBe(false);
    expect(await geolocationAlreadyGranted(nav("granted", { geo: false }).n)).toBe(false);
    expect(await geolocationAlreadyGranted(nav("granted", { throws: true }).n)).toBe(false);
    expect(await geolocationAlreadyGranted(undefined)).toBe(false);
  });
  it("never asks for a position (no prompt)", async () => {
    for (const s of ["granted", "prompt", "denied"]) {
      const x = nav(s);
      await geolocationAlreadyGranted(x.n);
      expect(x.getCurrentPosition).not.toHaveBeenCalled();
    }
  });
});
