import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * Route tests for GET /api/geocode. The store, Supabase auth and fetch are stubbed;
 * nothing here reaches a real geocoder.
 *
 * Covers design Properties 18, 20, 22, 23, 24 (route parts).
 * **Validates: Requirements 4.7, 4.8, 4.9, 4.11, 4.14, 18.3, 18.4, 18.6, 19.2, 19.3, 19.6, 19.7, 19.8, 19.9, 20.3, 20.5, 20.6**
 */

let user: { id: string } | null = null;
let authThrows = false;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (authThrows) throw new Error("auth down");
    return { auth: { getUser: async () => ({ data: { user } }) } };
  },
  createAdminClient: () => ({ __admin: true }),
}));

const store = {
  takeSlot: vi.fn<(ms: number) => Promise<number | null>>(),
  cacheGet: vi.fn<(key: string) => Promise<unknown[] | null>>(),
  cachePut: vi.fn<(key: string, m: unknown[]) => Promise<{ ok: boolean; code?: string }>>(),
  purgeExpired: vi.fn(),
};
const createStoreSpy = vi.fn();

vi.mock("@/lib/geocoderStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/geocoderStore")>("@/lib/geocoderStore");
  return {
    ...actual,
    createGeocoderStore: (client: unknown) => {
      createStoreSpy(client);
      return store;
    },
  };
});

import { GET } from "./route";
import { cacheKey } from "@/lib/geocodeQuery";

const UA = "CorkBack/1.0 (contact: ops@example.com)";
const SECRET = "s3cret-value-for-the-cache-key-0123456789abcdef";
const REFERER = "https://corkback.example/";
const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GEOCODER_URL",
  "GEOCODER_USER_AGENT",
  "GEOCODER_REFERER",
  "GEOCODER_API_KEY",
  "GEOCODER_API_KEY_PARAM",
  "GEOCODER_CACHE_SECRET",
  "NEXT_PUBLIC_APP_URL",
] as const;
const savedEnv: Record<string, string | undefined> = {};

const SERVICE_KEY = "service-role-key-should-never-be-logged";
const QUERY = "123 Main Street Springfield";
const NOMINATIM_ROWS = [
  {
    place_id: 1,
    lat: "39.78",
    lon: "-89.65",
    display_name: "Lincoln Library Distinctive Name, 123 Main Street, Springfield",
    name: "Lincoln Library Distinctive Name",
    address: { road: "Main Street", house_number: "123", city: "Springfield", state: "Illinois" },
    category: "amenity",
    type: "library",
  },
];

