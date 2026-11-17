import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { locationNote } from "./postingLocation";

/**
 * Guards for the posting-location flow.
 * Validates: Requirements 4.2, 7.2, 7.7, 7.9, 12.8, 14.7, 16.9, 19.5, 20.8
 */
const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const SELF = "src/lib/locationGuards.test.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const exists = (p: string) => existsSync(join(ROOT, p));

/** Read an exported string-literal constant from a source file without importing it. */
function stringConst(file: string, name: string): string {
  const m = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(read(file));
  if (!m) throw new Error(`could not read ${name} from ${file}`);
  return JSON.parse(`"${m[1]}"`) as string;
}

/** Remove comments so a mention in prose is not mistaken for code. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The posting flow: location modules, the picker and the forms that use them. */
const POSTING_FLOW = [
  "src/lib/postingLocation.ts",
  "src/lib/geocode.ts",
  "src/lib/addressCandidates.ts",
  "src/lib/addressLeaks.ts",
  "src/lib/contactDetails.ts",
  "src/lib/deviceLocation.ts",
  "src/lib/geocodeQueryPrepare.ts",
  "src/components/map/LocationPicker.tsx",
  "src/components/map/locationPickerActions.ts",
  "src/components/map/pickerMapStyle.ts",
  "src/components/map/StaticPinMap.tsx",
  "src/app/scan/review/ReviewForm.tsx",
  "src/app/p/[id]/edit/EditPostingForm.tsx",
].filter(exists);

