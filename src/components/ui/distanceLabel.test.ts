import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

/** Source contract for the optional distance label (Requirements 4.1, 4.8). */
describe("distance label props", () => {
  it("PostingCard takes an optional distanceLabel and renders it in the metadata line", () => {
    const src = read("src/components/ui/PostingCard.tsx");
    expect(src).toMatch(/distanceLabel\?: string/);
    expect(src).toMatch(/\$\{distanceLabel\}/);
  });
  it("PostingCardGrid takes optional distanceLabels keyed by id and forwards them", () => {
    const src = read("src/components/ui/PostingCardGrid.tsx");
    expect(src).toMatch(/distanceLabels\?: Record<string, string>/);
    expect(src).toContain("distanceLabels?.[posting.id]");
  });
  it.each(["src/app/u/[username]/page.tsx", "src/app/following/page.tsx"])(
    "%s passes no distance label",
    (f) => {
      expect(read(f)).not.toMatch(/distanceLabels?/);
    },
  );
});
