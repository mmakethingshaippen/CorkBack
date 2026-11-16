import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Release regression (2026-11-16 production smoke test): the world map opened on London at zoom 3,
// so its first bounded request covered only Europe and showed "0 postings in view" when every
// posting was elsewhere. It must open on the whole world.
describe("world map starting view", () => {
  const src = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  it("WorldMapSection passes a whole-world initial view to MapView", () => {
    const s = src("src/components/map/WorldMapSection.tsx");
    expect(s).toMatch(/initialView=\{WORLD_START\}/);
    const m = s.match(/WORLD_START[^=]*=\s*\{\s*center:\s*\[(-?[\d.]+),\s*(-?[\d.]+)\],\s*zoom:\s*([\d.]+)\s*\}/);
    expect(m).not.toBeNull();
    expect(Number(m![3])).toBeLessThanOrEqual(1);
  });
  it("MapView uses initialView only when it has no postings yet", () => {
    const s = src("src/components/map/MapView.tsx");
    expect(s).toMatch(/first \? \[first\.lng, first\.lat\] : initialViewRef\.current\?\.center/);
    expect(s).toMatch(/zoom: first \? 12 : initialViewRef\.current\?\.zoom/);
  });
});
