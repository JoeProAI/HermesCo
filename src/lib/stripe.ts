import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2026-01-28.clover" as Stripe.LatestApiVersion })
  : null;

export function getStripe() {
  if (!stripe) throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  return stripe;
}

// ── Billing model ────────────────────────────────────────────────────────────
//
// Pass-through pricing with 40% platform markup.
// Every API call is metered at real provider cost + markup.
// Subscriptions include a dollar amount of API usage.
// Users can top up for more. The house always wins.
//
// See pricing.ts for cost tables and calculation.
// See wallet.ts for balance management.
//
// Legacy credit exports kept for backward compatibility during migration.
export const MODEL_CREDIT_COST: Record<string, number> = {
  "minimax/minimax-m2.5":                1,
  "openrouter/minimax/minimax-m2.5":     1,
  "xai/grok-4-1-fast-reasoning":         1,
  "anthropic/claude-sonnet-4-5":         3,
  "anthropic/claude-sonnet-4-6":         3,
  "openai/gpt-4.1":                      3,
  "openai/gpt-4.1-mini":                 1,
  "google/gemini-2.5-flash":             2,
  "openrouter/google/gemini-2.5-flash":  2,
  "xai/grok-4":                          5,
  "anthropic/claude-opus-4-6":           10,
};

/** @deprecated Use calculateCost() from pricing.ts instead */
export function getCreditCost(model: string): number {
  return MODEL_CREDIT_COST[model] ?? 3;
}

// ── Plan definitions ─────────────────────────────────────────────────────────
//
// creditsPerMonth: monthly pool (not per-day). Resets on billing date.
// "gifted" = manually-granted Starter-level access, no Stripe billing.
//   Used for early users, partners, coupon holders.
//
// Plan IDs.
//   New (2026-Q2): hermes, openclaw, both        — premium two-agent product
//   Legacy:        free, gifted, starter, pro, scale, trial, expired
//
// New plans have a "metered cap" model: subscription = platform access. Token
// spend is either covered by the user's own AI auth (BYOK / OAuth) or by Joe's
// keys with a hard cap below the sub price so we cannot lose money on tokens.
// See `meteredCapUsd` field on PLANS entries.
export type PlanId =
  | "free" | "gifted" | "starter" | "pro" | "scale" | "trial" | "expired"
  | "hermes" | "openclaw" | "both";

