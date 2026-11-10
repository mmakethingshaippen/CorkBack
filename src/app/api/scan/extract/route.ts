import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { CATEGORIES } from "@/lib/categories";
import { createClient } from "@/lib/supabase/server";
import type { ExtractedFlyer } from "@/lib/types";

/**
 * Server-side flyer extraction. The image is sent to Gemini and structured
 * fields come back. GEMINI_API_KEY lives ONLY here (server). Nothing is
 * published — the client takes these fields into the review step.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

// Use the configured model. A moving alias can resolve to the same model;
// trying a list of models can hide the original error and multiply latency.
const PRIMARY_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gemini inline-data payloads must be reasonably small (base64 inflates ~33%).
// Reject oversized uploads up front with a readable message rather than letting
// the API reject them opaquely.
const MAX_IMAGE_BYTES = 7 * 1024 * 1024; // 7 MB raw
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

const slugs = CATEGORIES.map((c) => c.slug).join(", ");

const PROMPT = `You extract structured data from a photo of a paper event/community flyer.
Return ONLY a single minified JSON object and nothing else: no prose, no
markdown, no code fences, and no "key: value" lines. Use exactly these keys:
  title (string),
  eventDate (YYYY-MM-DD or null),
  eventTime (string like "19:30" or null),
  placeLabel (venue/board text from the flyer, or ""),
  categorySlug (one of: ${slugs}),
  rsvpUrl (a single URL if present, else null),
  body (a short 1-3 sentence description),
  eventDateYearPrinted (true ONLY if the year is printed on the flyer; false if
    you had to assume the year; omit when eventDate is null).
Do not invent a location pin — placeLabel is only the text on the flyer.`;

/** Extract a numeric HTTP status from the SDK error, if present. */
function statusOf(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  // The SDK often embeds "[GoogleGenerativeAI Error]: ... [400 ...]" in message.
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/\[(\d{3})\s/);
  return m ? Number(m[1]) : null;
}

/**
 * Fallback parser for a plain "key: value" line response (what the model emits
 * in free-form mode, e.g. AI Studio chat). The app forces responseMimeType
 * JSON, so this is only a safety net when a JSON parse fails. Maps the flyer's
 * human labels (title/date/time/place/category) onto the ExtractedFlyer shape.
 * Returns null if it cannot even find a title.
 */
function parsePlainLines(text: string): Partial<ExtractedFlyer> | null {
  const map: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z ]+?)\s*:\s*(.+?)\s*$/);
    if (m) map[m[1].trim().toLowerCase()] = m[2].trim();
  }
  const title = map["title"];
  if (!title) return null;

  const categoryRaw = (map["category"] ?? map["categoryslug"] ?? "").toLowerCase();
  const categorySlug =
    CATEGORIES.find((c) => c.slug === categoryRaw)?.slug ??
    CATEGORIES.find((c) => categoryRaw.includes(c.slug.replace("-", " ")) || categoryRaw.includes(c.label.toLowerCase()))?.slug ??
    "";

  return {
    title,
    eventDate: map["date"] ?? map["eventdate"] ?? null,
    eventTime: map["time"] ?? map["eventtime"] ?? null,
    placeLabel: map["place"] ?? map["placelabel"] ?? map["location"] ?? "",
    categorySlug,
    rsvpUrl: map["rsvp"] ?? map["rsvpurl"] ?? null,
    body: map["body"] ?? map["description"] ?? "",
  };
}

function safeMessage(err: unknown): string {
  let message = err instanceof Error ? err.message : String(err);
  const key = process.env.GEMINI_API_KEY;
  if (key) message = message.split(key).join("[REDACTED]");
  // Keep the provider's explanation without the SDK's URL/prefix.
  return message.replace(/^.*?\[\d{3}[^\]]*\]\s*/, "").slice(0, 1000);
}

