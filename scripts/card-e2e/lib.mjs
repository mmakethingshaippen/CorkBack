import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Work dir (state, screenshots, results) lives outside the repo.
export const WORK = process.env.CB_E2E_DIR ?? path.join(os.tmpdir(), "cb_cards_e2e");
fs.mkdirSync(WORK, { recursive: true });
export const STATE = path.join(WORK, "state.json");

export function loadEnv() {
  const file = process.env.CB_ENV_FILE ?? new URL("../../.env.local", import.meta.url);
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}
export const env = loadEnv();
export const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
export const loadState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {});
export const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));

export async function counts() {
  const out = {};
  for (const t of ["postings", "profiles", "likes", "plans", "follows", "connections", "replies"]) {
    const { count, error } = await admin.from(t).select("*", { count: "exact", head: true });
    out[t] = error ? `err:${error.code}` : count;
  }
  return out;
}
