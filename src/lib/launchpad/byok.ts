/**
 * Launchpad BYOK — per-user encrypted LLM provider key storage.
 *
 * Reuses the platform's HKDF + AES-256-GCM pattern from user-keys.ts.
 * The wrapping key is derived from PLATFORM_SECRET + userId, so the
 * platform operator cannot decrypt keys at rest without holding both.
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";

export type ByokProvider = "openrouter" | "anthropic" | "openai" | "xai";

export interface StoredByok {
  provider: ByokProvider;
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
  createdAt: string;
  version: "1";
}

function deriveWrappingKey(userId: string): Buffer {
  const secret = process.env.PLATFORM_SECRET;
  if (!secret) throw new Error("PLATFORM_SECRET not configured");
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from(userId, "utf8"),
      Buffer.from("launchpad-byok-v1"),
      32
    )
  );
}

function encrypt(plaintext: string, wrappingKey: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
  let ct = cipher.update(plaintext, "utf8", "base64");
  ct += cipher.final("base64");
  return {
    ciphertext: ct,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(blob: StoredByok, wrappingKey: Buffer): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    wrappingKey,
    Buffer.from(blob.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
  let pt = decipher.update(blob.ciphertext, "base64", "utf8");
  pt += decipher.final("utf8");
  return pt;
}

/** Save (or overwrite) the user's BYOK key. */
export async function saveByok(
  userId: string,
  provider: ByokProvider,
  apiKey: string
): Promise<void> {
  if (!apiKey || apiKey.length < 8) {
    throw new Error("API key looks invalid");
  }
  const wrappingKey = deriveWrappingKey(userId);
  try {
    const { ciphertext, iv, authTag } = encrypt(apiKey, wrappingKey);
    const stored: StoredByok = {
      provider,
      ciphertext,
      iv,
      authTag,
      createdAt: new Date().toISOString(),
      version: "1",
    };
    await getAdminDb()
      .collection("launchpad_users")
      .doc(userId)
      .set({ byok: stored }, { merge: true });
  } finally {
    wrappingKey.fill(0);
  }
}

/** Clear the user's BYOK so the next launch falls back to pooled key. */
export async function clearByok(userId: string): Promise<void> {
  await getAdminDb()
    .collection("launchpad_users")
    .doc(userId)
    .set({ byok: null }, { merge: true });
}

/**
 * Return the user's BYOK in plaintext for injection into a new sandbox.
 * Should only be called inside provision/restart paths. Caller must not log.
 */
export async function loadByok(
  userId: string
): Promise<{ provider: ByokProvider; apiKey: string } | null> {
  const snap = await getAdminDb()
    .collection("launchpad_users")
    .doc(userId)
    .get();
  const blob = snap.data()?.byok as StoredByok | null | undefined;
  if (!blob) return null;
  const wrappingKey = deriveWrappingKey(userId);
  try {
    const apiKey = decrypt(blob, wrappingKey);
    return { provider: blob.provider, apiKey };
  } finally {
    wrappingKey.fill(0);
  }
}

/** Public view: provider + masked tail. Safe to return to the client. */
export async function describeByok(userId: string): Promise<{
  provider: ByokProvider;
  masked: string;
  createdAt: string;
} | null> {
  const snap = await getAdminDb()
    .collection("launchpad_users")
    .doc(userId)
    .get();
  const blob = snap.data()?.byok as StoredByok | null | undefined;
  if (!blob) return null;
  const wrappingKey = deriveWrappingKey(userId);
  try {
    const apiKey = decrypt(blob, wrappingKey);
    const tail = apiKey.slice(-4);
    return {
      provider: blob.provider,
      masked: `••••••••${tail}`,
      createdAt: blob.createdAt,
    };
  } finally {
    wrappingKey.fill(0);
  }
}
