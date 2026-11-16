"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { CategoryFollowButton } from "@/components/ui/CategoryFollowButton";

/**
 * Compact category filter: one navy-bordered trigger ("Category: All" or
 * "Category: Sports") that opens a popover over the map (no layout height
 * change). The panel lists "All categories" then each category once, in
 * CATEGORIES order. Closes on Escape, outside click or selection and returns
 * focus to the trigger. Panel contents render only while open.
 *
 * Each row has a select button (selected = dark red, aria-pressed) and the
 * existing CategoryFollowButton (renders nothing when signed out). The selected
 * category's follow control also shows next to the trigger when signed in.
 */
export interface CategoryFilterProps {
  /** Category slug, or null for all. */
  value: string | null;
  onChange: (slug: string | null) => void;
  /** Slugs the viewer follows. */
  followed: string[];
  signedIn: boolean;
}

// The follow button is small by design elsewhere; lift its tap target here.
const TAP_FOLLOW = "[&_button]:min-h-[44px] [&_button]:min-w-[44px]";

export function CategoryFilter({ value, onChange, followed, signedIn }: CategoryFilterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const selected = value ? CATEGORIES.find((c) => c.slug === value) ?? null : null;
  const triggerText = `Category: ${selected ? selected.label : "All"}`;

  // Keep the panel inside the viewport: measure at left:0 and shift left if needed.
  const panelRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const margin = 16;
    let dx = 0;
    if (r.right > vw - margin) dx = vw - margin - r.right;
    if (r.left + dx < margin) dx = margin - r.left;
    setShift(dx);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        // The browser's default mousedown focus change runs after pointerdown,
        // so refocus on the next task.
        setTimeout(() => triggerRef.current?.focus(), 0);
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function choose(slug: string | null) {
    onChange(slug);
    close();
  }

  const rowBase =
    "min-h-[44px] flex-1 rounded-control border-2 px-3 py-2 text-left text-sm font-bold transition-colors";
  const skin = (on: boolean) =>
    on
      ? "border-dark-red bg-dark-red text-white"
      : "border-deep-navy bg-white text-deep-navy hover:bg-deep-navy/5";

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      <div ref={rootRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-control border-2 border-deep-navy bg-white px-3 py-2 text-sm font-bold text-deep-navy"
        >
          <span>{triggerText}</span>
          <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
        {open && (
          <div
            id={panelId}
            ref={panelRef}
            style={{ left: shift }}
            role="group"
            aria-label="Filter by category"
            className="absolute left-0 top-full z-20 mt-1 max-h-[60vh] w-[min(calc(100vw-32px),22rem)] overflow-auto rounded-card border border-board bg-white p-2 shadow-lg"
          >
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              <li className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={value === null}
                  onClick={() => choose(null)}
                  className={`${rowBase} ${skin(value === null)}`}
                >
                  All categories
                </button>
              </li>
              {CATEGORIES.map((c) => (
                <li key={c.slug} className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={value === c.slug}
                    onClick={() => choose(c.slug)}
                    className={`${rowBase} ${skin(value === c.slug)}`}
                  >
                    {c.label}
                  </button>
                  {signedIn && (
                    <span className={TAP_FOLLOW}>
                      <CategoryFollowButton
                        slug={c.slug}
                        label={c.label}
                        initialFollowing={followed.includes(c.slug)}
                        signedIn={signedIn}
                      />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {signedIn && selected && (
        <span className={TAP_FOLLOW}>
          <CategoryFollowButton
            key={`${selected.slug}:${followed.includes(selected.slug)}`}
            slug={selected.slug}
            label={selected.label}
            initialFollowing={followed.includes(selected.slug)}
            signedIn={signedIn}
          />
        </span>
      )}
    </div>
  );
}
