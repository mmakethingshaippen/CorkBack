/**
 * Pure parse/serialize and guarded storage helpers for the saved board centre
 * and the radius choice. Call the read/write functions only from effects or
 * event handlers (never during render). Storage failures never throw: reads
 * return null and writes report false so callers keep the in-visit value.
 */
import { RADIUS_OPTIONS_MILES, type ReferenceKind } from "@/lib/nearby";

export const CENTER_KEY = "corkback.mapCenter";
export const RADIUS_KEY = "corkback.radiusMiles";

export interface SavedCenter {
  lat: number;
  lng: number;
  zoom?: number;
  town?: string | null;
  kind?: ReferenceKind;
}

const KINDS: readonly ReferenceKind[] = ["town", "device", "home", "saved", "default"];

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Parses a stored radius. Returns null when it is not exactly one of the options. */
export function parseStoredRadius(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return (RADIUS_OPTIONS_MILES as readonly number[]).includes(n) ? n : null;
}

/**
 * Parses a stored centre. Old values without `kind` read as `town` when they
 * have a town name, otherwise `saved`. Returns null for anything unusable.
 */
export function parseSavedCenter(raw: string | null): (SavedCenter & { kind: ReferenceKind }) | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.lat !== "number" || typeof o.lng !== "number" || !Number.isFinite(o.lat) || !Number.isFinite(o.lng)) {
    return null;
  }
  const town = typeof o.town === "string" && o.town.trim() ? o.town : null;
  const kind: ReferenceKind =
    typeof o.kind === "string" && (KINDS as readonly string[]).includes(o.kind)
      ? (o.kind as ReferenceKind)
      : town
        ? "town"
        : "saved";
  const out: SavedCenter & { kind: ReferenceKind } = { lat: o.lat, lng: o.lng, town, kind };
  if (typeof o.zoom === "number" && Number.isFinite(o.zoom)) out.zoom = o.zoom;
  return out;
}

export function serializeSavedCenter(center: SavedCenter): string {
  return JSON.stringify(center);
}

export function readRadius(storage: StorageLike | null = defaultStorage()): number | null {
  try {
    return storage ? parseStoredRadius(storage.getItem(RADIUS_KEY)) : null;
  } catch {
    return null;
  }
}

/** Returns false if the value was not saved; the caller keeps the in-visit value. */
export function writeRadius(miles: number, storage: StorageLike | null = defaultStorage()): boolean {
  if (parseStoredRadius(miles) === null) return false;
  try {
    storage?.setItem(RADIUS_KEY, String(miles));
    return !!storage;
  } catch {
    return false;
  }
}

export function readSavedCenter(storage: StorageLike | null = defaultStorage()) {
  try {
    return storage ? parseSavedCenter(storage.getItem(CENTER_KEY)) : null;
  } catch {
    return null;
  }
}

export function writeSavedCenter(center: SavedCenter, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    storage?.setItem(CENTER_KEY, serializeSavedCenter(center));
    return !!storage;
  } catch {
    return false;
  }
}

export function clearSavedCenter(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(CENTER_KEY);
  } catch {
    /* ignore */
  }
}
