/** Category catalog — mirrors the seed in supabase/schema.sql. Text chips in code. */
export const CATEGORIES = [
  { slug: "music", label: "Music" },
  { slug: "sports", label: "Sports" },
  { slug: "clubs", label: "Clubs" },
  { slug: "lost-found", label: "Lost & Found" },
  { slug: "meetup", label: "Meetup" },
  { slug: "sale", label: "Sale" },
  { slug: "classes", label: "Classes" },
  { slug: "community", label: "Community" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

export function categoryLabel(slug: string): string {
  return CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
}
