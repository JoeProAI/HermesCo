/**
 * pricing.ts — Pass-through API cost calculation with platform markup
 *
 * Every API call has a real provider cost. We charge the user that cost + markup.
 * The house always wins.
 *
 * Costs stored in microdollars (1/1,000,000 USD) internally for precision.
 * Displayed as dollars to users.
 */

// ── Platform markup ──────────────────────────────────────────────────────────
// 40% on top of raw provider cost. Covers infrastructure, margin, profit.
export const PLATFORM_MARKUP = 0.40;

// ── Provider costs per 1M tokens (USD) ───────────────────────────────────────
// Source: provider pricing pages as of March 2026
// Update these when providers change pricing.
export const PROVIDER_COSTS: Record<string, { input: number; output: number; cached?: number }> = {
  // Anthropic
  "anthropic/claude-opus-4-6":           { input: 15.00, output: 75.00, cached: 1.50 },
  "anthropic/claude-sonnet-4-5":         { input:  3.00, output: 15.00, cached: 0.30 },
  "anthropic/claude-sonnet-4-6":         { input:  3.00, output: 15.00, cached: 0.30 },
  "anthropic/claude-haiku-4-5-20251001": { input:  0.80, output:  4.00, cached: 0.08 },

  // OpenAI
  "openai/gpt-4.1":                      { input:  2.00, output:  8.00, cached: 0.50 },
  "openai/gpt-4.1-mini":                 { input:  0.40, output:  1.60, cached: 0.10 },
  "openai/gpt-4.1-nano":                 { input:  0.10, output:  0.40, cached: 0.025 },
  "openai/gpt-5.2":                      { input:  5.00, output: 20.00 },
  "openai/gpt-5-mini":                   { input:  1.00, output:  4.00 },

  // xAI
  "xai/grok-4-1-fast-reasoning":         { input:  5.00, output: 25.00 },
  "xai/grok-4-1-fast-non-reasoning":     { input:  0.20, output:  0.50 },
  "xai/grok-4":                          { input:  6.00, output: 18.00 },
  "xai/grok-4-0709":                     { input:  6.00, output: 18.00 },

  // Google
  "google/gemini-2.5-flash":             { input:  0.15, output:  0.60 },
  "google/gemini-2.5-pro":               { input:  1.25, output: 10.00 },
  "google/gemini-3-flash-preview":       { input:  0.15, output:  0.60 },
  "google/gemini-3.1-pro-preview":       { input:  1.25, output: 10.00 },

  // MiniMax
  "minimax/minimax-m2.5":                { input:  0.15, output:  1.20 },
  "openrouter/minimax/minimax-m2.5":     { input:  0.15, output:  1.20 },
};

// ── Cost calculation ─────────────────────────────────────────────────────────

export interface ApiCallCost {
  /** Raw provider cost in USD */
  providerCost: number;
  /** Platform markup amount in USD */
  markupAmount: number;
  /** Total charged to user in USD (provider + markup) */
  totalCost: number;
  /** Cost breakdown */
  breakdown: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    inputCostUsd: number;
    outputCostUsd: number;
    cachedCostUsd: number;
  };
}

/**
 * Calculate the real cost of an API call + platform markup.
 * Returns costs in USD (floating point, precision to 6 decimal places).
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0
): ApiCallCost {
  const costs = PROVIDER_COSTS[model] || { input: 3.00, output: 15.00 }; // default to Sonnet-tier

  const inputCostUsd = ((inputTokens - cachedTokens) / 1_000_000) * costs.input;
  const outputCostUsd = (outputTokens / 1_000_000) * costs.output;
  const cachedCostUsd = costs.cached
    ? (cachedTokens / 1_000_000) * costs.cached
    : (cachedTokens / 1_000_000) * costs.input * 0.1; // default: cached = 10% of input

  const providerCost = inputCostUsd + outputCostUsd + cachedCostUsd;
  const markupAmount = providerCost * PLATFORM_MARKUP;
  const totalCost = providerCost + markupAmount;

  return {
    providerCost: round6(providerCost),
    markupAmount: round6(markupAmount),
    totalCost: round6(totalCost),
    breakdown: {
      model,
      inputTokens,
      outputTokens,
      cachedTokens,
      inputCostUsd: round6(inputCostUsd),
      outputCostUsd: round6(outputCostUsd),
      cachedCostUsd: round6(cachedCostUsd),
    },
  };
}

/**
 * Estimate cost for a typical message (for display before sending).
 * Uses conservative averages: 2K input, 1K output.
 */
export function estimateTypicalCost(model: string): {
  perMessage: number;
  description: string;
} {
  const cost = calculateCost(model, 2000, 1000);
  const friendlyModel = model.split("/").pop() || model;
  return {
    perMessage: cost.totalCost,
    description: `~$${cost.totalCost.toFixed(4)}/msg (${friendlyModel})`,
  };
}

/**
 * Get all models with their per-message cost estimates, sorted cheapest first.
 */
export function getModelPricing(): Array<{
  model: string;
  perMessageEstimate: number;
  inputPer1M: number;
  outputPer1M: number;
  tier: "budget" | "standard" | "premium";
}> {
  return Object.entries(PROVIDER_COSTS)
    .map(([model, costs]) => {
      const est = calculateCost(model, 2000, 1000);
      const tier: "budget" | "standard" | "premium" =
        est.totalCost < 0.005 ? "budget" :
        est.totalCost < 0.05 ? "standard" : "premium";
      return {
        model,
        perMessageEstimate: est.totalCost,
        inputPer1M: round6(costs.input * (1 + PLATFORM_MARKUP)),
        outputPer1M: round6(costs.output * (1 + PLATFORM_MARKUP)),
        tier,
      };
    })
    .sort((a, b) => a.perMessageEstimate - b.perMessageEstimate);
}

// ── Top-up tiers ─────────────────────────────────────────────────────────────
export const TOPUP_AMOUNTS = [
  { amount: 5,   label: "$5",   bonus: 0 },
  { amount: 10,  label: "$10",  bonus: 0 },
  { amount: 25,  label: "$25",  bonus: 0.05 },  // 5% bonus
  { amount: 50,  label: "$50",  bonus: 0.10 },  // 10% bonus
  { amount: 100, label: "$100", bonus: 0.15 },  // 15% bonus
] as const;

/**
 * Calculate effective balance from a top-up (including any bonus).
 */
export function getTopupValue(amount: number): { paid: number; bonus: number; total: number } {
  const tier = TOPUP_AMOUNTS.find(t => t.amount === amount);
  const bonusRate = tier?.bonus ?? 0;
  const bonus = round6(amount * bonusRate);
  return { paid: amount, bonus, total: amount + bonus };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
