/**
 * OpenRouter sub-key management for Launchpad users.
 *
 * Problem this solves: a single pooled OpenRouter key shared across all
 * Launchpad users means one runaway user can drain the whole pool. With
 * sub-keys, each user gets their own key with a hard USD limit. Once spent,
 * OpenRouter rejects requests automatically — the worst-case loss per user
 * is bounded by their plan's pooledCreditUsd ($3-$6).
 *
 * Architecture:
 *   - On checkout webhook (setLaunchpadPlan), we create an OpenRouter sub-key
 *     with limit = plan.pooledCreditUsd and limit_reset = "monthly".
 *   - OpenRouter handles the monthly reset automatically (midnight UTC on
 *     the 1st), so we don't need to wire it into our renewal handler.
 *   - We encrypt the key string with PLATFORM_SECRET before storing in
 *     Firestore (the plaintext is only returned once at creation time).
 *   - On provision, we decrypt and inject as LAUNCHPAD_LLM_KEY.
 *   - On cancellation (clearLaunchpadPlan), we DELETE the OpenRouter key.
 *
 * Requires env var: OPENROUTER_MANAGEMENT_KEY
 *   Create at: https://openrouter.ai/settings/management-keys
 *   Management keys CANNOT call /v1/chat/completions — they're admin-only.
 */
import crypto from "node:crypto";

const OR_BASE = "https://openrouter.ai/api/v1";
const ENC_ALGO = "aes-256-gcm";

// ── encryption (AES-256-GCM with PLATFORM_SECRET-derived key) ────────────────

