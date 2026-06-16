/**
 * Agent Vault — Encrypted Arweave-Backed Agent Identity
 *
 * See docs/AGENT-VAULT-ARCHITECTURE.md for full design.
 *
 * Key structure:
 *   wrap_key  = HMAC-SHA256(PLATFORM_SECRET, uid + ":" + salt)
 *   agent_key = random AES-256 (per agent)
 *   stored    = AES-256-GCM encrypt(agent_key, wrap_key) → in Arweave bundle
 */

import crypto from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { salvageToArweave, retrieveFromArweave } from "./arweave-write";

const KDF_VERSION = "v1";
let hasLoggedMissingPlatformSecret = false;

function requirePlatformSecret(): string {
  const secret = process.env.PLATFORM_SECRET;
  if (secret) return secret;

  if (!hasLoggedMissingPlatformSecret && process.env.NODE_ENV === "production") {
    console.error("[agent-vault] CRITICAL: PLATFORM_SECRET not set. Agent vault will not function.");
    hasLoggedMissingPlatformSecret = true;
  }

  throw new Error("PLATFORM_SECRET not configured");
}

// ─── Audit Logging ───────────────────────────────────────────────────────────

async function auditLog(event: string, agentId: string, userId: string, reason: string, requestedBy: string) {
  try {
    const db = getAdminDb();
    await db.collection("audit_log").add({
      event,
      agentId,
      userId,
      reason,
      requestedBy,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[agent-vault] Audit log failed:", err);
  }
}

// ─── Key Derivation ───────────────────────────────────────────────────────────

function deriveWrapKey(uid: string, salt: string): Buffer {
  return crypto.createHmac("sha256", requirePlatformSecret())
    .update(`${uid}:${salt}`)
    .digest();
}

function encryptAgentKey(agentKey: Buffer, wrapKey: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", wrapKey, iv);
  const encrypted = Buffer.concat([cipher.update(agentKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(12) + tag(16) + encrypted(32) → hex
  return Buffer.concat([iv, tag, encrypted]).toString("hex");
}

function decryptAgentKey(encryptedHex: string, wrapKey: Buffer): Buffer {
  const buf = Buffer.from(encryptedHex, "hex");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", wrapKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// ─── File Encryption ──────────────────────────────────────────────────────────

function encryptFile(content: string, agentKey: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", agentKey, iv);
  const encrypted = Buffer.concat([cipher.update(content, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("hex");
}

function decryptFile(encryptedHex: string, agentKey: Buffer): string {
  const buf = Buffer.from(encryptedHex, "hex");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", agentKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ─── Agent File Bundle ────────────────────────────────────────────────────────

export interface AgentFiles {
  soul: string;       // SOUL.md content
  identity: string;   // IDENTITY.md content
  memory: string;     // MEMORY.md content
  config: string;     // openclaw.json content (no API keys)
  credentials?: string; // credentials.json content (optional)
  channels?: string[]; // connected channel names (not secrets)
}

export interface AgentBundle {
  manifest: {
    version: string;
    kdfVersion: string;
    agentId: string;
    userId: string;
    salt: string;
    createdAt: string;
    updatedAt: string;
    platform: string;
    openclawVersion: string;
    files: string[];
    channels: string[];
  };
  agent_key_enc: string;  // AES agent key encrypted with wrap_key
  soul_enc: string;
  identity_enc: string;
  memory_enc: string;
  config_enc: string;
  credentials_enc?: string;
}

function buildBundle(
  agentId: string,
  userId: string,
  salt: string,
  agentKey: Buffer,
  wrapKey: Buffer,
  files: AgentFiles,
): AgentBundle {
  const now = new Date().toISOString();
  return {
    manifest: {
      version: "1",
      kdfVersion: KDF_VERSION,
      agentId,
      userId,
      salt,
      createdAt: now,
      updatedAt: now,
      platform: "clawd.run",
      openclawVersion: process.env.OPENCLAW_VERSION || "2026.2.15",
      files: [
        "soul",
        "identity",
        "memory",
        "config",
        ...(files.credentials ? ["credentials"] : []),
      ],
      channels: files.channels || [],
    },
    agent_key_enc: encryptAgentKey(agentKey, wrapKey),
    soul_enc: encryptFile(files.soul, agentKey),
    identity_enc: encryptFile(files.identity, agentKey),
    memory_enc: encryptFile(files.memory, agentKey),
    config_enc: encryptFile(files.config, agentKey),
    ...(files.credentials
      ? { credentials_enc: encryptFile(files.credentials, agentKey) }
      : {}),
  };
}

// ─── Arweave Write/Read ───────────────────────────────────────────────────────

async function pushToArweave(bundle: AgentBundle): Promise<string> {
  const result = await salvageToArweave({
    soul: bundle,
    agentId: bundle.manifest.agentId,
    agentName: bundle.manifest.agentId,
    encrypt: false,
  });
  return result.txId;
}

async function fetchFromArweave(txId: string): Promise<AgentBundle> {
  const data = await retrieveFromArweave(txId) as { soul?: AgentBundle };
  return (data.soul ?? data) as AgentBundle;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new agent vault — called on first agent creation.
 * Generates keys, encrypts files, writes bundle to Arweave, stores TX ID in Firestore.
 */
export async function createAgentVault(
  agentId: string,
  userId: string,
  files: AgentFiles,
): Promise<{ txId: string }> {
  const salt = crypto.randomBytes(32).toString("hex");
  const agentKey = crypto.randomBytes(32);
  const wrapKey = deriveWrapKey(userId, salt);
  const bundle = buildBundle(agentId, userId, salt, agentKey, wrapKey, files);

  const txId = await pushToArweave(bundle);

  // Store TX ID + salt in Firestore (key is NOT stored here — it's in the bundle)
  const db = getAdminDb();
  await db.collection("agent_vaults").doc(agentId).set({
    agentId,
    userId,
    arweaveTxId: txId,
    salt,
    kdfVersion: KDF_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await auditLog("vault_created", agentId, userId, "agent_creation", `uid:${userId}`);
  console.log(`[agent-vault] Created vault for ${agentId} → Arweave TX: ${txId}`);
  return { txId };
}

/**
 * Restore agent files from Arweave — called on sandbox boot or manual restore.
 * Fetches bundle, derives wrap key, decrypts agent key, decrypts files.
 */
export async function restoreAgentVault(
  agentId: string,
  userId: string,
  reason: "sandbox_boot" | "restore" | "export",
  txIdOverride?: string, // if Firestore is unavailable, user can provide TX ID
): Promise<AgentFiles> {
  // Get TX ID from Firestore or use override
  let txId = txIdOverride;
  let salt: string | undefined;

  if (!txId) {
    const db = getAdminDb();
    const vaultDoc = await db.collection("agent_vaults").doc(agentId).get();
    if (!vaultDoc.exists) throw new Error(`No vault found for agent ${agentId}`);
    const vault = vaultDoc.data()!;
    txId = vault.arweaveTxId;
    salt = vault.salt;
  }

  const bundle = await fetchFromArweave(txId!);

  // Use salt from bundle manifest if not from Firestore
  const effectiveSalt = salt || bundle.manifest.salt;
  const effectiveUserId = userId || bundle.manifest.userId;

  const wrapKey = deriveWrapKey(effectiveUserId, effectiveSalt);
  const agentKey = decryptAgentKey(bundle.agent_key_enc, wrapKey);

  await auditLog("vault_accessed", agentId, userId, reason, `uid:${userId}`);

  return {
    soul: decryptFile(bundle.soul_enc, agentKey),
    identity: decryptFile(bundle.identity_enc, agentKey),
    memory: decryptFile(bundle.memory_enc, agentKey),
    config: decryptFile(bundle.config_enc, agentKey),
    credentials: bundle.credentials_enc
      ? decryptFile(bundle.credentials_enc, agentKey)
      : undefined,
    channels: bundle.manifest.channels,
  };
}

/**
 * Sync updated memory to Arweave — called periodically and on sandbox stop.
 * Generates a new TX (Arweave is append-only), updates Firestore pointer.
 */
export async function syncAgentMemory(
  agentId: string,
  userId: string,
  updatedMemory: string,
): Promise<{ txId: string }> {
  // Get current files (restore them to re-encrypt with same key)
  const db = getAdminDb();
  const vaultDoc = await db.collection("agent_vaults").doc(agentId).get();
  if (!vaultDoc.exists) throw new Error(`No vault for agent ${agentId}`);

  const vault = vaultDoc.data()!;
  const bundle = await fetchFromArweave(vault.arweaveTxId);
  const wrapKey = deriveWrapKey(userId, vault.salt);
  const agentKey = decryptAgentKey(bundle.agent_key_enc, wrapKey);

  // Re-encrypt with updated memory, same key, new TX
  const updatedBundle: AgentBundle = {
    ...bundle,
    manifest: { ...bundle.manifest, updatedAt: new Date().toISOString() },
    memory_enc: encryptFile(updatedMemory, agentKey),
  };

  const txId = await pushToArweave(updatedBundle);
  await db.collection("agent_vaults").doc(agentId).update({
    arweaveTxId: txId,
    updatedAt: new Date().toISOString(),
  });

  console.log(`[agent-vault] Memory synced for ${agentId} → new TX: ${txId}`);
  return { txId };
}

/**
 * Export — returns raw agent key + TX ID so user can take agent anywhere.
 * This is the "take your agent and go" function.
 */
export async function exportAgentVault(
  agentId: string,
  userId: string,
): Promise<{ arweaveTxId: string; agentKey: string; instructions: string }> {
  const db = getAdminDb();
  const vaultDoc = await db.collection("agent_vaults").doc(agentId).get();
  if (!vaultDoc.exists) throw new Error(`No vault for agent ${agentId}`);

  const vault = vaultDoc.data()!;
  if (vault.userId !== userId) throw new Error("Unauthorized");

  const bundle = await fetchFromArweave(vault.arweaveTxId);
  const wrapKey = deriveWrapKey(userId, vault.salt);
  const agentKey = decryptAgentKey(bundle.agent_key_enc, wrapKey);

  await auditLog("vault_exported", agentId, userId, "export", `uid:${userId}`);

  return {
    arweaveTxId: vault.arweaveTxId,
    agentKey: agentKey.toString("hex"),
    instructions: `Your agent lives on Arweave permanently.\n\nTo run on any OpenClaw instance:\n  openclaw load arweave://${vault.arweaveTxId} --key ${agentKey.toString("hex")}\n\nKeep your agent key safe — it cannot be recovered without platform access.`,
  };
}

/**
 * Check if a user tier is eligible for Arweave vault.
 * Free users get Firebase-only persistence. Paid users get Arweave.
 */
export function tierHasVault(plan: string): boolean {
  return ["starter","agent","pro","network","scale","permanent","gifted"].includes(plan);
}

/**
 * Mint genesis vault on upgrade — called when a free user upgrades to any paid plan.
 * Pulls existing agent config from Firestore and mints it to Arweave for the first time.
 */
export async function mintOnUpgrade(
  agentId: string,
  userId: string,
  files: AgentFiles,
): Promise<{ txId: string }> {
  // Check if vault already exists (idempotent — safe to call multiple times)
  const db = getAdminDb();
  const existing = await db.collection("agent_vaults").doc(agentId).get();
  if (existing.exists) {
    console.log(`[agent-vault] Vault already exists for ${agentId}, skipping genesis mint`);
    return { txId: existing.data()!.arweaveTxId };
  }

  const result = await createAgentVault(agentId, userId, files);
  await auditLog("vault_genesis_upgrade", agentId, userId, "plan_upgrade", `uid:${userId}`);
  console.log(`[agent-vault] Genesis mint on upgrade for ${agentId} → TX: ${result.txId}`);
  return result;
}

/**
 * Rotate agent key — generates a new random key, re-encrypts everything.
 * Old TX remains on Arweave (immutable), Firestore pointer updates to new TX.
 */
export async function rotateAgentKey(
  agentId: string,
  userId: string,
): Promise<{ txId: string }> {
  // Restore current files
  const files = await restoreAgentVault(agentId, userId, "export");

  // Delete old vault record and create fresh with new key
  const db = getAdminDb();
  await db.collection("agent_vaults").doc(agentId).delete();

  const result = await createAgentVault(agentId, userId, files);
  await auditLog("vault_key_rotated", agentId, userId, "key_rotation", `uid:${userId}`);
  console.log(`[agent-vault] Key rotated for ${agentId} → new TX: ${result.txId}`);
  return result;
}
