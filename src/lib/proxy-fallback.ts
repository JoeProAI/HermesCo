/**
 * Same-vendor fallback map for /api/proxy retries.
 *
 * When upstream returns 5xx (or network throws), the proxy may retry the
 * request against the next model in this chain. Cross-vendor fallback is
 * intentionally OUT OF SCOPE — different APIs use different request/response
 * formats (Anthropic Messages vs OpenAI Chat Completions) and translating
 * requires real work. Keep each chain within the same baseUrl + API key +
 * wire format.
 *
 * Each key is a canonical model string in the form "<vendor>/<model>" (the
 * form the proxies use AFTER stripping the clawd-* prefix). An entry with an
 * empty array means "no retry, pass the error through".
 */
export const SAME_VENDOR_FALLBACK: Record<string, string[]> = {
  // xAI — Grok family
  "xai/grok-4-1-fast-reasoning":      ["xai/grok-4-1-fast-non-reasoning"],
  "xai/grok-4-1-fast-non-reasoning":  [],
  "xai/grok-4-0709":                  ["xai/grok-4-1-fast-reasoning", "xai/grok-4-1-fast-non-reasoning"],
  "xai/grok-4":                       ["xai/grok-4-1-fast-reasoning", "xai/grok-4-1-fast-non-reasoning"],

  // OpenAI
  "openai/gpt-5.2":                   ["openai/gpt-4.1", "openai/gpt-4.1-mini"],
  "openai/gpt-4.1":                   ["openai/gpt-4.1-mini"],
  "openai/gpt-4.1-mini":              [],

  // Anthropic — ordered most-capable → cheapest within vendor.
  // Opus is the heavy gun; degrade to Sonnet variants on outage.
  "anthropic/claude-opus-4-6":        ["anthropic/claude-sonnet-4-6", "anthropic/claude-sonnet-4-5"],
  "anthropic/claude-sonnet-4-6":      ["anthropic/claude-sonnet-4-5"],
  "anthropic/claude-sonnet-4-5":      [],
};

/**
 * Returns whether an upstream status should trigger a fallback retry.
 *
 * 5xx = upstream service is broken, try another model.
 * 429 = we're being rate-limited. Retrying the SAME model won't help, but a
 *       different model in the same family may have separate quota on some
 *       vendors, so we include it.
 * 4xx (other) = our request is malformed, retry won't fix it, pass through.
 */
export function isRetriableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}
