import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Route tests for the alerts route's town lookup. The geocoder config, store,
 * shared lookup core and Supabase client are stubbed; nothing here reaches a real
 * Nominatim endpoint. The town name is resolved through the shared lookup core
 * (Requirement 21.5, 21.6, 21.7), so the alerts route uses the shared throttle and
 * cache but never a direct provider call.
 *
 * **Validates: Requirements 21.5, 21.6, 21.7**
 */

// Supabase auth and the admin client. The insert chain returns a fixed id and
// records the inserted row so we can assert the resolved center is stored.
let user: { id: string } | null = { id: "user-1" };
let insertedRow: Record<string, unknown> | null = null;

const categoryRow = { id: "cat-1" };

function makeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table === "categories") {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: categoryRow }) }),
          }),
        };
      }
      // alerts
      return {
        insert: (row: Record<string, unknown>) => {
          insertedRow = row;
          return {
            select: () => ({ single: async () => ({ data: { id: "alert-1" }, error: null }) }),
          };
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeSupabase(),
  createAdminClient: () => ({ __admin: true }),
}));

// Config stub: toggled per test between enabled and disabled.
let configEnabled = true;
vi.mock("@/lib/geocoderConfig", () => ({
  resolveGeocoderConfig: () =>
    configEnabled
      ? {
          enabled: true,
          endpoint: "https://nominatim.openstreetmap.org/search",
          host: "nominatim.openstreetmap.org",
          publicNominatim: true,
          userAgent: "CorkBack/1.0 (contact: ops@example.com)",
          referer: null,
          apiKey: null,
          cacheSecret: "s3cret-value-for-the-cache-key-0123456789abcdef",
        }
      : { enabled: false, reason: "no_supabase" },
}));

// Store stub: the lookup core receives it but the core itself is also stubbed,
// so this only needs to be a distinguishable object.
const createStoreSpy = vi.fn();
vi.mock("@/lib/geocoderStore", () => ({
  createGeocoderStore: (client: unknown) => {
    createStoreSpy(client);
    return { __store: true };
  },
}));

// Shared lookup core: the single seam. We assert the alerts route calls it with
// purpose=place semantics (privateHome: false, the resolved config and store) and
// takes the first match's center.
const lookupMock = vi.fn();
vi.mock("@/lib/geocodeLookup", () => ({
  runGeocodeLookup: (args: unknown) => lookupMock(args),
}));

import { POST } from "./route";
import { CATEGORIES } from "@/lib/categories";

const CATEGORY_SLUG = CATEGORIES[0].slug;

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  user = { id: "user-1" };
  insertedRow = null;
  configEnabled = true;
  lookupMock.mockReset();
  createStoreSpy.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  // No test may reach a real geocoder: fail loudly if anything calls fetch.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("no network in tests");
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function post(body: unknown) {
  return POST(new Request("http://test/api/alerts", { method: "POST", body: JSON.stringify(body) }));
}

describe("alerts town lookup through the shared service", () => {
  it("resolves a town to the first match's center and stores it (no direct Nominatim call)", async () => {
    lookupMock.mockResolvedValue({
      state: "ok",
      matches: [
        { id: "n1", name: "", addressLine: "", area: "Springfield", displayName: "Springfield", point: { lat: 39.78, lng: -89.65 }, level: "area" },
        { id: "n2", name: "", addressLine: "", area: "Other", displayName: "Other", point: { lat: 1, lng: 2 }, level: "area" },
      ],
    });

    const res = await post({ categorySlug: CATEGORY_SLUG, townName: "  Springfield  ", radiusMiles: 5 });

    expect(res.status).toBe(200);
    // Lookup called once through the shared core with the trimmed town and place semantics.
    expect(lookupMock).toHaveBeenCalledTimes(1);
    const args = lookupMock.mock.calls[0][0] as { query: string; privateHome: boolean; config: unknown; store: unknown };
    expect(args.query).toBe("Springfield");
    expect(args.privateHome).toBe(false);
    expect(args.config).toMatchObject({ enabled: true });
    expect(args.store).toEqual({ __store: true });
    // Store built from the service-role admin client.
    expect(createStoreSpy).toHaveBeenCalledWith({ __admin: true });
    // First/best match's center is stored.
    expect(insertedRow).toMatchObject({ center_lat: 39.78, center_lng: -89.65, town_name: "Springfield" });
    // No real provider was ever contacted.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the could-not-find error when nothing resolves (empty matches)", async () => {
    lookupMock.mockResolvedValue({ state: "ok", matches: [] });

    const res = await post({ categorySlug: CATEGORY_SLUG, townName: "Nowhereville", radiusMiles: 5 });
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(json.error).toContain("Nowhereville");
    expect(insertedRow).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the could-not-find error when the lookup is unavailable", async () => {
    lookupMock.mockResolvedValue({ state: "store_unavailable" });

    const res = await post({ categorySlug: CATEGORY_SLUG, townName: "Springfield", radiusMiles: 5 });

    expect(res.status).toBe(400);
    expect(insertedRow).toBeNull();
  });

  it("resolves to null (could-not-find) when the geocoder config is disabled, so a map point still works", async () => {
    configEnabled = false;

    // Town name only: with the geocoder off, there is no center, so the error is returned.
    const res = await post({ categorySlug: CATEGORY_SLUG, townName: "Springfield", radiusMiles: 5 });
    const json = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(json.error).toContain("Springfield");
    expect(lookupMock).not.toHaveBeenCalled();

    // An explicit map point still publishes without any lookup.
    const res2 = await post({ categorySlug: CATEGORY_SLUG, centerLat: 10, centerLng: 20, radiusMiles: 5 });
    expect(res2.status).toBe(200);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(insertedRow).toMatchObject({ center_lat: 10, center_lng: 20 });
  });

  it("uses an explicit map point without calling the lookup", async () => {
    const res = await post({ categorySlug: CATEGORY_SLUG, centerLat: 12.5, centerLng: -1.5, radiusMiles: 3 });

    expect(res.status).toBe(200);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(insertedRow).toMatchObject({ center_lat: 12.5, center_lng: -1.5 });
  });
});
