/**
 * Category catalog — the single source of truth for every category chip, the
 * category filter, the scan review choice, and the alert choice. Mirrored by
 * rows in the `categories` table (see supabase/stage5_categories.sql).
 *
 * Full locked list (10), in order, no duplicates. The merges are already
 * reflected here: the former "Clubs" and "Meetup" are merged into "Social
 * Clubs"; "Sale" is now "Sales". The old `clubs`/`meetup` DB rows remain for FK
 * safety but are not shown (not in this list).
 */
export const CATEGORIES = [
  { slug: "music", label: "Music" },
  { slug: "nightlife", label: "Nightlife" },
  { slug: "sports", label: "Sports" },
  { slug: "social-clubs", label: "Social Clubs" },
  { slug: "lost-found", label: "Lost and Found" },
  { slug: "housing", label: "Housing and Real Estate" },
  { slug: "jobs", label: "Jobs" },
  { slug: "sale", label: "Sales" },
  { slug: "classes", label: "Classes" },
  { slug: "community", label: "Community" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

export function categoryLabel(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}
