/**
 * channel-crypto.ts
 *
 * AES-256-GCM encryption for channel credentials stored in Firestore.
 * Credentials are encrypted at rest — Firestore never holds plaintext tokens.
 *
 * Key derivation: HMAC-SHA256(PLATFORM_SECRET, "channel:" + userId)
 * This is deterministic — we can always re-derive the key from the secret.
 * Rotating PLATFORM_SECRET requires a migration script (don't rotate casually).
 *
 * Format on disk: base64(iv[12] || authTag[16] || ciphertext)
 */

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "crypto";

function deriveKey(userId: string): Buffer {
  const secret = process.env.PLATFORM_SECRET;
  if (!secret) throw new Error("PLATFORM_SECRET not configured");
  return Buffer.from(
    createHmac("sha256", secret).update(`channel:${userId}`).digest()
  );
}

export function encryptCredentials(
  data: Record<string, string>,
  userId: string
): string {
  const key  = deriveKey(userId);
  const iv   = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // iv || tag || ciphertext → base64
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptCredentials(
  encoded: string,
  userId: string
): Record<string, string> {
  const key = deriveKey(userId);
  const buf = Buffer.from(encoded, "base64");

  const iv        = buf.subarray(0, 12);
  const tag       = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted =
    decipher.update(encrypted).toString("utf8") +
    decipher.final("utf8");

  return JSON.parse(decrypted) as Record<string, string>;
}
