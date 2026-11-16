// Pure marker reconciliation for MapView: decide which markers to add, remove
// or leave alone, by posting id. No map or DOM imports.

export interface MarkerItem {
  id: string;
  lat: number;
  lng: number;
}

export interface MarkerDiff<T extends MarkerItem> {
  /** Items with no marker yet. */
  add: T[];
  /** Ids that have a marker but are no longer wanted. */
  remove: string[];
  /** Ids that keep their existing marker untouched. */
  keep: string[];
}

/**
 * Compare the ids that currently have markers with the wanted items.
 * Duplicate wanted ids are collapsed (first one wins).
 */
export function diffMarkers<T extends MarkerItem>(currentIds: Iterable<string>, next: readonly T[]): MarkerDiff<T> {
  const have = new Set(currentIds);
  const wanted = new Map<string, T>();
  for (const item of next) if (!wanted.has(item.id)) wanted.set(item.id, item);

  const add: T[] = [];
  const keep: string[] = [];
  for (const [id, item] of wanted) {
    if (have.has(id)) keep.push(id);
    else add.push(item);
  }
  const remove: string[] = [];
  for (const id of have) if (!wanted.has(id)) remove.push(id);
  return { add, remove, keep };
}
