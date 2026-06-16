#!/usr/bin/env node
/**
 * setup-stripe.js
 * Creates Stripe products, prices, coupon, and promo code for clawd.run.
 *
 * Run once with live key:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe.js
 *
 * Then copy the printed env vars to Vercel.
 */

const Stripe = require("stripe");

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Error: STRIPE_SECRET_KEY not set.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2025-12-15.clover" });

async function upsertProduct(name, description) {
  const existing = await stripe.products.search({ query: `name:"${name}"`, limit: 1 });
  if (existing.data.length) return existing.data[0];
  return stripe.products.create({ name, description, type: "service" });
}

async function upsertPrice(productId, unit_amount, nickname, recurring) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
  const match = prices.data.find(
    (p) => p.unit_amount === unit_amount && p.nickname === nickname
  );
  if (match) return match;
  return stripe.prices.create({
    product: productId,
    unit_amount,
    currency: "usd",
    nickname,
    recurring,
  });
}

async function main() {
  console.log("Setting up Stripe products for clawd.run...\n");

  const envVars = {};

  // ── Subscription plans ───────────────────────────────────────────────────

  const plans = [
    {
      name: "clawd.run Starter",
      desc: "Dedicated sandbox, 5 channels, 1,000 credits/month",
      monthlyAmount: 1900,   // $19.00
      annualAmount:  19000,  // $190.00/yr (~$15.83/mo)
      monthlyKey: "STRIPE_STARTER_PRICE_ID",
      annualKey:  "STRIPE_STARTER_ANNUAL_PRICE_ID",
    },
    {
      name: "clawd.run Pro",
      desc: "All 36 channels, 3,000 credits/month, all models",
      monthlyAmount: 4900,
      annualAmount:  49000,
      monthlyKey: "STRIPE_PRO_PRICE_ID",
      annualKey:  "STRIPE_PRO_ANNUAL_PRICE_ID",
    },
    {
      name: "clawd.run Scale",
      desc: "10,000 credits/month, Opus, unlimited mints, priority support",
      monthlyAmount: 14900,
      annualAmount:  149000,
      monthlyKey: "STRIPE_SCALE_PRICE_ID",
      annualKey:  "STRIPE_SCALE_ANNUAL_PRICE_ID",
    },
  ];

  for (const plan of plans) {
    console.log(`Creating product: ${plan.name}`);
    const product = await upsertProduct(plan.name, plan.desc);

    const monthly = await upsertPrice(product.id, plan.monthlyAmount, "Monthly", {
      interval: "month",
    });
    const annual = await upsertPrice(product.id, plan.annualAmount, "Annual", {
      interval: "year",
    });

    envVars[plan.monthlyKey] = monthly.id;
    envVars[plan.annualKey] = annual.id;

    console.log(`  Monthly: ${monthly.id}  ($${plan.monthlyAmount / 100}/mo)`);
    console.log(`  Annual:  ${annual.id}   ($${plan.annualAmount / 100}/yr)`);
  }

  // ── Launchpad plans (one-click hosted Hermes / OpenClaw agents) ───────────
  // These match src/lib/launchpad/plans.ts. Monthly recurring only.
  const launchpad = [
    {
      name: "clawd.run Hermes Solo",
      desc: "One-click hosted Hermes (Nous Research) agent. $3 inference hard cap, no surprise bills. 40 active hours/mo.",
      amount: 2900,
      key: "STRIPE_LAUNCHPAD_HERMES_PRICE_ID",
    },
    {
      name: "clawd.run OpenClaw Solo",
      desc: "One-click hosted OpenClaw gateway. $3 inference hard cap, no surprise bills. 40 active hours/mo.",
      amount: 2900,
      key: "STRIPE_LAUNCHPAD_OPENCLAW_PRICE_ID",
    },
    {
      name: "clawd.run Bundle",
      desc: "Hermes + OpenClaw, both one-click hosted. $3 inference hard cap. 80 active hours/mo (shared).",
      amount: 4900,
      key: "STRIPE_LAUNCHPAD_BUNDLE_PRICE_ID",
    },
  ];

  console.log("\nCreating launchpad plans:");
  for (const lp of launchpad) {
    const product = await upsertProduct(lp.name, lp.desc);
    const price = await upsertPrice(product.id, lp.amount, "Monthly", {
      interval: "month",
    });
    envVars[lp.key] = price.id;
    console.log(`  ${lp.name}: ${price.id}  ($${lp.amount / 100}/mo)`);
  }

  // ── Top-up packs ─────────────────────────────────────────────────────────

  const topups = [
    { name: "clawd.run 500 Credits",   amount: 900,  key: "STRIPE_TOPUP_SMALL_PRICE_ID"  },
    { name: "clawd.run 1,500 Credits", amount: 1900, key: "STRIPE_TOPUP_MEDIUM_PRICE_ID" },
    { name: "clawd.run 5,000 Credits", amount: 4900, key: "STRIPE_TOPUP_LARGE_PRICE_ID"  },
  ];

  console.log("\nCreating top-up packs:");
  for (const topup of topups) {
    const product = await upsertProduct(topup.name, "One-time credit top-up for clawd.run");
    const price = await stripe.prices.list({ product: product.id, active: true, limit: 5 });
    let p = price.data.find((x) => x.unit_amount === topup.amount && !x.recurring);
    if (!p) {
      p = await stripe.prices.create({
        product: product.id,
        unit_amount: topup.amount,
        currency: "usd",
        nickname: topup.name,
      });
    }
    envVars[topup.key] = p.id;
    console.log(`  ${topup.name}: ${p.id}  ($${topup.amount / 100})`);
  }

  // ── Coupon: EARLY50 — 50% off forever ────────────────────────────────────

  console.log("\nCreating EARLY50 coupon:");
  try {
    let coupon;
    try {
      coupon = await stripe.coupons.retrieve("EARLY50");
      console.log("  EARLY50 already exists:", coupon.id);
    } catch {
      coupon = await stripe.coupons.create({
        id: "EARLY50",
        name: "50% off forever (early access)",
        percent_off: 50,
        duration: "forever",
      });
      console.log("  Created EARLY50:", coupon.id);
    }

    // Promo code CLAWD50. Just attempt create; Stripe errors if the code already
    // exists, which we swallow. (Don't filter list() by coupon — the pinned API
    // version rejects that param.)
    try {
      const promo = await stripe.promotionCodes.create({
        coupon: coupon.id,
        code: "CLAWD50",
        max_redemptions: 200,
      });
      console.log("  Created promo code CLAWD50:", promo.id);
    } catch (e) {
      console.log("  Promo code CLAWD50 not created (likely already exists):", e.message);
    }
  } catch (err) {
    console.error("  Coupon error:", err.message);
  }

  // ── Print env vars ────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(60));
  console.log("Add these to Vercel environment variables:");
  console.log("=".repeat(60));
  for (const [key, val] of Object.entries(envVars)) {
    console.log(`${key}=${val}`);
  }
  console.log("=".repeat(60));
  console.log("\nDone. Paste the above into Vercel → Settings → Environment Variables.\n");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
