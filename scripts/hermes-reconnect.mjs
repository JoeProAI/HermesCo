#!/usr/bin/env node
/**
 * Reconnect to the existing Hermes-on-Daytona sandbox.
 *
 * The SSH access token expires after 60 min, but the sandbox + Hermes keep
 * running. This mints a fresh SSH token for the newest hermes sandbox and
 * prints the tunnel command — no redeploy, no reinstall.
 *
 * Usage (from ~/hermes-runner, where @daytonaio/sdk is installed):
 *   node hermes-reconnect.mjs /mnt/c/Projects/AI_Projects/cagent-studio/.env.local
 */
import { Daytona } from "@daytonaio/sdk";
import { existsSync, readFileSync } from "node:fs";

const envFile = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) || ".env.local";
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

const list = await daytona.list(LABEL, 1, 50);
const items = (list.items || []).sort(
  (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
);
if (!items.length) die("no hermes sandbox found — run hermes-daytona.mjs to create one");

const target = items[0];
const sandbox = await daytona.get(target.id);
const ssh = await sandbox.createSshAccess(60);
const token = (ssh && (ssh.token || ssh.sshToken)) || ssh;

console.log("\n========================================");
console.log("Sandbox: " + target.id + "  (state: " + (target.state || "?") + ")");
console.log("");
console.log("STEP 1 — separate terminal, leave running:");
console.log("  ssh -L 8082:localhost:8082 " + token + "@ssh.app.daytona.io");
console.log("STEP 2 — open: http://127.0.0.1:8082");
console.log("========================================");
