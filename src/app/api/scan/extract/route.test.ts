import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Vitest does not inherit Next's tsconfig path aliases.
vi.mock("@/lib/categories", async () => import("../../../../lib/categories"));

// Sign-in is checked via Supabase; control the session per test.
let currentUser: { id: string } | null = { id: "user-1" };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) } }),
}));

import { POST } from "./route";

const flyer = {
  title: "CorkBack Test Meetup",
  eventDate: "2026-12-12",
  eventTime: "18:30",
  placeLabel: "Maple Community Hall",
  categorySlug: "community",
  rsvpUrl: null,
  body: "Meet your neighbors.",
};
const fetchMock = vi.fn<typeof fetch>();

function request(file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "flyer.jpg", { type: "image/jpeg" })) {
  const form = new FormData();
  form.set("image", file);
  return { formData: async () => form } as Request;
}

function generated(text = JSON.stringify(flyer)) {
  return Response.json({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] });
}

function failed(status: number, message = "Service unavailable") {
  return Response.json({ error: { code: status, message } }, { status });
}

async function scan(req = request()) {
  const pending = POST(req);
  await vi.runAllTimersAsync();
  const response = await pending;
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GEMINI_API_KEY", "test-secret-not-real");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  currentUser = { id: "user-1" };
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("flyer scan", () => {
  it("sends JPEG bytes to the Gemini endpoint and returns title, date, time, and place", async () => {
    fetchMock.mockResolvedValueOnce(generated());
    const result = await scan();
    expect(result).toEqual({ status: 200, body: { extracted: flyer } });
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    const payload = JSON.parse(options!.body as string);
    expect(payload.contents[0].parts[1].inlineData).toEqual({ mimeType: "image/jpeg", data: "/9j/2Q==" });
    expect(payload.generationConfig.responseMimeType).toBe("application/json");
    expect(new Headers(options!.headers).get("x-goog-api-key")).toBe("test-secret-not-real");
  });

  it("allows a successful response that takes longer than the old 20-second timeout", async () => {
    fetchMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(generated()), 25_000)));
    expect((await scan()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("backs off once on overload and succeeds without switching models", async () => {
    fetchMock.mockResolvedValueOnce(failed(503)).mockResolvedValueOnce(generated());
    const started = Date.now();
    expect((await scan()).status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
  });

  it("preserves overload as a readable 503 after exactly two attempts", async () => {
    fetchMock.mockImplementation(async () => failed(503, "This model is experiencing high demand."));
    const result = await scan();
    expect(result.status).toBe(503);
    expect(result.body.error).toMatch(/high demand.*503/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a local timeout separately from an HTTP response", async () => {
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const started = Date.now();
    const result = await scan();
    expect(result.status).toBe(504);
    expect(result.body.error).toContain("45 seconds");
    expect(Date.now() - started).toBeLessThan(92_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith("[CorkBack] Gemini request failed:", expect.objectContaining({ httpStatus: null, timedOut: true }));
  });

  it.each([400, 401, 403, 404])("does not retry or mask HTTP %s with another model's error", async (status) => {
    fetchMock.mockResolvedValueOnce(failed(status, "Request rejected"));
    const result = await scan();
    expect(result.status).toBe(502);
    expect(result.body.error).toMatch(status === 404 ? /model.*not found/i : new RegExp(String(status)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redacts the key from provider diagnostics and the browser error", async () => {
    fetchMock.mockResolvedValueOnce(failed(400, "Invalid key: test-secret-not-real"));
    const result = await scan();
    expect(result.body.error).toContain("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain("test-secret-not-real");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("test-secret-not-real");
  });

  it("returns a quota error after one bounded retry", async () => {
    fetchMock.mockImplementation(async () => failed(429, "Quota exceeded"));
    const result = await scan();
    expect(result.status).toBe(429);
    expect(result.body.error).toMatch(/quota.*429/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["not JSON", "null", "[]", '{"title":42}', '{"title":"Title","eventTime":123}'])("returns a readable parsing error for %s", async (text) => {
    fetchMock.mockResolvedValueOnce(generated(text));
    const result = await scan();
    expect(result.status).toBe(502);
    expect(result.body.error).toContain("structured data");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a blocked response", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: "SAFETY" }] }));
    const result = await scan();
    expect(result.status).toBe(502);
    expect(result.body.error).toContain("blocked or incomplete");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each<[File, number]>([
    [new File([], "empty.jpg", { type: "image/jpeg" }), 400],
    [new File(["text"], "flyer.txt", { type: "text/plain" }), 415],
    [new File([new Uint8Array(7 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" }), 413],
  ])("rejects invalid uploads before calling Gemini", async (file, status) => {
    expect((await scan(request(file))).status).toBe(status);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes image/jpg to image/jpeg", async () => {
    fetchMock.mockResolvedValueOnce(generated());
    expect((await scan(request(new File(["jpeg"], "flyer.jpg", { type: "image/jpg" })))).status).toBe(200);
    const payload = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(payload.contents[0].parts[1].inlineData.mimeType).toBe("image/jpeg");
  });

  it("requires sign-in and does not call Gemini for visitors", async () => {
    currentUser = null;
    const result = await scan();
    expect(result.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an optional RSVP link and a fallback category when given an unknown one", async () => {
    fetchMock.mockResolvedValueOnce(
      generated(JSON.stringify({ ...flyer, categorySlug: "nonsense", rsvpUrl: "https://example.com/rsvp" })),
    );
    const { body } = await scan();
    expect(body.extracted.rsvpUrl).toBe("https://example.com/rsvp");
    expect(body.extracted.categorySlug).toBe("community");
  });

  it("keeps the missing-key error readable without making an API call", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await scan()).status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to parsing a plain key: value line response", async () => {
    // Shape the model returned in AI Studio free-form mode (not JSON).
    const lines = [
      "title: COMMUNITY PICKLEBALL SOCIAL",
      "date: 2026-11-16",
      "time: 9:00 AM to 12:00 PM",
      "place: RIVERSIDE PARK COURTS, 120 PARK AVE",
      "category: Community",
    ].join("\n");
    fetchMock.mockResolvedValueOnce(generated(lines));
    const result = await scan();
    expect(result.status).toBe(200);
    expect(result.body.extracted.title).toBe("COMMUNITY PICKLEBALL SOCIAL");
    expect(result.body.extracted.eventDate).toBe("2026-11-16");
    expect(result.body.extracted.eventTime).toBe("9:00 AM to 12:00 PM");
    expect(result.body.extracted.placeLabel).toBe("RIVERSIDE PARK COURTS, 120 PARK AVE");
    expect(result.body.extracted.categorySlug).toBe("community");
  });
});