export const PLANS: Record<Exclude<PlanId, "expired">, {
  name: string;
  price: number;
  annualPrice?: number;
  priceId?: string;
  annualPriceId?: string;
  /** @deprecated Use includedUsageUsd instead */
  creditsPerMonth: number;
  /** USD of API usage included monthly (pass-through model) */
  includedUsageUsd: number;
  opusPerMonth?: number;
  channels: number | "all";
  features: string[];
  models: string[];
  sandbox: boolean;
  arweave: boolean;
  mintPerMonth: number;
  trialDays?: number;
  /**
   * Hard cap on monthly model spend in USD when the user is on platform-provided
   * (Joe's) API keys. Set to 0 or omit on legacy plans without a true cap.
   * Cap is enforced by `src/lib/usageGuard.ts` before each model call.
   *
   * Math: meteredCapUsd MUST be < (price - infraCostUsd - minMarginUsd) so that
   * worst-case usage (user maxes the cap) still leaves margin > 0. See
   * docs/PRICING.md for the full margin table.
   */
  meteredCapUsd?: number;
  /** Estimated monthly infra cost per agent (Fly machine, storage, bandwidth). */
  infraCostUsd?: number;
  /**
   * Whether bring-your-own-key (BYOK) / provider OAuth is available on this
   * plan. When true, users can connect their Anthropic/OpenAI/xAI sub and the
   * platform charges only the subscription fee, never tokens.
   */
  byokSupported?: boolean;
}> = {

  free: {
    name: "Free",
    price: 0,
    creditsPerMonth: 100,
    includedUsageUsd: 0.50,       // ~50 MiniMax messages, enough to try it
    channels: 0,
    features: [
      "MiniMax M2.5 via shared gateway",
      "$0.50 API usage included",
      "Web chat only",
      "No sandbox, no channels, no minting",
    ],
    models: [
      "minimax/minimax-m2.5",
      "openrouter/minimax/minimax-m2.5",
    ],
    sandbox: false,
    arweave: false,
    mintPerMonth: 0,
  },

  gifted: {
    name: "Gifted",
    price: 0,
    creditsPerMonth: 1000,
    includedUsageUsd: 10,         // $10 courtesy credit
    channels: 5,
    features: [
      "All models (pay-as-you-go)",
      "$10 API credit included",
      "Dedicated isolated sandbox",
      "5 channels included",
      "15 Arweave mints per month",
      "Top up anytime for more usage",
    ],
    models: [
      "minimax/minimax-m2.5",
      "xai/grok-4-1-fast-reasoning",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "google/gemini-2.5-flash",
    ],
    sandbox: true,
    arweave: true,
    mintPerMonth: 15,
  },

  starter: {
    name: "Agent",
    price: 19,
    annualPrice: 16,
    priceId: process.env.STRIPE_STARTER_PRICE_ID || "",
    annualPriceId: process.env.STRIPE_STARTER_ANNUAL_PRICE_ID || "",
    creditsPerMonth: 1000,
    includedUsageUsd: 10,         // $19 - $10 usage = $9 platform fee
    channels: 5,
    features: [
      "All standard models",
      "$10/mo API usage included",
      "Dedicated isolated sandbox",
      "5 channels (Telegram, Discord, Slack, WhatsApp, Signal)",
      "200 Arweave soul mints per month",
      "Top up anytime for more usage",
    ],
    models: [
      "minimax/minimax-m2.5",
      "xai/grok-4-1-fast-reasoning",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "google/gemini-2.5-flash",
    ],
    sandbox: true,
    arweave: true,
    mintPerMonth: 200,
  },

  pro: {
    name: "Network",
    price: 49,
    annualPrice: 41,
    priceId: process.env.STRIPE_PRO_PRICE_ID || "",
    annualPriceId: process.env.STRIPE_PRO_ANNUAL_PRICE_ID || "",
    creditsPerMonth: 3000,
    includedUsageUsd: 30,         // $49 - $30 usage = $19 platform fee
    channels: "all",
    features: [
      "All models including premium",
      "$30/mo API usage included",
      "Dedicated isolated sandbox",
      "All 17 channels",
      "600 Arweave soul mints per month",
      "Bring your own API keys",
      "Top up anytime for more usage",
    ],
    models: [
      "minimax/minimax-m2.5",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "xai/grok-4-1-fast-reasoning",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-pro",
    ],
    sandbox: true,
    arweave: true,
    mintPerMonth: 600,
  },

  scale: {
    name: "Permanent",
    price: 149,
    annualPrice: 124,
    priceId: process.env.STRIPE_SCALE_PRICE_ID || "",
    annualPriceId: process.env.STRIPE_SCALE_ANNUAL_PRICE_ID || "",
    creditsPerMonth: 10000,
    includedUsageUsd: 100,        // $149 - $100 usage = $49 platform fee
    channels: "all",
    features: [
      "Every model (Opus, Grok 4, Gemini Pro, all)",
      "$100/mo API usage included",
      "Dedicated isolated sandbox",
      "All 17 channels + API access",
      "2,000 Arweave soul mints per month",
      "All tools + custom skills",
      "Priority support",
      "Top up anytime for more usage",
    ],
    models: [
      "anthropic/claude-opus-4-6",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-sonnet-4-6",
      "minimax/minimax-m2.5",
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "xai/grok-4-1-fast-reasoning",
      "xai/grok-4",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-pro",
    ],
    sandbox: true,
    arweave: true,
    mintPerMonth: 2000,
  },

  trial: {
    name: "Trial",
    price: 0,
    creditsPerMonth: 1000,
    includedUsageUsd: 5,          // $5 free to try (good for ~130 Sonnet msgs or ~25 Opus)
    channels: 5,
    trialDays: 7,
    features: [
      "7-day free trial",
      "All standard models",
      "$5 API credit to start",
      "Dedicated isolated sandbox",
      "5 channels included",
      "Top up anytime for more usage",
    ],
    models: [
      "minimax/minimax-m2.5",
      "xai/grok-4-1-fast-reasoning",
      "anthropic/claude-sonnet-4-5",
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "google/gemini-2.5-flash",
    ],
    sandbox: true,
    arweave: true,
    mintPerMonth: 200,
  },

  // ── 2026-Q2 product line ──────────────────────────────────────────────────
  // Hermes / OpenClaw / Both. Premium positioning, auth-first, capped metered.
  // Margin floor (metered, worst case): price - meteredCap - infraCost.
  //   hermes:   $29 - $22 - $5 = $2   (auth path: $29 - $5 = $24)
  //   openclaw: $29 - $22 - $5 = $2   (auth path: $29 - $5 = $24)
  //   both:     $49 - $42 - $5 = $2   (auth path: $49 - $5 = $44)
  // Cap raised vs original draft to give users real usage headroom; metered
  // worst-case margin still positive.

  hermes: {
    name: "Hermes",
    price: 29,
    annualPrice: 24,
    priceId: process.env.STRIPE_HERMES_PRICE_ID || "",
    annualPriceId: process.env.STRIPE_HERMES_ANNUAL_PRICE_ID || "",
    creditsPerMonth: 0,           // legacy field, unused on cap-model plans
    includedUsageUsd: 22,         // matches meteredCapUsd
    meteredCapUsd: 22,
    infraCostUsd: 5,              // Fly machine + storage
    byokSupported: true,
    channels: 5,
    features: [
      "Persistent memory across devices",
      "SMS, iMessage, WhatsApp, calendar",
      "Connect Claude Pro / ChatGPT / Grok for zero token spend",
      "Or use ours, capped at $22/mo",
      "Cannot exceed your subscription cost",
    ],
    models: [
      "xai/grok-4-1-fast-reasoning",
      "openai/gpt-4.1-mini",
      "anthropic/claude-sonnet-4-5",
    ],
    sandbox: true,
    arweave: true,
    mintPerMonth: 200,
  },

  openclaw: {
    name: "OpenClaw",
    price: 29,
    annualPrice: 24,
    priceId: process.env.STRIPE_OPENCLAW_PRICE_ID || "",
    annualPriceId: process.env.STRIPE_OPENCLAW_ANNUAL_PRICE_ID || "",
    creditsPerMonth: 0,
    includedUsageUsd: 22,
    meteredCapUsd: 22,
    infraCostUsd: 5,              // persistent Fly machine for desktop
    byokSupported: true,
    channels: 0,
    features: [
      "Cloud desktop & browser",
      "Coding, browsing, file work",
      "BYOK supported, use your own subscription",
      "Or use ours, capped at $22/mo",
      "Throttles to cheap models before going negative",
    ],
    models: [
      "xai/grok-4-1-fast-reasoning",
      "openai/gpt-4.1-mini",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-sonnet-4-6",
    ],
    sandbox: true,
    arweave: true,
    mintPerMonth: 200,
  },

  both: {
    name: "Both",
    price: 49,
    annualPrice: 41,
    priceId: process.env.STRIPE_BOTH_PRICE_ID || "",
    annualPriceId: process.env.STRIPE_BOTH_ANNUAL_PRICE_ID || "",
    creditsPerMonth: 0,
    includedUsageUsd: 42,
    meteredCapUsd: 42,
    infraCostUsd: 5,
    byokSupported: true,
    channels: 5,
    features: [
      "Everything in Hermes & OpenClaw",
      "They share memory and talk to each other",
      "BYOK on either or both agents",
      "Or use ours, capped at $42/mo total",
      "Save $9 vs buying separately",
    ],
    models: [
      "xai/grok-4-1-fast-reasoning",
      "openai/gpt-4.1-mini",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-opus-4-6",
    ],
    sandbox: true,
    arweave: true,
    mintPerMonth: 400,
  },
};