const HOME_BROWSING = /(boardStorage|geoPermission|HomeMap|\blib\/nearby\b|\/nearby["'])/;

describe("posting-location guards", () => {
  it("the posting flow files exist", () => {
    expect(POSTING_FLOW.length).toBeGreaterThanOrEqual(10);
    expect(POSTING_FLOW).toContain("src/components/map/LocationPicker.tsx");
    expect(POSTING_FLOW).toContain("src/lib/postingLocation.ts");
  });

  it("the posting flow imports no home browsing-location code", () => {
    const offenders: string[] = [];
    for (const f of POSTING_FLOW) {
      const imports = [...stripComments(read(f)).matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) if (HOME_BROWSING.test(spec) || /(^|\/)nearby$/.test(spec)) offenders.push(`${f} -> ${spec}`);
    }
    expect(offenders).toEqual([]);
  });

  it("navigator.geolocation appears only in deviceLocation.ts within the posting flow", () => {
    const offenders = POSTING_FLOW.filter((f) => f !== "src/lib/deviceLocation.ts")
      .filter((f) => /geolocation/.test(stripComments(read(f))));
    expect(offenders).toEqual([]);
    expect(/navigator\.geolocation|geolocation/.test(read("src/lib/deviceLocation.ts"))).toBe(true);
  });

  it("clampPinNudge and MAX_NUDGE_METERS are not exported by domain.ts and used only under __testing__ or in tests", () => {
    const domain = stripComments(read("src/lib/domain.ts"));
    expect(domain).not.toMatch(/\b(clampPinNudge|MAX_NUDGE_METERS)\b/);
    const offenders = walk(SRC)
      .filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f))
      .filter((f) => !rel(f).startsWith("src/lib/__testing__/") && rel(f) !== SELF)
      .filter((f) => /\b(clampPinNudge|MAX_NUDGE_METERS)\b/.test(stripComments(readFileSync(f, "utf8"))))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the retired phrases are absent from src, README.md and DEMO_PLAN.md", () => {
    const phrases = [
      ["pins where", " you are"],
      ["not at a venue read", " from the paper"],
      ["Pin set near your", " current location"],
      ["Your flyer pins near", " where you are"],
    ].map((parts) => parts.join("").toLowerCase());
    const files = [
      ...walk(SRC).map(rel).filter((f) => f !== SELF),
      ...["README.md", "DEMO_PLAN.md"].filter(exists),
    ];
    const hits: string[] = [];
    for (const f of files) {
      if (!/\.(ts|tsx|js|jsx|mjs|md|css|json|sql)$/.test(f)) continue;
      const text = read(f).toLowerCase();
      for (const p of phrases) if (text.includes(p)) hits.push(`${f}: ${p}`);
    }
    expect(hits).toEqual([]);
  });

  it("no private-home or approximate copy under src claims a displaced pin guarantees anonymity", () => {
    // Requirement 23.6/23.8: the private-home explanation and the approximate note describe
    // an approximate area and must never promise anonymity or that the poster cannot be traced.
    const BANNED = [
      /\banonymous\b/i,
      /\banonymity\b/i,
      /can['’]?t be identified/i,
      /cannot be identified/i,
      /can['’]?t be traced/i,
      /cannot be traced/i,
      /untraceable/i,
      /hides? (?:your|the poster|who you are)/i,
      /keeps? you anonymous/i,
    ];
    // String literals that make up the private-home / approximate-location copy.
    const PICKER = "src/components/map/LocationPicker.tsx";
    const COPY: { label: string; text: string }[] = [
      { label: "locationNote(approximate)", text: locationNote("approximate") ?? "" },
      { label: "PRIVATE_HOME_EXPLANATION", text: stringConst(PICKER, "PRIVATE_HOME_EXPLANATION") },
      { label: "FLYER_IMAGE_WARNING", text: stringConst(PICKER, "FLYER_IMAGE_WARNING") },
    ];
    const hits: string[] = [];
    for (const { label, text } of COPY) {
      for (const re of BANNED) if (re.test(text)) hits.push(`${label}: matched ${re}`);
    }
    expect(hits).toEqual([]);

    // A broad sweep of the picker and detail copy files catches any inline anonymity claim
    // added later next to the approximate-area or private-home wording.
    for (const f of ["src/components/map/LocationPicker.tsx", "src/app/p/[id]/page.tsx"].filter(exists)) {
      const code = stripComments(read(f));
      const windows = [...code.matchAll(/approximate|private home/gi)].map((m) =>
        code.slice(Math.max(0, m.index! - 160), m.index! + 160),
      );
      for (const w of windows) {
        for (const re of BANNED) if (re.test(w)) hits.push(`${f}: "${re}" near approximate/private-home copy`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("the approximate copy keeps its honest statements and the separate flyer-image warning exists", () => {
    const PICKER = "src/components/map/LocationPicker.tsx";
    const explanation = stringConst(PICKER, "PRIVATE_HOME_EXPLANATION");
    const flyerWarning = stringConst(PICKER, "FLYER_IMAGE_WARNING");

    // Requirement 23.8: keep "about a quarter mile (400 m)" and "The street address is not shown".
    expect(explanation).toContain("about a quarter mile (400 m)");
    expect(explanation).toContain("The street address is not shown");

    // Requirement 23.6: the detail note still states the exact address is not shown.
    expect(locationNote("approximate")).toContain("The exact address is not shown.");
    expect(locationNote("exact")).toBeNull();
    expect(locationNote("unreviewed")).toBeNull();

    // Requirement 23.7: a separate warning, distinct from the pin and the approximate note,
    // that a flyer image or the posting text can still reveal an address.
    expect(flyerWarning).toBe(
      "A flyer image or words in your posting can still show an address. The approximate pin does not hide what the image or text says.",
    );
    // It is genuinely rendered by the picker, not just exported.
    expect(read(PICKER)).toContain("FLYER_IMAGE_WARNING");
  });

  it("package.json has no new dependency", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      "@google/generative-ai",
      "@photostructure/tz-lookup",
      "@supabase/ssr",
      "@supabase/supabase-js",
      "maplibre-gl",
      "next",
      "react",
      "react-dom",
      "resend",
      "server-only",
      "sharp",
    ]);
    expect(Object.keys(pkg.devDependencies).sort()).toEqual([
      "@types/node",
      "@types/react",
      "@types/react-dom",
      "autoprefixer",
      "eslint",
      "eslint-config-next",
      "fast-check",
      "postcss",
      "tailwindcss",
      "typescript",
      "vitest",
    ]);
  });

  it("client code does not reference the geocoder store, the server-only geocoder query or the service key", () => {
    const clientFiles = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) => rel(f).startsWith("src/components/") || /^\s*["']use client["']/m.test(readFileSync(f, "utf8").slice(0, 400)));
    expect(clientFiles.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of clientFiles) {
      const code = stripComments(readFileSync(f, "utf8"));
      if (/geocoderStore/.test(code)) offenders.push(`${rel(f)}: geocoderStore`);
      if (/SUPABASE_SERVICE_ROLE_KEY/.test(code)) offenders.push(`${rel(f)}: SUPABASE_SERVICE_ROLE_KEY`);
      if (/from\s*["'][^"']*\/geocodeQuery["']/.test(code)) offenders.push(`${rel(f)}: geocodeQuery`);
    }
    expect(offenders).toEqual([]);
  });

  it("LocationPicker.tsx has no onChange handler that calls fetch", () => {
    const code = stripComments(read("src/components/map/LocationPicker.tsx"));

    /** Text from `start` through the matching close of the bracket at `start`. */
    const balanced = (s: string, start: number): string => {
      const open = s[start];
      const close = open === "{" ? "}" : open === "(" ? ")" : "]";
      let depth = 0;
      for (let i = start; i < s.length; i++) {
        if (s[i] === open) depth++;
        else if (s[i] === close && --depth === 0) return s.slice(start, i + 1);
      }
      return s.slice(start);
    };
    const callsFetch = (t: string) => /\bfetch\s*\(|\bfetch\b/.test(t);

    const offenders: string[] = [];
    for (const m of code.matchAll(/onChange\s*=\s*\{/g)) {
      const expr = balanced(code, m.index! + m[0].length - 1);
      if (callsFetch(expr)) offenders.push(`inline: ${expr.slice(0, 60)}`);
      // A named handler: onChange={name} or onChange={() => name(...)}
      for (const id of new Set([...expr.matchAll(/\b([A-Za-z_]\w*)\b/g)].map((x) => x[1]))) {
        const def = new RegExp(`(?:function\\s+${id}\\s*\\(|(?:const|let)\\s+${id}\\s*=)`).exec(code);
        if (!def) continue;
        const brace = code.indexOf("{", code.indexOf(")", def.index) >= 0 ? def.index : def.index);
        if (brace < 0) continue;
        if (callsFetch(balanced(code, brace))) offenders.push(`handler: ${id}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
