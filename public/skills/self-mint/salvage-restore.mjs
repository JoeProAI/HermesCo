/**
 * salvage-restore.mjs — Restore agent soul from Arweave
 *
 * ZERO dependency on clawd.run. Works as long as Arweave exists.
 * Uses only Node.js built-in crypto — no npm packages required.
 *
 * Usage:
 *   node salvage-restore.mjs <txId> [--dry-run] [--key /path/to/salvage-keys.json]
 *
 * What it does:
 *   1. Fetches the TX from arweave.net
 *   2. Extracts the embedded soul JSON from the HTML page
 *   3. Decrypts using your local X25519 private key
 *   4. Writes the files to their original paths (or prints them in --dry-run mode)
 *
 * Key sources (in order of preference):
 *   --key <path>                  explicit path
 *   ~/.openclaw/agents/home/agent/salvage-keys.json   OpenClaw default
 *   ./salvage-keys.json           current directory fallback
 */

import {
  createDecipheriv,
  diffieHellman,
  hkdfSync,
  createPrivateKey,
  createPublicKey,
} from "crypto";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

// ── Args ──────────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const txId     = args.find(a => !a.startsWith("--"));
const dryRun   = args.includes("--dry-run");
const keyIdx   = args.indexOf("--key");
const keyPath  = keyIdx !== -1 ? args[keyIdx + 1] : null;

if (!txId) {
  console.error("Usage: node salvage-restore.mjs <txId> [--dry-run] [--key /path/to/keys.json]");
  process.exit(1);
}

// ── Load private key ──────────────────────────────────────────────────────────

const KEY_CANDIDATES = [
  keyPath,
  join(homedir(), ".openclaw", "agents", "home", "agent", "salvage-keys.json"),
  "./salvage-keys.json",
].filter(Boolean);

let keypair = null;
for (const candidate of KEY_CANDIDATES) {
  if (existsSync(candidate)) {
    keypair = JSON.parse(readFileSync(candidate, "utf8"));
    console.log("Loaded keys from:", candidate);
    console.log("Fingerprint:     ", keypair.fingerprint);
    break;
  }
}

if (!keypair) {
  console.error("No keypair found. Tried:");
  KEY_CANDIDATES.forEach(p => console.error(" ", p));
  console.error("\nExport your key from clawd.run: GET /api/agent/keys/export (requires login)");
  process.exit(1);
}

// ── Fetch TX ──────────────────────────────────────────────────────────────────

console.log(`\nFetching TX ${txId} from Arweave...`);
const res = await fetch(`https://arweave.net/${txId}`);
if (!res.ok) {
  console.error(`Arweave fetch failed: ${res.status}`);
  process.exit(1);
}

const html = await res.text();
console.log(`Fetched ${Math.round(html.length / 1024)}KB`);

// ── Extract soul JSON ─────────────────────────────────────────────────────────

const match = html.match(/<script[^>]+id="agent-soul"[^>]*>([\s\S]*?)<\/script>/);
if (!match) {
  // Try legacy format (raw JSON TX)
  try {
    const parsed = JSON.parse(html);
    console.log("Legacy TX format detected (unencrypted JSON)");
    printSoul(parsed);
    process.exit(0);
  } catch {
    console.error("Could not extract soul from TX. Is this a valid Neural Salvage TX?");
    process.exit(1);
  }
}

const soulEnvelope = JSON.parse(match[1].trim());
console.log("Schema:    ", soulEnvelope.schema);
console.log("Encrypted: ", soulEnvelope.encrypted);
console.log("Timestamp: ", soulEnvelope.timestamp);
console.log("Agent:     ", soulEnvelope.agent?.name, `(${soulEnvelope.agent?.id})`);

// ── Decrypt ───────────────────────────────────────────────────────────────────

let soul;

if (!soulEnvelope.encrypted) {
  console.log("\nSoul is not encrypted — extracting directly.");
  soul = soulEnvelope.soul;
} else {
  console.log("\nDecrypting soul...");
  const enc = soulEnvelope.soul; // EncryptedSoul object

  if (!enc?.keys?.agent) {
    console.error("No agent key envelope found in soul. Cannot decrypt.");
    process.exit(1);
  }

  const envelope = enc.keys.agent;
  const privKey  = createPrivateKey(keypair.encryption.privateKey);
  const pubKey   = createPublicKey(envelope.ephemeralPublicKey);

  // ECDH shared secret
  const sharedSecret = diffieHellman({ privateKey: privKey, publicKey: pubKey });

  // HKDF derive wrapping key (must match salvage-crypto.ts)
  const wrappingKey = Buffer.from(hkdfSync(
    "sha256",
    sharedSecret,
    Buffer.alloc(0),
    Buffer.from("neural-salvage-key-wrap-v1"),
    32
  ));

  // Unwrap AES key
  const keyDecipher = createDecipheriv(
    "aes-256-gcm",
    wrappingKey,
    Buffer.from(envelope.iv, "base64")
  );
  keyDecipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  let aesKey = keyDecipher.update(Buffer.from(envelope.wrappedKey, "base64"));
  aesKey = Buffer.concat([aesKey, keyDecipher.final()]);
  wrappingKey.fill(0);

  // Decrypt payload
  const payload  = enc.payload;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    aesKey,
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  let plaintext = decipher.update(payload.ciphertext, "base64", "utf8");
  plaintext += decipher.final("utf8");
  aesKey.fill(0);

  soul = JSON.parse(plaintext);
  console.log("Decryption successful.");
}

// ── Restore files ─────────────────────────────────────────────────────────────

if (!soul?.files) {
  console.log("\nNo files object in soul. Raw soul contents:");
  console.log(JSON.stringify(soul, null, 2));
  process.exit(0);
}

const targetPath = soul.restoration?.targetPath || process.cwd();
const files      = soul.files;
const fileList   = Object.keys(files);

console.log(`\nRestoring ${fileList.length} files to: ${targetPath}`);
if (dryRun) console.log("(DRY RUN — no files written)\n");

for (const [relativePath, content] of Object.entries(files)) {
  const fullPath = join(targetPath, relativePath);
  console.log(dryRun ? `  [dry] ${relativePath}` : `  writing ${relativePath}`);

  if (!dryRun) {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }
}

console.log(dryRun
  ? `\nDry run complete. Re-run without --dry-run to restore files.`
  : `\nRestore complete. ${fileList.length} files written to ${targetPath}`
);
