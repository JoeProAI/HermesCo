import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "crypto";
import { getAdminDb } from "@/lib/firebase-admin";

export type AgentCredentials = Record<string, string>;

interface StoredCredentialsDoc {
  credentialsEnc: string;
  schemaVersion: number;
  updatedAt: string;
}

const DOC_SCHEMA_VERSION = 1;
const MAX_KEY_COUNT = 64;
const MAX_KEY_LENGTH = 128;
const MAX_VALUE_LENGTH = 4096;

function deriveKey(userId: string): Buffer {
  const secret = process.env.PLATFORM_SECRET;
  if (!secret) {
    throw new Error("PLATFORM_SECRET not configured");
  }
  return Buffer.from(
    createHmac("sha256", secret).update(`agent-credentials:${userId}`).digest()
  );
}

function encryptPayload(data: AgentCredentials, userId: string): string {
  const key = deriveKey(userId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptPayload(encoded: string, userId: string): AgentCredentials {
  const key = deriveKey(userId);
  const buf = Buffer.from(encoded, "base64");

  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decoded = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");

  const parsed = JSON.parse(decoded) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid credentials payload");
  }

  const normalized: AgentCredentials = {};
  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== "string") continue;
    const keyName = rawKey.trim();
    if (!keyName) continue;
    normalized[keyName] = rawValue;
  }
  return normalized;
}

export function normalizeAgentCredentials(input: unknown): AgentCredentials {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("credentials must be an object");
  }

  const credentials: AgentCredentials = {};

  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (typeof rawValue !== "string") {
      throw new Error(`credential '${rawKey}' must be a string`);
    }

    const key = rawKey.trim();
    if (!key) continue;

    if (key.length > MAX_KEY_LENGTH) {
      throw new Error(`credential key '${key}' is too long`);
    }

    if (rawValue.length > MAX_VALUE_LENGTH) {
      throw new Error(`credential '${key}' is too long`);
    }

    credentials[key] = rawValue;

    if (Object.keys(credentials).length > MAX_KEY_COUNT) {
      throw new Error(`too many credentials (max ${MAX_KEY_COUNT})`);
    }
  }

  return credentials;
}

export async function getAgentCredentials(userId: string): Promise<AgentCredentials> {
  if (!process.env.PLATFORM_SECRET) return {};

  const db = getAdminDb();
  const doc = await db.collection("agent_credentials").doc(userId).get();

  if (!doc.exists) return {};

  const data = doc.data() as Partial<StoredCredentialsDoc> | undefined;
  if (!data?.credentialsEnc) return {};

  try {
    return decryptPayload(data.credentialsEnc, userId);
  } catch (err) {
    console.error("[agent-credentials] Failed to decrypt credentials", err);
    return {};
  }
}

export async function setAgentCredentials(
  userId: string,
  credentials: AgentCredentials,
): Promise<void> {
  if (!process.env.PLATFORM_SECRET) {
    throw new Error("PLATFORM_SECRET not configured");
  }

  const db = getAdminDb();

  if (Object.keys(credentials).length === 0) {
    await db.collection("agent_credentials").doc(userId).delete();
    return;
  }

  const credentialsEnc = encryptPayload(credentials, userId);
  await db.collection("agent_credentials").doc(userId).set({
    credentialsEnc,
    schemaVersion: DOC_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  } satisfies StoredCredentialsDoc);
}
