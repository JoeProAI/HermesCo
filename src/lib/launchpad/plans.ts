/**
 * Launchpad plans — flat monthly subscriptions for one-click Hermes/OpenClaw
 * dashboards. Dashboard host runs on Fly.io (auto-suspends when idle).
 * Terminal backend runs on Daytona (where the $20k credit pool lives).
 * Separate namespace from the main clawd.run PLANS so existing billing
 * logic is untouched.
 */

export type LaunchpadPlanId =
  | "launchpad_hermes"
  | "launchpad_openclaw"
  | "launchpad_bundle";

export type LaunchpadProduct = "hermes" | "openclaw";

export interface LaunchpadPlan {
  id: LaunchpadPlanId;
  name: string;
  /** Monthly price in USD */
  price: number;
  /** Stripe price ID env var name */
  priceIdEnv: string;
  /** Products included in this plan */
  products: LaunchpadProduct[];
  /** Daytona active-hour cap per billing cycle */
  hoursCap: number;
  /** Pooled OpenRouter credit included per cycle (USD) */
  pooledCreditUsd: number;
  /**
   * Per-machine Fly resource shape. memory is in GiB (Fly internally uses MB
   * but plans.ts stays in GiB for readability). Disk is handled separately
   * via a Fly Volume mounted at /workspace/.hermes for OAuth persistence.
   *
   * cpu 2 = shared-cpu-2x. A single shared vCPU starves the Node/Python
   * gateway during active multi-step agent runs (and slows first-boot
   * warmup); the second shared vCPU is ~$0.10/user/mo at 40 active hours —
   * negligible on a $29 plan — and noticeably snappier in-session. It does
   * not change cold-launch time (suspend handles that), only in-use feel.
   */
  resources: { cpu: number; memory: number };
  features: string[];
}

export const LAUNCHPAD_PLANS: Record<LaunchpadPlanId, LaunchpadPlan> = {
  launchpad_hermes: {
    id: "launchpad_hermes",
    name: "Hermes Solo",
    price: 29,
    priceIdEnv: "STRIPE_LAUNCHPAD_HERMES_PRICE_ID",
    products: ["hermes"],
    hoursCap: 40,
    pooledCreditUsd: 22,
    resources: { cpu: 2, memory: 2 },
    features: [
      "One-click Hermes (Nous Research) agent",
      "BYO Claude / ChatGPT / Grok subscription via OAuth",
      "40 active hours / month",
      "OpenRouter fallback credit included (plan-based)",
      "Auto-suspends when idle — wakes in 300ms",
      "OAuth tokens persist across restarts",
    ],
  },
  launchpad_openclaw: {
    id: "launchpad_openclaw",
    name: "OpenClaw Solo",
    price: 29,
    priceIdEnv: "STRIPE_LAUNCHPAD_OPENCLAW_PRICE_ID",
    products: ["openclaw"],
    hoursCap: 40,
    pooledCreditUsd: 22,
    resources: { cpu: 2, memory: 2 },
    features: [
      "One-click OpenClaw gateway",
      "40 active hours / month",
      "OpenRouter fallback credit included (plan-based)",
      "BYOK supported",
      "Channels + skills ready out of the box",
      "Auto-suspends when idle",
    ],
  },
  launchpad_bundle: {
    id: "launchpad_bundle",
    name: "Bundle",
    price: 49,
    priceIdEnv: "STRIPE_LAUNCHPAD_BUNDLE_PRICE_ID",
    products: ["hermes", "openclaw"],
    hoursCap: 80,
    pooledCreditUsd: 42,
    resources: { cpu: 2, memory: 2 },
    features: [
      "Hermes + OpenClaw, both one-click",
      "BYO Claude / ChatGPT / Grok subscription via OAuth",
      "80 active hours / month (shared pool)",
      "OpenRouter fallback credit included (plan-based)",
      "Best value for stacked workflows",
    ],
  },
};

export function getLaunchpadPlanByPriceId(priceId: string): LaunchpadPlan | null {
  for (const plan of Object.values(LAUNCHPAD_PLANS)) {
    const configured = process.env[plan.priceIdEnv];
    if (configured && configured === priceId) return plan;
  }
  return null;
}

export function getLaunchpadPlanPriceId(planId: LaunchpadPlanId): string | undefined {
  return process.env[LAUNCHPAD_PLANS[planId].priceIdEnv];
}

export function planAllowsProduct(
  planId: LaunchpadPlanId | null | undefined,
  product: LaunchpadProduct
): boolean {
  if (!planId) return false;
  const plan = LAUNCHPAD_PLANS[planId];
  return plan?.products.includes(product) ?? false;
}

// Idle scale-down: machines are created (in fly.ts) with the proxy autostop
// policy set to "suspend", and the in-image idle watchdog drives the actual
// suspend through /api/launchpad/idle-suspend after ~15 min of no real
// traffic. Suspend (RAM snapshot) resumes warm in ~0.3s vs a multi-minute
// cold boot, and bills as idle ($0 compute) while suspended.