// ── Plan alias normalization ─────────────────────────────────────────────────
// Firestore may store display names or legacy aliases. Normalize before any check.

const PLAN_ALIASES: Record<string, PlanId | null> = {
  permanent: "scale",   // Joe's account plan
  network:   "pro",     // display name for pro tier
  agent:     "starter", // display name for starter tier
  expired:   null,      // expired trial → null (no access)
};

export function normalizePlan(plan: string): PlanId | null {
  const lower = plan?.toLowerCase() ?? "free";
  // Check aliases first
  if (lower in PLAN_ALIASES) {
    return PLAN_ALIASES[lower];
  }
  // Otherwise return as-is (including "trial" which is a valid PlanId)
  return lower as PlanId;
}

// ── Plan capability helpers ──────────────────────────────────────────────────

// 2026-Q2 plans (hermes/openclaw/both) get the same sandbox/channel/mint
// capabilities as the legacy paid tiers. Keep this list in one constant so we
// don't drift between the three checks below.
const PAID_PLAN_IDS = ["starter", "pro", "scale", "gifted", "trial", "hermes", "openclaw", "both"];

export function canUseSandbox(plan: string): boolean {
  const normalized = normalizePlan(plan);
  if (!normalized) return false;
  return PAID_PLAN_IDS.includes(normalized);
}

