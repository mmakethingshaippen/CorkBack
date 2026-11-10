import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// MapLibre GL 6 runs its tile/GeoJSON work in a module worker loaded from a
// separate file. Bundled into a Next chunk it can't find that file, so serve
// the installed version's worker from /maplibre/ (see src/components/map/maplibre.ts).
// Copied on every dev/build start, so it always matches node_modules; gitignored.
const workerSrc = path.join(root, "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const workerDest = path.join(root, "public", "maplibre", "maplibre-gl-worker.mjs");
if (fs.existsSync(workerSrc)) {
  fs.mkdirSync(path.dirname(workerDest), { recursive: true });
  fs.copyFileSync(workerSrc, workerDest);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // This repo is a single app. Pin file tracing to it so Next doesn't pick up a
  // package-lock.json in a parent folder (e.g. a stray one in the home folder)
  // as the workspace root.
  outputFileTracingRoot: root,
};

export default nextConfig;
