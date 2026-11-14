import { admin, bucketNames, loadState, saveState, snapshot } from "./lib.mjs";

// Deletes ONLY what setup.mjs recorded: the four accounts, their Storage objects, postings, threads and rows.
// The upload ledger (avatar_uploads) has no service-role access by design; it goes with the profile (ON DELETE CASCADE).
const s = loadState();
const ids = Object.values(s.users ?? {}).map((u) => u.id);
const postingIds = Object.values(s.postings ?? {}).map((p) => p.id);
const log = (...a) => console.log(...a);

// 1. Storage objects: everything under each test user's folder (and nothing else).
const bucket = admin.storage.from("avatars");
for (const id of ids) {
  const { data } = await bucket.list(id, { limit: 1000 });
  const paths = (data ?? []).map((f) => `${id}/${f.name}`);
  if (paths.length) { const { error } = await bucket.remove(paths); log("removed", paths.length, "objects for", id.slice(0, 8), error?.message ?? ""); }
}
// 2. Rows.
if (ids.length) {
  const { data: th } = await admin.from("message_threads").select("id").or(`user_lo.in.(${ids.join(",")}),user_hi.in.(${ids.join(",")})`);
  const threadIds = (th ?? []).map((t) => t.id);
  if (threadIds.length) { await admin.from("messages").delete().in("thread_id", threadIds); await admin.from("message_threads").delete().in("id", threadIds); }
}
if (postingIds.length) {
  await admin.from("posting_reports").delete().in("posting_id", postingIds);
  await admin.from("replies").delete().in("posting_id", postingIds);
  await admin.from("plans").delete().in("posting_id", postingIds);
  await admin.from("likes").delete().in("posting_id", postingIds);
  await admin.from("postings").delete().in("id", postingIds);
}
if (ids.length) {
  await admin.from("plans").delete().in("user_id", ids);
  await admin.from("likes").delete().in("user_id", ids);
  await admin.from("follows").delete().in("follower_id", ids);
  await admin.from("follows").delete().in("followee_id", ids);
  await admin.from("connections").delete().in("requester_id", ids);
  await admin.from("connections").delete().in("addressee_id", ids);
  await admin.from("admins").delete().in("user_id", ids);
  await admin.from("profiles").delete().in("id", ids);
  for (const id of ids) { const { error } = await admin.auth.admin.deleteUser(id); if (error) log("deleteUser", id.slice(0, 8), error.message); }
}
const now = await snapshot();
log("baseline:", JSON.stringify(s.baseline));
log("now     :", JSON.stringify(now));
log("MATCH:", JSON.stringify(now) === JSON.stringify(s.baseline));
const left = (await bucketNames()).filter((n) => ids.some((id) => n.startsWith(id)));
log("leftover test objects:", left.length);
const { data: lp } = await admin.from("profiles").select("username").like("username", `cbsoc_%_${s.hex ?? "zzzzzz"}`);
const { data: la } = await admin.from("profiles").select("username").like("username", `cbsoc_admin_${s.hex ?? "zzzzzz"}`);
log("leftover test profiles:", [...(lp ?? []), ...(la ?? [])].length);
s.cleaned = true;
saveState(s);
