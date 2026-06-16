/**
 * api-key.ts — Hashing utilities for ns_ agent API keys
 *
 * Keys are generated as `ns_<64-hex>` (32 random bytes).
 * Only the SHA-256 hash is stored in Firestore — the raw key is
 * delivered exactly once via the device auth poll response and
 * never retained server-side after that.
 *
 * All lookup points hash the key before querying:
 *   db.collection("agents").where("apiKeyHash", "==", hashApiKey(rawKey))
 */

import { createHash } from "crypto";

/**
 * Hash a raw ns_ API key for Firestore storage / lookup.
 * Returns lowercase hex SHA-256 of the full key string.
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}
