import crypto from "node:crypto";
import { admin, loadState, saveState } from "./lib.mjs";

// Creates 4 disposable accounts, 2 [TEST] postings and the relationships the display checks need:
//   a = owner under test, b = second account, r = rate-limit account, m = temporary admin (grant is the owner's SQL)
//   b follows a; a and b are friends; r has a pending request to b.
const s = loadState();
const hex = crypto.randomBytes(3).toString("hex"); // 6 hex, required by the stage 8 test-admin grant
s.hex = hex;
s.pw = "Cb!" + crypto.randomBytes(8).toString("hex");
s.users = {};
s.postings = {};
const names = { a: `cbsoc_a_${hex}`, b: `cbsoc_b_${hex}`, r: `cbsoc_r_${hex}`, m: `cbsoc_admin_${hex}` };
for (const k of ["a", "b", "r", "m"]) {
  const username = names[k];
  const email = `${username}@corkback-test.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: s.pw, email_confirm: true });
  if (error) throw error;
  s.users[k] = { id: data.user.id, username, email };
  saveState(s); // saved first so cleanup can find it even if a later step fails
  const { error: pe } = await admin.from("profiles").insert({ id: data.user.id, username });
  if (pe) throw pe;
}
const { data: cat } = await admin.from("categories").select("id").eq("slug", "meetup").single();
const future = (d) => new Date(Date.now() + d * 864e5).toISOString();
const today = new Date().toISOString().slice(0, 10);
for (const [key, who, title] of [["p1", "a", "[TEST] Avatar posting by A"], ["p2", "b", "[TEST] Avatar posting by B"]]) {
  const { data, error } = await admin.from("postings").insert({
    author_id: s.users[who].id, title, body: "[TEST] disposable posting for avatar verification", category_id: cat.id,
    event_date: today, place_label: "[TEST] Berkeley", lat: 37.87, lng: -122.27, expiry: "1w", expires_at: future(7),
  }).select("id").single();
  if (error) throw error;
  s.postings[key] = { id: data.id, title };
  saveState(s);
}
const must = (r) => { if (r.error) throw r.error; };
must(await admin.from("follows").insert({ follower_id: s.users.b.id, followee_id: s.users.a.id }));
must(await admin.from("connections").insert({ requester_id: s.users.a.id, addressee_id: s.users.b.id, status: "accepted" }));
must(await admin.from("connections").insert({ requester_id: s.users.r.id, addressee_id: s.users.b.id }));
must(await admin.from("plans").upsert({ posting_id: s.postings.p2.id, user_id: s.users.a.id, kind: "going" }, { onConflict: "posting_id,user_id" }));
saveState(s);
console.log("setup ok. Temporary admin username:", names.m);
