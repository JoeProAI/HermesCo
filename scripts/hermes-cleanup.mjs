#!/usr/bin/env node
/**
 * Clean up duplicate Hermes-on-Daytona sandboxes left over from testing.
 *
 * Every deploy run created a fresh sandbox set to never auto-stop, so they're
 * burning credits. This lists all hermes-labeled sandboxes, KEEPS the newest
 * (the one you're using), and deletes the rest.
 *
 * Dry run (default — shows what it WOULD delete, deletes nothing):
 *   node hermes-cleanup.mjs /mnt/c/Projects/AI_Projects/cagent-studio/.env.local
 * Actually delete:
 *   node hermes-cleanup.mjs /mnt/c/Projects/AI_Projects/cagent-studio/.env.local --delete
 */
import { Daytona } from "@daytonaio/sdk";
import { existsSync, readFileSync } from "node:fs";

const envFile = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) || ".env.local";
const DO_DELETE = process.argv.includes("--delete");
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

const die = (m) => { console.error("FATAL:", m); process.exit(1); };
if (!process.env.DAYTONA_API_KEY) die("DAYTONA_API_KEY not set");

const LABEL = { app: "hermes", platform: "clawd.run", role: "dashboard" };

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  target: (process.env.DAYTONA_TARGET || "us").toLowerCase(),
});

const list = await daytona.list(LABEL, 1, 100);
const items = (list.items || []).sort(
  (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
);

console.log(`Found ${items.length} hermes sandbox(es).`);
if (items.length === 0) process.exit(0);

const keep = items[0];
console.log(`KEEP   ${keep.id}  (newest, state: ${keep.state || "?"})`);
const toDelete = items.slice(1);
for (const it of toDelete) {
  console.log(`DELETE ${it.id}  (state: ${it.state || "?"}, created: ${it.createdAt || "?"})`);
}

if (!DO_DELETE) {
  console.log(`\nDry run. ${toDelete.length} would be deleted. Re-run with --delete to remove them.`);
  process.exit(0);
}

let deleted = 0;
for (const it of toDelete) {
  try {
    await daytona.delete(await daytona.get(it.id));
    console.log("deleted " + it.id);
    deleted++;
  } catch (e) {
    console.log("FAILED  " + it.id + " -> " + String(e).slice(0, 100));
  }
}
console.log(`\nDone. Deleted ${deleted}/${toDelete.length}. Kept ${keep.id}.`);