export function canUseChannels(plan: string): boolean {
  const normalized = normalizePlan(plan);
  if (!normalized) return false;
  return PAID_PLAN_IDS.includes(normalized);
}

export function canMint(plan: string): boolean {
  const normalized = normalizePlan(plan);
  if (!normalized) return false;
  return PAID_PLAN_IDS.includes(normalized);
}

export function getMintLimit(plan: string): number {
  const normalized = normalizePlan(plan);
  if (!normalized) return 0;
  const p = PLANS[normalized as keyof typeof PLANS];
  return p?.mintPerMonth ?? 0;
}

export function getMintPerMonth(plan: string): number {
  return getMintLimit(plan);
}

/** @deprecated Use getIncludedUsageUsd() instead */
export function getCreditsPerMonth(plan: string): number {
  const normalized = normalizePlan(plan);
  if (!normalized) return 0;
  const p = PLANS[normalized as keyof typeof PLANS];
  return p?.creditsPerMonth ?? 100;
}

/** Get the included monthly API usage in USD for a plan tier */
export function getIncludedUsageUsd(plan: string): number {
  const normalized = normalizePlan(plan);
  if (!normalized) return 0;
  const p = PLANS[normalized as keyof typeof PLANS];
  return p?.includedUsageUsd ?? 0;
}

export function isGifted(plan: string): boolean {
  return normalizePlan(plan) === "gifted";
}

export function isTrial(plan: string): boolean {
  return normalizePlan(plan) === "trial";
}

/**
 * Check if a trial has expired.
 * @param trialStartedAt - When the trial started (Date or ISO string)
 * @returns true if trial has expired (> 7 days since start)
 */
export function isTrialExpired(trialStartedAt: Date | string | undefined): boolean {
  if (!trialStartedAt) return false; // No start date = not a trial or not started
  const startDate = typeof trialStartedAt === "string" ? new Date(trialStartedAt) : trialStartedAt;
  const trialDays = PLANS.trial.trialDays ?? 7;
  const expiryDate = new Date(startDate.getTime() + trialDays * 24 * 60 * 60 * 1000);
  return new Date() > expiryDate;
}

