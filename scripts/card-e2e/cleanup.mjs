import crypto from "node:crypto";
import { admin, counts, loadState, saveState } from "./lib.mjs";

// Deletes ONLY the rows/accounts that setup.mjs recorded in state.json, then
// compares counts and hashes with the baseline.
const s = loadState();
const userIds = Object.values(s.users ?? {}).map((u) => u.id);
const postingIds = Object.values(s.postings ?? {}).map((p) => p.id);
if (postingIds.length) {
  await admin.from("plans").delete().in("posting_id", postingIds);
  await admin.from("likes").delete().in("posting_id", postingIds);
  await admin.from("postings").delete().in("id", postingIds);
}
if (userIds.length) {
  await admin.from("plans").delete().in("user_id", userIds);
  await admin.from("likes").delete().in("user_id", userIds);
  await admin.from("follows").delete().in("follower_id", userIds);
  await admin.from("follows").delete().in("followee_id", userIds);
  await admin.from("profiles").delete().in("id", userIds);
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
}
const hashOf = async (t, cols) => {
  const { data } = await admin.from(t).select(cols).order(cols.split(",")[0]);
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
};
const now = {
  counts: await counts(),
  hashes: {
    postings: await hashOf("postings", "id,title,expires_at,deleted_at,moderation_hidden_at"),
    profiles: await hashOf("profiles", "id,username"),
  },
};
console.log("baseline:", JSON.stringify(s.baseline));
console.log("now     :", JSON.stringify(now));
console.log("MATCH:", JSON.stringify(now) === JSON.stringify(s.baseline));
const { data: left } = await admin.from("profiles").select("username").like("username", `cbsoc_%_${s.hex ?? "zzzz"}`);
console.log("leftover test profiles:", left);
s.cleaned = true;
saveState(s);
