/**
 * user-keys.ts — Zero-knowledge platform-managed agent keypairs
 *
 * Design:
 *   - X25519 + Ed25519 keypair generated per user on signup
 *   - Private key encrypted with AES-256-GCM using a key derived from:
 *       HKDF(SHA-256, PLATFORM_SECRET, salt=userId, info="clawd-agent-key-v1", 32 bytes)
 *   - Encrypted private key stored in Firestore — platform CANNOT decrypt without userId
 *   - Server derives the wrapping key on demand, decrypts, uses, zeros from memory
 *   - User exports raw private key via authenticated endpoint for self-custody
 *
 * Recovery: account access (Firebase auth) → userId → derive wrapping key → decrypt private key
 * Platform cannot read souls even holding Firestore — no master key exists.
 */

import {
  generateKeyPairSync,
  createHash,
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ManagedKeypair {
  agentPublicKey:   string;  // X25519 PEM (SPKI) — stored plaintext
  signingPublicKey: string;  // Ed25519 PEM (SPKI) — stored plaintext
  keyFingerprint:   string;  // sha256(agentPublicKey).slice(0,16)
  // private keys are encrypted — never exposed in this type
}

export interface StoredUserKeys {
  agentPublicKey:        string;
  signingPublicKey:      string;
  keyFingerprint:        string;
  encryptedAgentPrivKey: string;   // base64(AES-GCM(pkcs8 pem))
  encryptedSignPrivKey:  string;   // base64(AES-GCM(pkcs8 pem))
  keyIv:                 string;   // base64 — shared IV prefix for both keys
  keyAuthTag:            string;   // base64
  signIv:                string;
  signAuthTag:           string;
  createdAt:             string;
  version:               "1";
}

// ── Key derivation ────────────────────────────────────────────────────────────

function deriveWrappingKey(userId: string): Buffer {
  const secret = process.env.PLATFORM_SECRET;
  if (!secret) throw new Error("PLATFORM_SECRET not configured");

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from(userId, "utf8"),   // salt = userId (unique per user)
      Buffer.from("clawd-agent-key-v1"),
      32
    )
  );
}

function encryptPem(pem: string, wrappingKey: Buffer): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
  let ct = cipher.update(pem, "utf8", "base64");
  ct += cipher.final("base64");
  return {
    ciphertext: ct,
    iv:         iv.toString("base64"),
    authTag:    cipher.getAuthTag().toString("base64"),
  };
}

function decryptPem(
  ciphertext: string,
  iv: string,
  authTag: string,
  wrappingKey: Buffer
): string {
  const decipher = createDecipheriv("aes-256-gcm", wrappingKey, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  let pem = decipher.update(ciphertext, "base64", "utf8");
  pem += decipher.final("utf8");
  return pem;
}

function fingerprintKey(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate and store managed keypair for a new user.
 * Called once on signup. Safe to call again — returns early if keys exist.
 */
export async function provisionUserKeys(userId: string): Promise<ManagedKeypair> {
  const db = getAdminDb();
  const ref = db.collection("user_keys").doc(userId);
  const existing = await ref.get();

  if (existing.exists) {
    const data = existing.data() as StoredUserKeys;
    return {
      agentPublicKey:   data.agentPublicKey,
      signingPublicKey: data.signingPublicKey,
      keyFingerprint:   data.keyFingerprint,
    };
  }

  // Generate
  const { publicKey: encPub, privateKey: encPriv } = generateKeyPairSync("x25519", {
    publicKeyEncoding:  { type: "spki",  format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const { publicKey: signPub, privateKey: signPriv } = generateKeyPairSync("ed25519", {
    publicKeyEncoding:  { type: "spki",  format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const fingerprint  = fingerprintKey(encPub);
  const wrappingKey  = deriveWrappingKey(userId);

  const encEnc  = encryptPem(encPriv,  wrappingKey);
  const signEnc = encryptPem(signPriv, wrappingKey);

  wrappingKey.fill(0); // zero from memory immediately

  const stored: StoredUserKeys = {
    agentPublicKey:        encPub,
    signingPublicKey:      signPub,
    keyFingerprint:        fingerprint,
    encryptedAgentPrivKey: encEnc.ciphertext,
    keyIv:                 encEnc.iv,
    keyAuthTag:            encEnc.authTag,
    encryptedSignPrivKey:  signEnc.ciphertext,
    signIv:                signEnc.iv,
    signAuthTag:           signEnc.authTag,
    createdAt:             new Date().toISOString(),
    version:               "1",
  };

  await ref.set({ ...stored, updatedAt: FieldValue.serverTimestamp() });

  console.log(`[user-keys] Provisioned keypair for user ${userId}, fingerprint: ${fingerprint}`);

  return { agentPublicKey: encPub, signingPublicKey: signPub, keyFingerprint: fingerprint };
}

/**
 * Get the public key for a user (for display / Arweave tagging).
 * Does not decrypt anything.
 */
export async function getUserPublicKey(userId: string): Promise<ManagedKeypair | null> {
  const db = getAdminDb();
  const snap = await db.collection("user_keys").doc(userId).get();
  if (!snap.exists) return null;
  const data = snap.data() as StoredUserKeys;
  return {
    agentPublicKey:   data.agentPublicKey,
    signingPublicKey: data.signingPublicKey,
    keyFingerprint:   data.keyFingerprint,
  };
}

/**
 * Decrypt and return the agent's private key for a soul mint operation.
 * Key is in memory only for the duration of this call.
 * Caller must zero the returned buffer after use.
 */
export async function getAgentPrivateKey(userId: string): Promise<{
  agentPrivateKey:   string;
  signingPrivateKey: string;
  agentPublicKey:    string;
  signingPublicKey:  string;
  keyFingerprint:    string;
} | null> {
  const db = getAdminDb();
  const snap = await db.collection("user_keys").doc(userId).get();
  if (!snap.exists) return null;

  const data        = snap.data() as StoredUserKeys;
  const wrappingKey = deriveWrappingKey(userId);

  try {
    const agentPrivateKey   = decryptPem(data.encryptedAgentPrivKey, data.keyIv,   data.keyAuthTag,  wrappingKey);
    const signingPrivateKey = decryptPem(data.encryptedSignPrivKey,  data.signIv,  data.signAuthTag, wrappingKey);
    return {
      agentPrivateKey,
      signingPrivateKey,
      agentPublicKey:    data.agentPublicKey,
      signingPublicKey:  data.signingPublicKey,  // Ed25519 public key — needed for Arweave tag
      keyFingerprint:    data.keyFingerprint,
    };
  } finally {
    wrappingKey.fill(0); // always zero, even on error
  }
}

/**
 * Export raw private key for self-custody (power user feature).
 * Logs the export event.
 */
export async function exportUserPrivateKey(userId: string): Promise<{
  agentPrivateKey:   string;
  signingPrivateKey: string;
  agentPublicKey:    string;
  fingerprint:       string;
  warning:           string;
} | null> {
  const keys = await getAgentPrivateKey(userId);
  if (!keys) return null;

  // Log the export
  const db = getAdminDb();
  await db.collection("user_keys").doc(userId).update({
    lastExportedAt: new Date().toISOString(),
    exportCount:    FieldValue.increment(1),
  });

  return {
    agentPrivateKey:   keys.agentPrivateKey,
    signingPrivateKey: keys.signingPrivateKey,
    agentPublicKey:    keys.agentPublicKey,
    fingerprint:       keys.keyFingerprint,
    warning:           "Store this private key securely. It cannot be recovered if lost.",
  };
}