function getEncKey(): Buffer {
  const secret = process.env.PLATFORM_SECRET;
  if (!secret) {
    throw new Error(
      "PLATFORM_SECRET not set — required to encrypt OpenRouter sub-keys"
    );
  }
  // SHA-256 of the secret gives us a stable 32-byte key. Rotating
  // PLATFORM_SECRET invalidates all stored encrypted keys, so don't.
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, getEncKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: <iv hex>:<tag hex>:<ciphertext hex>
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(ctHex, "hex");
  const decipher = crypto.createDecipheriv(ENC_ALGO, getEncKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ── OpenRouter API client ────────────────────────────────────────────────────

interface OrApiKeyData {
  hash: string;
  label: string;
  name: string;
  disabled: boolean;
  limit: number;
  limit_remaining: number;
  limit_reset: "daily" | "weekly" | "monthly" | null;
  usage: number;
  include_byok_in_limit: boolean;
  created_at: string;
  updated_at: string;
}

async function orFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const provKey = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!provKey) {
    throw new Error(
      "OPENROUTER_MANAGEMENT_KEY not set — create one at openrouter.ai/settings/management-keys"
    );
  }
  const res = await fetch(`${OR_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${provKey}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `OpenRouter ${init?.method || "GET"} ${path} -> ${res.status}: ${body.slice(0, 300)}`
    );
  }
  return res.json() as Promise<T>;
}

// ── guardrail (model allowlist) ──────────────────────────────────────────────
//
// Sub-keys have a hard USD cap, but without a model allowlist a user can burn
// the whole month's credit on frontier-priced models in minutes. A guardrail
// (enforced server-side by OpenRouter) restricts metered keys to the platform
// models; anything else requires OAuth sign-in or BYOK.

export const GUARDRAIL_NAME = "launchpad-metered";
export const GUARDRAIL_ALLOWED_MODELS = [
  "x-ai/grok-4.3",
  "x-ai/grok-4.20-multi-agent",
];

let cachedGuardrailId: string | null = null;

interface OrGuardrail {
  id: string;
  name: string;
  allowed_models: string[] | null;
}

/**
 * Find-or-create the launchpad guardrail. Returns its id (cached per
 * lambda instance).
 */
export async function ensureGuardrail(): Promise<string> {
  if (cachedGuardrailId) return cachedGuardrailId;
  const list = await orFetch<{ data: OrGuardrail[] }>("/guardrails");
  const existing = list.data.find((g) => g.name === GUARDRAIL_NAME);
  if (existing) {
    cachedGuardrailId = existing.id;
    return existing.id;
  }
  const created = await orFetch<{ data: OrGuardrail }>("/guardrails", {
    method: "POST",
    body: JSON.stringify({
      name: GUARDRAIL_NAME,
      description:
        "Launchpad metered sub-keys: platform models only. Other models require BYOK/OAuth.",
      allowed_models: GUARDRAIL_ALLOWED_MODELS,
    }),
  });
  cachedGuardrailId = created.data.id;
  return created.data.id;
}

/** Assign a key (by hash) to the launchpad guardrail. */
export async function assignKeyToGuardrail(keyHash: string): Promise<void> {
  const id = await ensureGuardrail();
  await orFetch(`/guardrails/${id}/assignments/keys`, {
    method: "POST",
    body: JSON.stringify({ key_hashes: [keyHash] }),
  });
}

// ── public types ─────────────────────────────────────────────────────────────

export interface LaunchpadUserKey {
  /** OpenRouter key hash (used for all subsequent API calls). Public. */
  hash: string;
  /** AES-256-GCM-encrypted key string. Only the plaintext can be injected
   *  into a Fly machine; never log this or send to the client. */
  encryptedKey: string;
  /** Plan's pooledCreditUsd at creation time. May drift from current plan
   *  if user upgrades — call resetUserKeyLimit() on plan change. */
  limitUsd: number;
  /** ISO timestamp the key was minted. */
  createdAt: string;
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Create a new OpenRouter sub-key with a hard monthly limit. Idempotent
 * at the caller level — caller is responsible for not creating duplicates.
 *
 * Returns the encrypted key + hash. The plaintext key is NOT returned;
 * callers should immediately store the result and use decryptUserKey() at
 * injection time.
 */
export async function createUserKey(
  userId: string,
  limitUsd: number
): Promise<LaunchpadUserKey> {
  const created = await orFetch<{ key: string; data: OrApiKeyData }>("/keys", {
    method: "POST",
    body: JSON.stringify({
      name: `launchpad-${userId}`,
      // Include user id in the label so we can correlate from OpenRouter's
      // dashboard if we ever need to audit usage by user.
      label: `lp:${userId.slice(0, 16)}`,
      limit: limitUsd,
      limit_reset: "monthly",
      // BYOK usage should NOT count against the launchpad limit — if a
      // user adds their own provider key later, we don't want their own
      // costs eating into our pooled credit allowance.
      include_byok_in_limit: false,
    }),
  });

  // Attach the model-allowlist guardrail. Best-effort with one retry: the
  // USD cap still bounds an unguarded key, and failing checkout over this
  // would be worse. Failures are logged for the backfill script to catch.
  try {
    await assignKeyToGuardrail(created.data.hash);
  } catch (err) {
    console.error(
      `[launchpad/openrouter] guardrail assignment failed for ${userId}, retrying:`,
      err
    );
    try {
      await assignKeyToGuardrail(created.data.hash);
    } catch (err2) {
      console.error(
        `[launchpad/openrouter] guardrail assignment failed twice for ${userId} (hash ${created.data.hash}) — run scripts/assign-openrouter-guardrail.mjs to backfill:`,
        err2
      );
    }
  }

  return {
    hash: created.data.hash,
    encryptedKey: encrypt(created.key),
    limitUsd,
    createdAt: created.data.created_at,
  };
}

/**
 * Decrypt the user's OpenRouter key for injection into a Fly machine env.
 * Throws if PLATFORM_SECRET is wrong or the payload is corrupt.
 */
export function decryptUserKey(stored: LaunchpadUserKey): string {
  return decrypt(stored.encryptedKey);
}

/**
 * Reset the limit on an existing key (e.g. when the user upgrades plans).
 * OpenRouter handles monthly auto-resets, so this is only needed for
 * plan changes, not for cycle renewal.
 */
export async function resetUserKeyLimit(
  hash: string,
  newLimitUsd: number
): Promise<void> {
  await orFetch(`/keys/${hash}`, {
    method: "PATCH",
    body: JSON.stringify({ limit: newLimitUsd }),
  });
}

/**
 * Read current usage. Returns null if the key was deleted.
 * Useful for the dashboard to display "X / $Y used this cycle".
 */
export async function getUserKeyStatus(
  hash: string
): Promise<OrApiKeyData | null> {
  try {
    const res = await orFetch<{ data: OrApiKeyData }>(`/keys/${hash}`);
    return res.data;
  } catch (err) {
    if (err instanceof Error && err.message.includes("-> 404")) return null;
    throw err;
  }
}

/**
 * Disable a key without deleting it (e.g. on payment failure). The key
 * can be re-enabled by patching `disabled: false`.
 */
export async function disableUserKey(hash: string): Promise<void> {
  await orFetch(`/keys/${hash}`, {
    method: "PATCH",
    body: JSON.stringify({ disabled: true }),
  });
}

/**
 * Permanently delete the key. Call on subscription cancellation so we
 * don't accumulate orphan keys on OpenRouter. Safe to call on an
 * already-deleted key (404 is swallowed).
 */
export async function deleteUserKey(hash: string): Promise<void> {
  try {
    await orFetch(`/keys/${hash}`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof Error && err.message.includes("-> 404")) return;
    throw err;
  }
}
