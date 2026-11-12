import crypto from "node:crypto";
import { admin, counts, loadState, saveState } from "./lib.mjs";

// Read-only: records row counts and a hash of existing rows before the test.
const s = loadState();
const hashOf = async (t, cols) => {
  const { data } = await admin.from(t).select(cols).order(cols.split(",")[0]);
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
};
s.baseline = {
  counts: await counts(),
  hashes: {
    postings: await hashOf("postings", "id,title,expires_at,deleted_at,moderation_hidden_at"),
    profiles: await hashOf("profiles", "id,username"),
  },
};
saveState(s);
console.log(JSON.stringify(s.baseline, null, 1));
