import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

// Work dir (state, screenshots, results) lives outside the repo.
export const WORK = process.env.CB_E2E_DIR ?? path.join(os.tmpdir(), "cb_avatar_e2e");
fs.mkdirSync(WORK, { recursive: true });
export const STATE = path.join(WORK, "state.json");
export const BASE = process.env.CB_BASE_URL ?? "http://localhost:3100";

export function loadEnv() {
  const file = process.env.CB_ENV_FILE ?? path.join(process.env.CB_REPO ?? "", ".env.local");
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return env;
}
export const env = loadEnv();
export const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export const loadState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {});
export const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));

// sharp comes from the repo's node_modules (exact version the app uses).
export const sharp = createRequire(path.join(process.env.CB_REPO ?? "", "package.json"))("sharp");

export const TABLES = ["postings", "profiles", "likes", "plans", "follows", "connections", "replies", "message_threads", "messages", "posting_reports", "admins", "category_follows", "hidden_postings"];
export async function counts() {
  const out = {};
  for (const t of TABLES) {
    const { count, error } = await admin.from(t).select("*", { count: "exact", head: true });
    out[t] = error ? `err:${error.code}` : count;
  }
  return out;
}
export async function hashOf(t, cols) {
  const { data } = await admin.from(t).select(cols).order(cols.split(",")[0]);
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
}

// Every object name in the avatars bucket (one folder level: <user id>/<file>).
export async function bucketNames() {
  const b = admin.storage.from("avatars");
  const { data: top } = await b.list("", { limit: 1000 });
  const names = [];
  for (const e of top ?? []) {
    if (e.id === null) {
      const { data: inner } = await b.list(e.name, { limit: 1000 });
      for (const f of inner ?? []) names.push(`${e.name}/${f.name}`);
    } else names.push(e.name);
  }
  return names.sort();
}
export async function snapshot() {
  const names = await bucketNames();
  return {
    counts: await counts(),
    hashes: {
      postings: await hashOf("postings", "id,title,expires_at,deleted_at,moderation_hidden_at"),
      profiles: await hashOf("profiles", "id,username,avatar_path"),
      bucket: crypto.createHash("sha256").update(names.join("\n")).digest("hex").slice(0, 16),
    },
    bucketObjects: names.length,
  };
}
