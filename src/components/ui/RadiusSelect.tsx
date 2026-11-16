import { RADIUS_OPTIONS_MILES } from "@/lib/nearby";

/**
 * Radius picker: a labelled radio group of the five radius options. Navy
 * secondary control; the active option is dark red like a selected chip.
 * Each option is at least 44 px tall and the row wraps so 390 px never scrolls.
 */
export function RadiusSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (miles: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Search radius in miles" className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-bold text-ink" aria-hidden="true">
        Radius
      </span>
      {RADIUS_OPTIONS_MILES.map((miles) => {
        const active = miles === value;
        return (
          <button
            key={miles}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${miles} ${miles === 1 ? "mile" : "miles"}`}
            onClick={() => onChange(miles)}
            className={`min-h-[44px] min-w-[44px] rounded-control border-2 px-3 text-sm font-bold transition-colors ${
              active
                ? "border-dark-red bg-dark-red text-white"
                : "border-deep-navy bg-white text-deep-navy hover:bg-deep-navy/5"
            }`}
          >
            {miles} mi
          </button>
        );
      })}
    </div>
  );
}