/**
 * Get the trial expiry date.
 * @param trialStartedAt - When the trial started (Date or ISO string)
 * @returns Expiry date or null if not a trial
 */
export function getTrialExpiryDate(trialStartedAt: Date | string | undefined): Date | null {
  if (!trialStartedAt) return null;
  const startDate = typeof trialStartedAt === "string" ? new Date(trialStartedAt) : trialStartedAt;
  const trialDays = PLANS.trial.trialDays ?? 7;
  return new Date(startDate.getTime() + trialDays * 24 * 60 * 60 * 1000);
}

// Look up plan by Stripe price ID (used in webhook)
export function getPlanByPriceId(priceId: string): PlanId | null {
  for (const [id, plan] of Object.entries(PLANS)) {
    if (plan.priceId === priceId || plan.annualPriceId === priceId) {
      return id as PlanId;
    }
  }
  return null;
}

// ── Model config per tier ────────────────────────────────────────────────────
// IMPORTANT: Use "clawd-*" custom providers (NOT built-in "anthropic", "openai", "xai").
// OpenClaw built-in providers always call canonical APIs directly, ignoring BASE_URL env vars.
// To route through clawd.run/api/proxy, we must use CUSTOM provider names.

// Default sandbox primary model per tier, plus ordered fallbacks used on provider
// outage / 5xx / timeout. Fallbacks are consumed by src/app/api/proxy (see Phase 2
// audit) — adding them here without retry logic upstream is a no-op, so keep these
// two layers in sync when editing.
//
// Cost notes (rough, per 1M tokens, in/out):
//   grok-4-1-fast-non-reasoning : $0.20 / $0.50  — cheapest "real" chat model
//   grok-4-1-fast-reasoning     : $0.50 / $2.00  — 4x cost, much better reasoning
//   gpt-4.1-mini                : $0.40 / $1.60  — Grok-reasoning parity, different vendor (fallback diversity)
//   claude-sonnet-4-5           : $3    / $15    — premium default for Pro+
//   claude-sonnet-4-6           : $3    / $15    — latest premium, minor edge
//   claude-opus-4-6             : $15   / $75    — reserved for opt-in heavy use
//
// Strategy: Trial shows off Sonnet to drive conversion. Starter gets Grok-reasoning
// (3-6x cheaper than Sonnet) with cross-vendor fallback for reliability. Pro/Scale
// earn their price with Sonnet defaults and layered fallbacks.
export const TIER_MODELS: Record<string, { primary: string; fallbacks: string[] }> = {
  free:      { primary: "clawd-xai/grok-4-1-fast-non-reasoning", fallbacks: [] },
  gifted:    { primary: "clawd-xai/grok-4-1-fast-reasoning",     fallbacks: ["clawd-openai/gpt-4.1-mini"] },
  trial:     { primary: "clawd-anthropic/claude-sonnet-4-5",     fallbacks: ["clawd-xai/grok-4-1-fast-reasoning", "clawd-openai/gpt-4.1-mini"] },
  starter:   { primary: "clawd-xai/grok-4-1-fast-reasoning",     fallbacks: ["clawd-openai/gpt-4.1-mini", "clawd-xai/grok-4-1-fast-non-reasoning"] },
  agent:     { primary: "clawd-xai/grok-4-1-fast-reasoning",     fallbacks: ["clawd-openai/gpt-4.1-mini", "clawd-xai/grok-4-1-fast-non-reasoning"] },
  pro:       { primary: "clawd-anthropic/claude-sonnet-4-5",     fallbacks: ["clawd-xai/grok-4-1-fast-reasoning", "clawd-openai/gpt-4.1-mini"] },
  network:   { primary: "clawd-anthropic/claude-sonnet-4-5",     fallbacks: ["clawd-xai/grok-4-1-fast-reasoning", "clawd-openai/gpt-4.1-mini"] },
  scale:     { primary: "clawd-anthropic/claude-sonnet-4-6",     fallbacks: ["clawd-anthropic/claude-sonnet-4-5", "clawd-xai/grok-4-1-fast-reasoning"] },
  permanent: { primary: "clawd-anthropic/claude-sonnet-4-6",     fallbacks: ["clawd-anthropic/claude-sonnet-4-5", "clawd-xai/grok-4-1-fast-reasoning"] },
  // 2026-Q2 plans default to Grok-fast-reasoning so a metered $17 cap covers
  // hundreds of turns even worst-case. Sonnet is available as escalation.
  hermes:    { primary: "clawd-xai/grok-4-1-fast-reasoning",     fallbacks: ["clawd-openai/gpt-4.1-mini", "clawd-anthropic/claude-sonnet-4-5"] },
  openclaw:  { primary: "clawd-xai/grok-4-1-fast-reasoning",     fallbacks: ["clawd-anthropic/claude-sonnet-4-5", "clawd-openai/gpt-4.1-mini"] },
  both:      { primary: "clawd-xai/grok-4-1-fast-reasoning",     fallbacks: ["clawd-anthropic/claude-sonnet-4-6", "clawd-anthropic/claude-sonnet-4-5", "clawd-openai/gpt-4.1-mini"] },
};

