// HermesCo — Stripe Skills (the agent's hands on money).
//
// The agent NEVER holds a raw Stripe key. It calls these server-side skills,
// and every money-moving skill is gated by the Treasury (caps + human approval)
// before it is ever invoked. Runs against Stripe TEST mode so the demo moves
// real Stripe objects with zero real money at risk. With no key configured the
// skills return a "simulated" result so the product still demos end-to-end.
//
// Production hardening note: scope the key with a Stripe Restricted API Key and
// optionally expose these via @stripe/agent-toolkit. The HITL gate stays.

import Stripe from "stripe";

let cached: Stripe | null | undefined;

function client(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  cached = key ? new Stripe(key, { apiVersion: "2026-01-28.clover" as Stripe.LatestApiVersion }) : null;
  return cached;
}

export function stripeMode(): "test" | "live" | "none" {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return "none";
  return key.startsWith("sk_live") || key.startsWith("rk_live") ? "live" : "test";
}

export interface OfferResult {
  paymentLinkUrl: string;
  ref: string;
  kind: "payment_link" | "simulated";
}

// EARN setup: stand up a product + price + shareable payment link.
export async function createOffer(name: string, amountUsd: number): Promise<OfferResult> {
  const stripe = client();
  if (!stripe) {
    return {
      paymentLinkUrl: `https://example.test/pay/${encodeURIComponent(name)}`,
      ref: `sim_offer_${Date.now()}`,
      kind: "simulated",
    };
  }
  const product = await stripe.products.create({ name });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: Math.round(amountUsd * 100),
    currency: "usd",
  });
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
  });
  return { paymentLinkUrl: link.url, ref: link.id, kind: "payment_link" };
}

export interface ChargeResult {
  ref: string;
  status: string;
  kind: "payment_intent" | "simulated";
}

// EARN execute: take a (test-mode) customer payment with Stripe's test card.
export async function collectPayment(amountUsd: number, description: string): Promise<ChargeResult> {
  const stripe = client();
  if (!stripe) {
    return { ref: `sim_pi_${Date.now()}`, status: "succeeded", kind: "simulated" };
  }
  const pi = await stripe.paymentIntents.create({
    amount: Math.round(amountUsd * 100),
    currency: "usd",
    description,
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  return { ref: pi.id, status: pi.status, kind: "payment_intent" };
}

// SPEND execute: pay a vendor for a tool/SaaS (test-mode charge to a vendor PI).
export async function paySpend(
  amountUsd: number,
  vendor: string,
  description: string,
): Promise<ChargeResult> {
  const stripe = client();
  if (!stripe) {
    return { ref: `sim_spend_${Date.now()}`, status: "succeeded", kind: "simulated" };
  }
  const pi = await stripe.paymentIntents.create({
    amount: Math.round(amountUsd * 100),
    currency: "usd",
    description: `HermesCo spend → ${vendor}: ${description}`,
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  return { ref: pi.id, status: pi.status, kind: "payment_intent" };
}
