import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SEED_POSTINGS } from "./seed";

/** Validates: Requirements 20.5, 20.6 */
const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const IMPORT_RE = /__fixtures__|scripts[\\/]board-e2e|board-e2e/;

describe("fixture data guard", () => {
  it("no SEED_POSTINGS id starts with fx-", () => {
    const bad = SEED_POSTINGS.filter((p) => p.id.startsWith("fx-")).map((p) => p.id);
    expect(bad).toEqual([]);
  });

  it("only test files and src/lib/__fixtures__ reference fixtures or scripts/board-e2e", () => {
    const offenders = walk(SRC)
      .filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f))
      .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) => !relative(SRC, f).split(sep).join("/").startsWith("lib/__fixtures__/"))
      .filter((f) => IMPORT_RE.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
