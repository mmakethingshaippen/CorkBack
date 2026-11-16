// Pure request model for GET /api/postings/map. No React, no DOM, no clock.
// Builds requests that carry only snapped bounds, category and mode, and keeps
// the sequence/abort/stale-response bookkeeping so a slow old response can never
// overwrite a newer view.

import { snapBoundsOutward, type Bounds } from "./mapBounds";

export type MapRequestMode = "pins" | "cards";

export interface MapRequestInput {
  bounds: Bounds;
  /** null or "" means all categories (the parameter is omitted). */
  category: string | null;
  mode: MapRequestMode;
}

export interface MapRequest {
  url: string;
  /** Normalised category, null for all. */
  category: string | null;
  /** Stable identity of what is being asked for; equal keys mean the same request. */
  key: string;
}

/** Decimal places that print the 0.1 degree snap grid exactly. */
const GRID_DIGITS = 1;

function fmt(n: number): string {
  // Bounds are already on the grid, so rounding to the grid digits is exact.
  const s = n.toFixed(GRID_DIGITS);
  return s === "-0.0" ? "0.0" : s;
}

/**
 * Builds the request. Bounds are snapped outward (idempotent, never shrinks),
 * written as "west,south,east,north" to match the route. Nothing else is sent:
 * no reference point, radius, user id or limit.
 */
export function buildMapRequest(input: MapRequestInput): MapRequest {
  const b = snapBoundsOutward(input.bounds);
  const category = input.category ? input.category : null;
  const params = [`bounds=${fmt(b.west)},${fmt(b.south)},${fmt(b.east)},${fmt(b.north)}`];
  if (category !== null) params.push(`category=${encodeURIComponent(category)}`);
  params.push(`mode=${input.mode}`);
  const query = params.join("&");
  return { url: `/api/postings/map?${query}`, category, key: query };
}

export type MapRequestStatus = "idle" | "loading" | "ready" | "error";

export interface MapRequestState<T> {
  items: T[];
  truncated: boolean;
  status: MapRequestStatus;
  error: string | null;
}

export interface MapResult<T> {
  items: T[];
  truncated: boolean;
}

export function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError"
  );
}

export interface MapRequestModel<T> {
  getState(): MapRequestState<T>;
  /** Category the viewer currently wants; responses for any other category are dropped. */
  setDesiredCategory(category: string | null): void;
  /** Starts a request: aborts the previous one, bumps the sequence, enters loading. */
  begin(request: MapRequest, abort?: () => void): number;
  /** Returns true when applied, false when stale or for a different category. */
  succeed(seq: number, category: string | null, result: MapResult<T>): boolean;
  /**
   * Returns true when the error was applied. Aborts, stale sequences and
   * category mismatches are ignored; previous data is always kept.
   */
  fail(seq: number, category: string | null, error: unknown): boolean;
  /** Aborts anything in flight and ignores its eventual response. */
  cancel(): void;
}

export function createMapRequestModel<T>(): MapRequestModel<T> {
  let seq = 0;
  let desired: string | null = null;
  let abortCurrent: (() => void) | undefined;
  let state: MapRequestState<T> = { items: [], truncated: false, status: "idle", error: null };

  const accepts = (s: number, category: string | null) =>
    s === seq && category === desired;

  return {
    getState: () => state,
    setDesiredCategory(category) {
      desired = category ? category : null;
    },
    begin(request, abort) {
      abortCurrent?.();
      abortCurrent = abort;
      seq += 1;
      desired = request.category;
      state = { ...state, status: "loading", error: null };
      return seq;
    },
    succeed(s, category, result) {
      if (!accepts(s, category)) return false;
      abortCurrent = undefined;
      state = {
        items: result.items,
        truncated: result.truncated,
        status: "ready",
        error: null,
      };
      return true;
    },
    fail(s, category, error) {
      if (isAbortError(error) || !accepts(s, category)) return false;
      abortCurrent = undefined;
      const message =
        error instanceof Error && error.message ? error.message : "Could not load postings. Try again.";
      state = { ...state, status: "error", error: message };
      return true;
    },
    cancel() {
      abortCurrent?.();
      abortCurrent = undefined;
      seq += 1; // invalidates any response still on the way
      if (state.status === "loading") state = { ...state, status: state.items.length ? "ready" : "idle" };
    },
  };
}
