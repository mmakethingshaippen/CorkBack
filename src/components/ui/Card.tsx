import { cardTilt, tiltClearance } from "@/lib/domain";

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
  // A rotated card's corners rise above and drop below its layout box by
  // (width / 2) x sin|tilt| - up to ~87 px for a full-width desktop card at 8deg,
  // which overlapped neighbouring cards and headings. The vertical margin
  // matches that lift exactly at any width: a percentage margin resolves against
  // the card's own grid-area width. `min-w-0` lets long words wrap instead of
  // widening the column (and the page) on mobile.
  return (
    <div
      className={`min-w-0 rounded-card border border-board bg-card p-4 shadow-sm ${className}`}
      style={tilt ? { transform: `rotate(${tilt}deg)`, marginBlock: tiltClearance(tilt) } : undefined}
    >
      {children}
    </div>
  );
}

/** Helper for lists: compute the tilt a card will use, to feed the next card's prevTilt. */
export function tiltFor(id: string, prevTilt: number | null): number {
  return cardTilt(id, prevTilt);
}
