/**
 * launchpad-openrouter-test.mjs
 *
 * Two-phase smoke test for the OpenRouter sub-key module:
 *
 *   1. Encryption round-trip — verifies AES-256-GCM encrypt/decrypt with
 *      the same PLATFORM_SECRET produces the original plaintext. Catches
 *      any IV/tag handling bugs without touching OpenRouter at all.
 *
 *   2. (Optional, if --live) End-to-end OpenRouter API exercise —
 *      creates a $0.01-limit key, fetches it back, patches its name,
 *      then deletes it. Validates OPENROUTER_MANAGEMENT_KEY auth +
 *      every API verb we depend on. Costs nothing (no inference calls).
 *
 * Usage:
 *   node scripts/launchpad-openrouter-test.mjs           # encryption only
 *   node scripts/launchpad-openrouter-test.mjs --live    # + real API calls
 */
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

// ── env load ────────────────────────────────────────────────────────────────
for (const f of [".env.vercel.local", ".env.local"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const LIVE = process.argv.includes("--live");

// ── phase 1: encryption round-trip ──────────────────────────────────────────
function getEncKey() {
  const secret = process.env.PLATFORM_SECRET;
  if (!secret) throw new Error("PLATFORM_SECRET not set");
  return crypto.createHash("sha256").update(secret).digest();
}
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ct.toString("hex")}`;
}
function decrypt(payload) {
  const [ivHex, tagHex, ctHex] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
}

const sampleKey = "sk-or-v1-" + crypto.randomBytes(24).toString("hex");
const encrypted = encrypt(sampleKey);
const decrypted = decrypt(encrypted);

if (decrypted !== sampleKey) {
  console.error(`✗ encryption round-trip FAILED`);
  console.error(`  original:  ${sampleKey}`);
  console.error(`  decrypted: ${decrypted}`);
  process.exit(1);
}
console.log(`✓ encryption round-trip OK (${sampleKey.slice(0, 14)}... -> ${encrypted.length} chars -> match)`);

if (!LIVE) {
  console.log("\nSkipping live API test. Pass --live to exercise OpenRouter.");
  process.exit(0);
}

// ── phase 2: live API exercise ──────────────────────────────────────────────
const MGMT = process.env.OPENROUTER_MANAGEMENT_KEY;
if (!MGMT) {
  console.error("✗ OPENROUTER_MANAGEMENT_KEY not set");
  console.error("  Create one at https://openrouter.ai/settings/management-keys");
  console.error("  Then add it to .env.local and re-run with --live");
  process.exit(1);
}

const BASE = "https://openrouter.ai/api/v1";
async function or(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${MGMT}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path} -> ${res.status}: ${text}`);
  return JSON.parse(text);
}

console.log("\n[live] creating sub-key with $0.01 limit, monthly reset…");
const testUserId = `e2e-${crypto.randomBytes(4).toString("hex")}`;
const created = await or("/keys", {
  method: "POST",
  body: JSON.stringify({
    name: `launchpad-${testUserId}`,
    label: `lp:${testUserId}`,
    limit: 0.01,
    limit_reset: "monthly",
    include_byok_in_limit: false,
  }),
});
const hash = created.data.hash;
const plaintextKey = created.key;
console.log(`[live] created. hash=${hash.slice(0, 16)}... key=${plaintextKey.slice(0, 14)}...`);

console.log("[live] GET /keys/<hash>…");
const fetched = await or(`/keys/${hash}`);
console.log(`[live] limit=$${fetched.data.limit}, remaining=$${fetched.data.limit_remaining}, usage=$${fetched.data.usage}, reset=${fetched.data.limit_reset}`);

console.log("[live] PATCH name…");
await or(`/keys/${hash}`, {
  method: "PATCH",
  body: JSON.stringify({ name: `launchpad-${testUserId}-renamed` }),
});

console.log("[live] DELETE…");
await or(`/keys/${hash}`, { method: "DELETE" });
console.log("[live] deleted ✓");

console.log("\n✓ All checks passed. OpenRouter sub-key flow is wired correctly.");
