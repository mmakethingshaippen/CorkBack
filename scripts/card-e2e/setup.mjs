import crypto from "node:crypto";
import { admin, loadState, saveState } from "./lib.mjs";

// Creates 2 disposable accounts, 4 [TEST] postings and one follow (A follows B).
const s = loadState();
const hex = crypto.randomBytes(3).toString("hex");
s.hex = hex;
s.pw = "Cb!" + crypto.randomBytes(8).toString("hex");
s.users = {};
s.postings = {};

for (const k of ["a", "b"]) {
  const username = `cbsoc_${k}_${hex}`;
  const email = `${username}@corkback-test.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: s.pw, email_confirm: true });
  if (error) throw error;
  s.users[k] = { id: data.user.id, username, email };
  saveState(s); // saved first, so cleanup can find it even if a later step fails
  // The sign-up route creates profiles itself; the DB trigger is not relied on.
  const { error: pe } = await admin.from("profiles").insert({ id: data.user.id, username });
  if (pe) throw pe;
}

const { data: cat } = await admin.from("categories").select("id").eq("slug", "meetup").single();
const future = (d) => new Date(Date.now() + d * 864e5).toISOString();
const today = new Date().toISOString().slice(0, 10);
const defs = [
  ["p1", "a", "[TEST] Card A1 owned by A"],
  ["p2", "b", "[TEST] Card B2 followed"],
  ["p3", "b", "[TEST] Card B3 will end"],
  ["p4", "b", "[TEST] Card B4 will be hidden"],
];
for (const [key, who, title] of defs) {
  const { data, error } = await admin
    .from("postings")
    .insert({
      author_id: s.users[who].id,
      title,
      body: "[TEST] disposable posting for card verification",
      category_id: cat.id,
      event_date: today,
      place_label: "[TEST] Berkeley",
      lat: 37.87,
      lng: -122.27,
      expiry: "1w",
      expires_at: future(7),
    })
    .select("id")
    .single();
  if (error) throw error;
  s.postings[key] = { id: data.id, title };
  saveState(s);
}
const { error: fe } = await admin.from("follows").insert({ follower_id: s.users.a.id, followee_id: s.users.b.id });
if (fe) throw fe;
saveState(s);
console.log("setup ok", s.hex, Object.keys(s.postings));
