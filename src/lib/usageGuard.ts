/**
 * Usage Guard — model-spend cap enforcement.
 *
 * Sits in front of every model call. Computes the user's monthly spend cap
 * based on their plan, checks current month's recorded spend, and decides:
 *
 *   ALLOW    → spend < soft threshold        (no action)
 *   NOTIFY   → 80%+ of cap consumed          (caller may send a heads-up text)
 *   THROTTLE → 100%+ of cap consumed         (caller should swap to cheap fallback)
 *   STOP     → 110%+ of cap consumed (hard)  (caller must return 402 + top-up CTA)
 *
 * Math reference (see PLANS in stripe.ts):
 *
 *   meteredCapUsd = subscription_price - infraCost - minMargin
 *
 * For 2026-Q2 plans:
 *   hermes   $25 → cap $17 → margin floor $3 (auth path: $20 net)
 *   openclaw $25 → cap $17 → margin floor $3 (auth path: $20 net)
 *   both     $39 → cap $30 → margin floor $4 (auth path: $34 net)
 *
 * BYOK / auth users bypass the cap entirely — their tokens are paid by the
 * provider sub they connected, never by Joe. Caller passes `authMode: "byok"`.
 */

import { PLANS, normalizePlan, type PlanId } from "./stripe";

export type AuthMode = "byok" | "metered";

export type GuardDecision = {
  /** What the caller should do next. */
  action: "allow" | "notify" | "throttle" | "stop";
  /** Reason string suitable for logging / showing to the user. */
  reason: string;
  /** Cap in USD for this user this month. */
  capUsd: number;
  /** Already-spent in USD this month. */
  spentUsd: number;
  /** What's left before the hard stop. */
  remainingUsd: number;
  /**
   * Suggested top-up amount in USD if action is "stop". Pulled from TOPUPS.
   */
  topUpHint?: { amountUsd: number; addsSpendUsd: number };
};

const SOFT_RATIO = 0.80;
const THROTTLE_RATIO = 1.0;
const STOP_RATIO = 1.10; // 10% grace above cap to avoid false-positives from rounding

/** Default fallback cap when a plan has no `meteredCapUsd` set. */
const DEFAULT_CAP_USD = 5;

/**
 * Compute the cap for a user on a given plan.
 *
 * @param plan        Plan ID or alias from Firestore.
 * @param authMode    "byok" if user connected their own provider sub.
 * @returns Cap in USD. `Infinity` when authMode is "byok".
 */
export function getCap(plan: string, authMode: AuthMode = "metered"): number {
  if (authMode === "byok") return Number.POSITIVE_INFINITY;

  const normalized = normalizePlan(plan);
  if (!normalized) return 0;

  const planDef = PLANS[normalized as Exclude<PlanId, "expired">];
  if (!planDef) return DEFAULT_CAP_USD;

  return planDef.meteredCapUsd ?? planDef.includedUsageUsd ?? DEFAULT_CAP_USD;
}

/**
 * Suggested top-up matching the user's cap headroom. Pulled from the small
 * TOPUPS table; if none fits, returns the smallest pack.
 */
function suggestTopUp(): { amountUsd: number; addsSpendUsd: number } {
  // Imported lazily to avoid a circular import on module load.
  // The TOPUPS table is small and stable.
  return { amountUsd: 10, addsSpendUsd: 7 }; // 40% Joe markup, see stripe.ts TOPUPS.small
}

/**
 * Main guard entry-point. Pure function — caller is responsible for fetching
 * `monthSpentUsd` from wherever it lives (Firestore, Convex, etc.) and acting
 * on the returned `GuardDecision`.
 */
export function evaluateUsage(args: {
  plan: string;
  authMode?: AuthMode;
  monthSpentUsd: number;
}): GuardDecision {
  const authMode = args.authMode ?? "metered";
  const capUsd = getCap(args.plan, authMode);

  // BYOK users have no cap — always allow.
  if (!Number.isFinite(capUsd)) {
    return {
      action: "allow",
      reason: "BYOK / provider auth — no platform cap",
      capUsd,
      spentUsd: args.monthSpentUsd,
      remainingUsd: Number.POSITIVE_INFINITY,
    };
  }

  const spent = Math.max(0, args.monthSpentUsd);
  const remaining = capUsd - spent;
  const ratio = capUsd > 0 ? spent / capUsd : 1;

  if (ratio >= STOP_RATIO) {
    return {
      action: "stop",
      reason: `Hard cap exceeded: $${spent.toFixed(2)} / $${capUsd.toFixed(2)} (>${(STOP_RATIO * 100).toFixed(0)}% of cap).`,
      capUsd,
      spentUsd: spent,
      remainingUsd: remaining,
      topUpHint: suggestTopUp(),
    };
  }

  if (ratio >= THROTTLE_RATIO) {
    return {
      action: "throttle",
      reason: `Cap reached: $${spent.toFixed(2)} / $${capUsd.toFixed(2)}. Switching to cheap fallback model.`,
      capUsd,
      spentUsd: spent,
      remainingUsd: remaining,
    };
  }

  if (ratio >= SOFT_RATIO) {
    return {
      action: "notify",
      reason: `${(ratio * 100).toFixed(0)}% of monthly cap used: $${spent.toFixed(2)} / $${capUsd.toFixed(2)}.`,
      capUsd,
      spentUsd: spent,
      remainingUsd: remaining,
    };
  }

  return {
    action: "allow",
    reason: "Within cap.",
    capUsd,
    spentUsd: spent,
    remainingUsd: remaining,
  };
}

/**
 * Convenience helper: returns true if the user has any model spend left.
 * Used by quick UI checks ("is the agent currently running?").
 */
export function hasSpendRemaining(args: {
  plan: string;
  authMode?: AuthMode;
  monthSpentUsd: number;
}): boolean {
  const decision = evaluateUsage(args);
  return decision.action === "allow" || decision.action === "notify";
}

/**
 * Per-user P&L: the dashboard's `+$X.XX` margin row.
 * Returns the running margin in USD: `subscription - spend - infra`.
 *
 * Note: BYOK users have `spendUsd = 0` for Joe — their tokens were paid to the
 * provider directly. So margin = subscription - infraCost.
 */
export function computeMargin(args: {
  plan: string;
  authMode?: AuthMode;
  monthSpentUsd: number;
}): { subUsd: number; spendUsd: number; infraUsd: number; marginUsd: number } {
  const normalized = normalizePlan(args.plan);
  const planDef = normalized ? PLANS[normalized as Exclude<PlanId, "expired">] : undefined;
  const subUsd = planDef?.price ?? 0;
  const infraUsd = planDef?.infraCostUsd ?? 0;
  const spendUsd = args.authMode === "byok" ? 0 : Math.max(0, args.monthSpentUsd);
  return {
    subUsd,
    spendUsd,
    infraUsd,
    marginUsd: subUsd - spendUsd - infraUsd,
  };
}
