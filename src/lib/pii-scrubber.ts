/**
 * pii-scrubber.ts — Strip personally identifiable information from text
 *
 * Used to sanitize soul contents before minting to Arweave.
 */

const PII_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: 'EMAIL' },

  // Phone numbers (various formats)
  { pattern: /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, label: 'PHONE' },
  { pattern: /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g, label: 'PHONE' },

  // SSN (US Social Security Number)
  { pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, label: 'SSN' },

  // Credit card numbers (various formats, 13-19 digits with optional separators)
  { pattern: /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b/g, label: 'CREDIT_CARD' },

  // IPv4 addresses (but not version numbers like 1.0.0)
  { pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, label: 'IP' },

  // IPv6 addresses
  { pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, label: 'IP' },
  { pattern: /\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b/g, label: 'IP' },
];

/**
 * Scrub PII from text, replacing matches with [REDACTED].
 */
export function scrubPII(text: string): string {
  let result = text;

  for (const { pattern } of PII_PATTERNS) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }

  return result;
}
