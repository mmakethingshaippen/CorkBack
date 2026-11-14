import { loadState, saveState, snapshot } from "./lib.mjs";
// Read-only: counts and hashes (including every avatar_path and every bucket object name).
const s = loadState();
s.baseline = await snapshot();
saveState(s);
console.log(JSON.stringify(s.baseline, null, 1));
