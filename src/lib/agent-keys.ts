/**
 * Agent API Key Management
 * 
 * Handles generation and validation of agent API keys.
 * Format: ns_<32 bytes random hex> (ns = "neural salvage")
 */

import crypto from "crypto";

/**
 * Generate a new agent API key
 * Format: ns_<64 hex characters>
 */
export function generateAgentApiKey(): string {
  const randomBytes = crypto.randomBytes(32);
  return `ns_${randomBytes.toString("hex")}`;
}

/**
 * Validate API key format
 */
export function isValidApiKey(key: string): boolean {
  return /^ns_[a-f0-9]{64}$/.test(key);
}
