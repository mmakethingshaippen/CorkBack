/**
 * CorkBack wordmark, recreated as TEXT (no vector file). Kalam Bold, on a deep-navy
 * label, white wordmark text, with "Back" in dark red. (design-tokens.md)
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-[8px] bg-deep-navy px-2.5 py-1 font-bold ${className}`}
      aria-label="CorkBack"
    >
      <span className="inline-flex gap-0.5" aria-hidden>
        <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-white text-deep-navy">C</span>
        <span className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-dark-red text-white">B</span>
      </span>
      <span className="text-white">
        Cork<span className="text-dark-red">Back</span>
      </span>
    </span>
  );
}
