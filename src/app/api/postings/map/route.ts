import { NextResponse } from "next/server";
import { CATEGORIES } from "@/lib/categories";
import { parseBounds } from "@/lib/mapBounds";
import { queryPostingsInBounds, type MapMode } from "@/lib/mapQuery";
import { attachViewerLikes, supabaseConfigured } from "@/lib/postings";
import { createClient } from "@/lib/supabase/server";
import type { Posting } from "@/lib/types";

/**
 * GET /api/postings/map?bounds=w,s,e,n&category=slug&mode=pins|cards
 * Public, read-only. The cap is chosen by the server from the mode; any client
 * `cap` or `limit` parameter is ignored. Request values are never logged or
 * echoed back, and nothing is logged per user.
 */
const PINS_CACHE = "public, s-maxage=30, stale-while-revalidate=60";

function bad(error: string) {
  return NextResponse.json(
    { error, items: [], truncated: false },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  const bounds = parseBounds(params.get("bounds"));
  if (!bounds) return bad("Invalid bounds.");

  const rawCategory = params.get("category");
  let category: string | null = null;
  if (rawCategory !== null && rawCategory !== "") {
    if (!CATEGORIES.some((c) => c.slug === rawCategory)) return bad("Unknown category.");
    category = rawCategory;
  }

  const rawMode = params.get("mode");
  let mode: MapMode = "pins";
  if (rawMode !== null) {
    if (rawMode !== "pins" && rawMode !== "cards") return bad("Invalid mode.");
    mode = rawMode;
  }

  try {
    const result = await queryPostingsInBounds({ bounds, category, mode });
    if (mode === "pins") {
      return NextResponse.json(result, { headers: { "Cache-Control": PINS_CACHE } });
    }
    let items = result.items as Posting[];
    if (supabaseConfigured()) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      items = await attachViewerLikes(items, user?.id ?? null);
    }
    return NextResponse.json({ ...result, items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // The cause is already logged (without the request) by the data layer.
    return NextResponse.json(
      { error: "Could not load postings. Try again.", items: [], truncated: false },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