const SCALE_TIERS = new Set(["scale", "permanent"]);
const PRO_TIERS   = new Set(["pro", "network", "scale", "permanent"]);

export function getConfigForTier(tier: string, proxyToken?: string) {
  const m = TIER_MODELS[tier] || TIER_MODELS.free;
  const isScale = SCALE_TIERS.has(tier);
  const isPro   = PRO_TIERS.has(tier);

  // P0 SECURITY: NO raw API keys in sandbox config.
  // Sandboxes authenticate through /api/proxy using their gateway token.
  // Only non-sensitive env vars go here (BRAVE_API_KEY is low-risk, search-only).
  const envKeys: Record<string, string> = {};
  if (process.env.BRAVE_API_KEY) envKeys.BRAVE_API_KEY = process.env.BRAVE_API_KEY;

  // Tier-based plugin bundling:
  // - Context engine defaults to "legacy" (always shipped with OpenClaw).
  //   "lossless-claw" was dropped from OpenClaw >=2026.3.13 causing runtime errors:
  //   `Context engine "lossless-claw" is not registered. Available engines: legacy.`
  //   Re-enable only if the installed OpenClaw version actually ships the plugin.
  // - Pro+ tiers: add long-term memory and diffs.
  // - Scale tiers: upgrade LCM summarization model/provider for higher quality.
  envKeys.LCM_SUMMARY_MODEL = isScale ? "claude-haiku-4-5-20251001" : "grok-4-1-fast-non-reasoning";
  envKeys.LCM_SUMMARY_PROVIDER = isScale ? "clawd-anthropic" : "clawd-xai";

  const pluginsEntries: Record<string, unknown> = {};

  if (isPro) {
    pluginsEntries["memory-lancedb"] = { enabled: true };
    pluginsEntries["diffs"] = { enabled: true };
  }

  // Custom providers route through clawd.run/api/proxy instead of canonical APIs.
  // OpenClaw built-in providers (anthropic, openai, xai) always call canonical APIs directly
  // and ignore *_BASE_URL env vars. Custom provider names are the ONLY way to proxy.
  const proxyUrl = process.env.CLAWD_PROXY_URL || "https://clawd.run/api/proxy";
  const modelsConfig = {
    mode: "merge" as const,
    providers: {
      "clawd-xai": {
        baseUrl: proxyUrl,
        api: "openai-completions",
        models: [
          { id: "grok-4-1-fast-non-reasoning", name: "grok-4-1-fast-non-reasoning" },
          { id: "grok-4-1-fast-reasoning", name: "grok-4-1-fast-reasoning" },
          { id: "grok-4-0709", name: "grok-4-0709" },
        ],
      },
      "clawd-openai": {
        baseUrl: proxyUrl,
        api: "openai-completions",
        models: [
          { id: "gpt-5.2", name: "gpt-5.2" },
          { id: "gpt-4.1", name: "gpt-4.1" },
          { id: "gpt-4.1-mini", name: "gpt-4.1-mini" },
        ],
      },
      "clawd-anthropic": {
        baseUrl: proxyUrl,
        api: "anthropic-messages",
        models: [
          { id: "claude-sonnet-4-6", name: "claude-sonnet-4-6" },
          { id: "claude-sonnet-4-5", name: "claude-sonnet-4-5" },
          { id: "claude-opus-4-6", name: "claude-opus-4-6" },
        ],
      },
    },
  };

  return {
    env: envKeys,
    plugins: {
      slots: {
        // Use "legacy" — it's the only engine guaranteed to be registered in
        // OpenClaw 2026.3.13. Setting a missing engine here causes chat to fail with
        // `Context engine "X" is not registered. Available engines: legacy.`
        contextEngine: "legacy",
      },
      entries: pluginsEntries,
    },
    models: modelsConfig,
    gateway: {
      mode: "local",
      bind: "lan",
      // OpenClaw >=2026.3.13 refuses to bind to LAN with auth.mode="none".
      // Use token auth when a proxyToken is provided; fall back to none for legacy callers
      // (which only works on loopback binds).
      auth: proxyToken
        ? { mode: "token", token: proxyToken }
        : { mode: "none" },
      http: { endpoints: { chatCompletions: { enabled: true } } },
      controlUi: { dangerouslyAllowHostHeaderOriginFallback: true },
    },
    agents: {
      defaults: {
        model: m.primary,
        subagents: { model: m.fallbacks[0] ?? m.primary, maxConcurrent: isScale ? 8 : 4 },
        contextTokens: isScale ? 131072 : isPro ? 65536 : 32768,
        bootstrapMaxChars: 25000,
      },
    },
    memory: {
      backend: "builtin",
    },
    skills: {
      entries: {},
    },
  };
}

