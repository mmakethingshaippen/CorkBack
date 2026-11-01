/**
 * Category chip, built as TEXT in code (no category icon set). White chip with a
 * navy border; selected chip is dark red (design-tokens.md).
 */
export function CategoryChip({
  label,
  selected = false,
  onClick,
  as = "button",
}: {
  label: string;
  selected?: boolean;
  onClick?: () => void;
  as?: "button" | "span";
}) {
  const base =
    "rounded-control border-2 px-3 py-1 text-sm font-bold transition-colors";
  const skin = selected
    ? "border-dark-red bg-dark-red text-white"
    : "border-deep-navy bg-white text-deep-navy hover:bg-deep-navy/5";

  if (as === "span") {
    return <span className={`${base} ${skin}`}>{label}</span>;
  }
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={`${base} ${skin}`}>
      {label}
    </button>
  );
}