let userSeq = 0;
const fetchMock = vi.fn();
let infoSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function setEnv(over: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    GEOCODER_URL: undefined,
    GEOCODER_USER_AGENT: UA,
    GEOCODER_REFERER: REFERER,
    GEOCODER_API_KEY: undefined,
    GEOCODER_API_KEY_PARAM: undefined,
    GEOCODER_CACHE_SECRET: SECRET,
    NEXT_PUBLIC_APP_URL: undefined,
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const call = (q: string | null = QUERY) =>
  GET(new Request(`http://localhost/api/geocode${q === null ? "" : `?q=${encodeURIComponent(q)}`}`));

function upstreamOk(rows: unknown = NOMINATIM_ROWS) {
  fetchMock.mockResolvedValue({ status: 200, json: async () => rows });
}

function allLogs(): string {
  return [infoSpy, logSpy, warnSpy, errorSpy].flatMap((s) => s.mock.calls.map((c: unknown[]) => c.map(String).join(" "))).join("\n");
}

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  setEnv();
  user = { id: `user-${++userSeq}` };
  authThrows = false;
  store.takeSlot.mockReset().mockResolvedValue(0);
  store.cacheGet.mockReset().mockResolvedValue(null);
  store.cachePut.mockReset().mockResolvedValue({ ok: true });
  createStoreSpy.mockReset();
  fetchMock.mockReset();
  upstreamOk();
  vi.stubGlobal("fetch", fetchMock);
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("GET /api/geocode", () => {
  it("answers 401 signed_out when there is no user, with no store or upstream call", async () => {
    user = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).state).toBe("signed_out");
    expect(createStoreSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 401 when the auth lookup throws", async () => {
    authThrows = true;
    expect((await call()).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no user agent", { GEOCODER_USER_AGENT: undefined }],
    ["bad user agent", { GEOCODER_USER_AGENT: "curl" }],
    ["short cache secret", { GEOCODER_CACHE_SECRET: "short" }],
    ["no cache secret", { GEOCODER_CACHE_SECRET: undefined }],
    ["http endpoint", { GEOCODER_URL: "http://geo.example/search" }],
    ["no service role key", { SUPABASE_SERVICE_ROLE_KEY: undefined }],
    ["no supabase url", { NEXT_PUBLIC_SUPABASE_URL: undefined }],
  ])("answers 503 unavailable with no store or upstream call when disabled (%s)", async (_n, over) => {
    setEnv(over);
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).state).toBe("unavailable");
    expect(createStoreSpy).not.toHaveBeenCalled();
    expect(store.cacheGet).not.toHaveBeenCalled();
    expect(store.takeSlot).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([["ab"], ["   "], [""]])("answers 400 for a too short query %j", async (q) => {
    const res = await call(q);
    expect(res.status).toBe(400);
    expect((await res.json()).state).toBe("bad_query");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.takeSlot).not.toHaveBeenCalled();
  });

  it("answers 400 when q is missing", async () => {
    expect((await call(null)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([["Call 555-123-4567 about 12 Oak Street"], ["12 Oak Street, host@example.com"]])(
    "answers 422 query_refused and sends nothing for a query with contact details %j",
    async (q) => {
      const res = await call(q);
      expect(res.status).toBe(422);
      expect((await res.json()).state).toBe("query_refused");
      expect(createStoreSpy).not.toHaveBeenCalled();
      expect(store.cacheGet).not.toHaveBeenCalled();
      expect(store.takeSlot).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("answers 429 user_limit after 20 searches by one user, with no further store or upstream call", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await call(`${QUERY} ${i}`)).status).toBe(200);
    }
    fetchMock.mockClear();
    store.cacheGet.mockClear();
    store.takeSlot.mockClear();
    const res = await call(`${QUERY} extra`);
    expect(res.status).toBe(429);
    expect((await res.json()).state).toBe("user_limit");
    expect(store.cacheGet).not.toHaveBeenCalled();
    expect(store.takeSlot).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a cache hit with no slot and no upstream call", async () => {
    const cached = [{ label: "Cached place", lat: 1, lng: 2 }];
    store.cacheGet.mockResolvedValue(cached);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "ok", matches: cached });
    expect(store.takeSlot).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.cachePut).not.toHaveBeenCalled();
  });

  it("looks the cache up by the HMAC key of the prepared query", async () => {
    await call("  123   MAIN street   Springfield ");
    expect(store.cacheGet).toHaveBeenCalledWith(cacheKey(QUERY, "nominatim.openstreetmap.org", SECRET));
  });

  it("answers 429 busy when no slot is available, with no upstream call", async () => {
    store.takeSlot.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(429);
    expect((await res.json()).state).toBe("busy");
    expect(store.takeSlot).toHaveBeenCalledWith(3000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 and makes no upstream call when takeSlot throws", async () => {
    store.takeSlot.mockRejectedValue(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).state).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 and makes no upstream call when cacheGet throws", async () => {
    store.cacheGet.mockRejectedValue(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(503);
    expect(store.takeSlot).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes exactly one upstream call carrying only q, the format parameters and the fixed headers", async () => {
    const res = await call("  123   Main   Street Springfield ");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url as string);
    expect(u.origin + u.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(u.searchParams.get("q")).toBe("123 Main Street Springfield");
    expect([...u.searchParams.keys()].sort()).toEqual(["addressdetails", "dedupe", "format", "limit", "q"]);
    expect(Object.keys(init.headers).sort()).toEqual(["Accept-Language", "Referer", "User-Agent"]);
    expect(init.headers["User-Agent"]).toBe(UA);
    expect(init.headers["Referer"]).toBe(REFERER);
    expect(init.credentials).toBeUndefined();
    expect(JSON.stringify(init)).not.toContain(user!.id);
  });

  it("adds the provider key parameter only for a non-public endpoint", async () => {
    setEnv({ GEOCODER_URL: "https://geo.example/search", GEOCODER_API_KEY: "provider-key", GEOCODER_API_KEY_PARAM: "apikey" });
    await call();
    const u = new URL(fetchMock.mock.calls[0][0] as string);
    expect(u.host).toBe("geo.example");
    expect(u.searchParams.get("apikey")).toBe("provider-key");
    expect(u.searchParams.get("q")).toBe(QUERY);
  });

  it("returns normalized matches and writes them to the cache under the HMAC key", async () => {
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.state).toBe("ok");
    expect(Array.isArray(body.matches)).toBe(true);
    expect(store.cachePut).toHaveBeenCalledTimes(1);
    const [key, matches] = store.cachePut.mock.calls[0];
    expect(key).toBe(cacheKey(QUERY, "nominatim.openstreetmap.org", SECRET));
    expect(matches).toEqual(body.matches);
  });

  it("writes a cache row with only key_hash, results and expires_at, and a key that does not contain the query", async () => {
    const actual = await vi.importActual<typeof import("@/lib/geocoderStore")>("@/lib/geocoderStore");
    const inserted: Record<string, unknown>[] = [];
    const fakeClient = {
      from: () => ({
        delete: () => ({ eq: async () => ({ error: null }) }),
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: null };
        },
      }),
      rpc: async () => ({ data: 0, error: null }),
    };
    const real = actual.createGeocoderStore(fakeClient as never);
    store.cachePut.mockImplementation((k, m) => real.cachePut(k, m as never));

    const before = Date.now();
    const res = await call();
    expect(res.status).toBe(200);
    expect(inserted).toHaveLength(1);
    const row = inserted[0];
    expect(Object.keys(row).sort()).toEqual(["expires_at", "key_hash", "results"]);
    const key = row.key_hash as string;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(cacheKey(QUERY, "nominatim.openstreetmap.org", SECRET));
    expect(key).not.toContain(QUERY.toLowerCase());
    expect(JSON.stringify(row)).not.toContain(user!.id);
    const expiresMs = new Date(row.expires_at as string).getTime();
    expect(expiresMs).toBeGreaterThan(before);
    expect(expiresMs - before).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it.each([
    ["non-200", () => fetchMock.mockResolvedValue({ status: 500, json: async () => [] })],
    ["network error", () => fetchMock.mockRejectedValue(new TypeError("fetch failed"))],
    ["timeout", () => fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"))],
    ["bad body", () => fetchMock.mockResolvedValue({ status: 200, json: async () => { throw new Error("bad json"); } })],
  ])("answers 502 unavailable on upstream failure (%s) and caches nothing", async (_n, arrange) => {
    arrange();
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).state).toBe("unavailable");
    expect(store.cachePut).not.toHaveBeenCalled();
  });

  it("passes an abort signal to the upstream fetch", async () => {
    await call();
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("still answers 200 when the cache write fails or throws", async () => {
    store.cachePut.mockResolvedValueOnce({ ok: false, code: "23514" });
    expect((await call("First query text")).status).toBe(200);
    store.cachePut.mockRejectedValueOnce(new Error("boom"));
    expect((await call("Second query text")).status).toBe(200);
  });

  it("sleeps for the granted wait before the upstream call", async () => {
    vi.useFakeTimers();
    try {
      store.takeSlot.mockResolvedValue(500);
      const pending = call();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      expect((await pending).status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never logs the query, results, key, user id or secrets, in success or failure paths", async () => {
    const apiKey = "provider-key-never-logged";
    setEnv({ GEOCODER_URL: "https://geo.example/search", GEOCODER_API_KEY: apiKey });
    const q = "9 Zebra Crescent Distinctivetown";
    const key = cacheKey(q, "geo.example", SECRET);

    await call(q); // success
    store.cachePut.mockResolvedValueOnce({ ok: false, code: "23514" });
    await call(`${q} b`); // cache write failure
    fetchMock.mockRejectedValueOnce(new Error(`network error for ${q}`));
    await call(`${q} c`); // upstream failure
    store.takeSlot.mockResolvedValueOnce(null);
    await call(`${q} d`); // busy
    store.cacheGet.mockRejectedValueOnce(new Error(`db error for ${q}`));
    await call(`${q} e`); // store failure
    await call("Call 555-123-4567 at Zebra Crescent"); // refused

    const logs = allLogs();
    expect(logs).toContain("[geocode]");
    for (const secret of [
      "Zebra", "Crescent", "Distinctivetown", "555-123-4567", "Distinctive Name", "39.78",
      key, SECRET, SERVICE_KEY, apiKey, UA, user!.id,
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});