// ── Top-up packs (Starter+ only) ─────────────────────────────────────────────

export const TOPUPS = {
  small: {
    name: "500 credits",
    credits: 500,
    price: 9,
    priceId: process.env.STRIPE_TOPUP_SMALL_PRICE_ID || "",
  },
  medium: {
    name: "1,500 credits",
    credits: 1500,
    price: 19,
    priceId: process.env.STRIPE_TOPUP_MEDIUM_PRICE_ID || "",
  },
  large: {
    name: "4,000 credits",
    credits: 4000,
    price: 49,
    priceId: process.env.STRIPE_TOPUP_LARGE_PRICE_ID || "",
  },
};

export const MINT_PACKS = {
  starter:   { name: "Starter Pack",   mints: 10,  credits: 10,  price: 10,  priceId: process.env.STRIPE_MINT_PACK_STARTER_PRICE_ID   || "", description: "10 Arweave soul saves" },
  builder:   { name: "Builder Pack",   mints: 50,  credits: 50,  price: 40,  priceId: process.env.STRIPE_MINT_PACK_BUILDER_PRICE_ID   || "", description: "50 Arweave soul saves" },
  permanent: { name: "Permanent Pack", mints: 250, credits: 250, price: 150, priceId: process.env.STRIPE_MINT_PACK_PERMANENT_PRICE_ID || "", description: "250 Arweave soul saves, best value" },
} as const;
export type MintPackId = keyof typeof MINT_PACKS;
export function getMintPackByPriceId(priceId: string): MintPackId | null {
  for (const [key, pack] of Object.entries(MINT_PACKS)) {
    if (pack.priceId && pack.priceId === priceId) return key as MintPackId;
  }
  return null;
}
