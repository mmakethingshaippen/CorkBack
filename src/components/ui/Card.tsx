import { cardTilt } from "@/lib/domain";

/**
 * Card surface: white, Board border, 13px corners. Choice B: uneven tilt
 * 2-8 degrees in varied directions, no mirrored pair, no uniform rule.
 *
 * `tiltId` makes the tilt deterministic per card; `prevTilt` lets a list avoid
 * a mirrored pair between adjacent cards. Pass `tiltId={null}` for no tilt
 * (e.g. form surfaces that should sit square).
 */
export function Card({
  children,
  tiltId,
  prevTilt = null,
  className = "",
}: {
  children: React.ReactNode;
  tiltId: string | null;
  prevTilt?: number | null;
  className?: string;
}) {
  const tilt = tiltId === null ? 0 : cardTilt(tiltId, prevTilt);
  // A rotated card's corners extend past its layout box. Without clearance the
  // rotated top edge can overlap the element above it (e.g. the map), reading
  // as an empty white wedge. `my-3` gives tilted cards room so corners never
  // collide with neighbours.
  return (
    <div
      className={`rounded-card border border-board bg-card p-4 shadow-sm ${tilt ? "my-3" : ""} ${className}`}
      style={tilt ? { transform: `rotate(${tilt}deg)` } : undefined}
    >
      {children}
    </div>
  );
}

/** Helper for lists: compute the tilt a card will use, to feed the next card's prevTilt. */
export function tiltFor(id: string, prevTilt: number | null): number {
  return cardTilt(id, prevTilt);
}