export async function POST(req: Request) {
  // Scanning is a posting action: sign-in required (checked before anything
  // else so anonymous callers cannot spend the Gemini quota).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { error: "Sign-in is not configured in this environment. Add Supabase credentials to enable scanning." },
      { status: 501 },
    );
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to scan a flyer." }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "Extraction is not configured in this environment. Add GEMINI_API_KEY to enable scanning." },
      { status: 501 },
    );
  }

  let file: FormDataEntryValue | null = null;
  try {
    const form = await req.formData();
    file = form.get("image");
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form with an 'image' file." },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No image provided." }, { status: 400 });
  }

  const mimeType = file.type === "image/jpg" ? "image/jpeg" : file.type || "image/jpeg";
  const bytes = Buffer.from(await file.arrayBuffer());

  // Size + format guards with readable messages.
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `That image is too large (${(bytes.byteLength / 1_048_576).toFixed(1)} MB). Please use an image under 7 MB.` },
      { status: 413 },
    );
  }
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "That image is empty. Please choose the flyer again." }, { status: 400 });
  }
  if (!ALLOWED_MIME.includes(mimeType)) {
    return NextResponse.json(
      { error: `Unsupported image type "${mimeType}". Use JPG, PNG, WebP, or HEIC.` },
      { status: 415 },
    );
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: PRIMARY_MODEL,
    generationConfig: { responseMimeType: "application/json" },
  });

  // One bounded retry for transient service failures. Do not retry bad keys,
  // permissions, invalid input, or unavailable model names.
  let rawText = "";
  let lastStatus: number | null = null;
  let lastMessage = "";
  let timedOut = false;
  let succeeded = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const result = await model.generateContent(
        [PROMPT, { inlineData: { data: bytes.toString("base64"), mimeType } }],
        { signal: ctrl.signal },
      );
      // A blocked/incomplete response is not a transient transport failure.
      try {
        rawText = result.response.text();
      } catch (err) {
        console.error("[CorkBack] Gemini response failed:", {
          model: PRIMARY_MODEL,
          message: safeMessage(err),
        });
        return NextResponse.json(
          { error: "Gemini did not return usable flyer data (the response was blocked or incomplete). Please try again." },
          { status: 502 },
        );
      }
      succeeded = true;
      break;
    } catch (err) {
      timedOut = ctrl.signal.aborted;
      // A local abort has no HTTP response. Do not log it as Google's 504.
      lastStatus = timedOut ? null : statusOf(err);
      lastMessage = timedOut
        ? "The server stopped waiting for Gemini after 45 seconds."
        : safeMessage(err);
      // Structured diagnostics to the server terminal. The API key is NEVER logged.
      console.error("[CorkBack] Gemini request failed:", {
        model: PRIMARY_MODEL,
        attempt,
        endpoint: "generativelanguage.googleapis.com/v1beta (generateContent)",
        httpStatus: lastStatus,
        timedOut,
        mimeType,
        imageBytes: bytes.byteLength,
        message: lastMessage,
      });
      const transient = timedOut || lastStatus === 429 || (lastStatus !== null && lastStatus >= 500);
      if (!transient || attempt === MAX_ATTEMPTS) break;
    } finally {
      clearTimeout(timer);
    }
    await sleep(1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250));
  }

  if (!succeeded) {
    // Readable, cause-specific errors (not the generic "clearer photo").
    if (lastStatus === 404) {
      return NextResponse.json(
        { error: `The configured Gemini model (${PRIMARY_MODEL}) was not found for this API version. It may be deprecated or unavailable for your key.` },
        { status: 502 },
      );
    }
    if (lastStatus === 400) {
      return NextResponse.json(
        { error: `Gemini rejected the scan request (HTTP 400): ${lastMessage}` },
        { status: 502 },
      );
    }
    if (lastStatus === 401 || lastStatus === 403) {
      return NextResponse.json(
        { error: `Gemini rejected the request (HTTP ${lastStatus}). The GEMINI_API_KEY may be invalid, not enabled for the Gemini API, or lacking permission.` },
        { status: 502 },
      );
    }
    if (lastStatus === 429) {
      return NextResponse.json(
        { error: "Gemini rate limit or quota reached (HTTP 429). Try again later or check the Gemini API quota." },
        { status: 429 },
      );
    }
    if (timedOut) {
      return NextResponse.json(
        { error: "The scan timed out: Gemini did not respond within the 45 seconds allowed for the final attempt. Please try again shortly." },
        { status: 504 },
      );
    }
    if (lastStatus === 503) {
      return NextResponse.json(
        { error: "Gemini is temporarily unavailable due to high demand (HTTP 503). The scan failed after two attempts. Please try again shortly." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: `Flyer extraction failed${lastStatus ? ` (HTTP ${lastStatus})` : ""}: ${lastMessage}` },
      { status: 502 },
    );
  }

  // Parse the JSON response. With responseMimeType set this is clean JSON, but
  // strip any stray code fences defensively. If JSON parsing fails, fall back to
  // a plain "key: value" line parser before giving up.
  let parsed: ExtractedFlyer;
  try {
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    let candidate: Partial<ExtractedFlyer> | null;
    try {
      candidate = JSON.parse(cleaned) as ExtractedFlyer;
    } catch {
      candidate = parsePlainLines(cleaned);
    }
    parsed = candidate as ExtractedFlyer;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        typeof parsed.title !== "string" || !parsed.title.trim() ||
        ["eventDate", "eventTime", "placeLabel", "categorySlug", "rsvpUrl", "body"].some((key) => {
          const value = (parsed as unknown as Record<string, unknown>)[key];
          return value != null && typeof value !== "string";
        })) {
      throw new Error("Invalid flyer fields");
    }
  } catch {
    console.error("[CorkBack] Gemini returned unparseable output:", {
      model: PRIMARY_MODEL,
      message: "The response was not a JSON object with valid flyer fields.",
    });
    return NextResponse.json(
      { error: "Gemini returned a response that could not be read as structured data. Please try again." },
      { status: 502 },
    );
  }

  // Guard the category to a known slug.
  const known = CATEGORIES.some((c) => c.slug === parsed.categorySlug);
  const extracted: ExtractedFlyer = {
    title: parsed.title ?? "",
    eventDate: parsed.eventDate ?? null,
    eventTime: parsed.eventTime ?? null,
    placeLabel: parsed.placeLabel ?? "",
    categorySlug: known ? parsed.categorySlug : "community",
    rsvpUrl: parsed.rsvpUrl ?? null,
    body: parsed.body ?? "",
    // Only an explicit `true` counts as "year printed". Anything else leaves the
    // flag off, and the review form asks the poster to confirm the full date.
    ...(parsed.eventDate && parsed.eventDateYearPrinted === true ? { eventDateYearPrinted: true } : {}),
    ...(parsed.eventDate && parsed.eventDateYearPrinted === false ? { eventDateYearPrinted: false } : {}),
  };
  return NextResponse.json({ extracted });
}
