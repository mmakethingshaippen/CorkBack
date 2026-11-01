/**
 * Procedural cork surface (Choice A): cork appears ONLY on header bands and
 * empty states. The .cork-band class is defined in globals.css (generated in
 * CSS, no image asset). Never use this as the page background.
 */
export function CorkBand({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`cork-band rounded-edge p-6 ${className}`}>{children}</div>
  );
}
