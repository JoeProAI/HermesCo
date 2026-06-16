// HermesCo — Stripe Skills (the agent's hands on money). Fully real: every call
// hits the live Stripe API. There is no simulated fallback — if Stripe is not
// configured the skills throw, so the Treasury never records fabricated money.
//
// The agent NEVER holds a raw Stripe key. It calls these server-side skills,
// and every money-moving skill is gated by the Treasury (caps + human approval)
// before it is ever invoked. Use a Stripe Restricted API Key to scope it.
// Test mode = real Stripe objects with no real dollars; live mode = real money.

import Stripe from "stripe";

let cached: Stripe | null | undefined;

function client(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  cached = key ? new Stripe(key, { apiVersion: "2026-01-28.clover" as Stripe.LatestApiVersion }) : null;
  return cached;
}

function requireClient(): Stripe {
  const stripe = client();
  if (!stripe) {
    throw new Error("Stripe is not connected — set STRIPE_SECRET_KEY to enable real payments.");
  }
  return stripe;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripeMode(): "test" | "live" | "none" {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return "none";
  return key.startsWith("sk_live") || key.startsWith("rk_live") ? "live" : "test";
}

export interface OfferResult {
  paymentLinkUrl: string;
  ref: string;
  kind: "payment_link";
}

// EARN setup: stand up a product + price + shareable payment link.
export async function createOffer(name: string, amountUsd: number): Promise<OfferResult> {
  const stripe = requireClient();
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
  kind: "payment_intent";
}

// EARN execute: take a customer payment with Stripe's test card.
export async function collectPayment(amountUsd: number, description: string): Promise<ChargeResult> {
  const stripe = requireClient();
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

// SPEND execute: pay a vendor for a tool/SaaS.
export async function paySpend(
  amountUsd: number,
  vendor: string,
  description: string,
): Promise<ChargeResult> {
  const stripe = requireClient();
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

// DEPOSIT — the human funds the Treasury with real capital via Stripe Checkout.
export interface DepositCheckout {
  url: string;
  sessionId: string;
}

export async function createDepositCheckout(input: {
  amountUsd: number;
  workspaceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<DepositCheckout> {
  const stripe = requireClient();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "HermesCo Treasury deposit" },
          unit_amount: Math.round(input.amountUsd * 100),
        },
        quantity: 1,
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: { workspaceId: input.workspaceId, kind: "treasury_deposit" },
  });
  if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
  return { url: session.url, sessionId: session.id };
}

export interface DepositConfirmation {
  paid: boolean;
  amountUsd: number;
  workspaceId: string | null;
}

export async function retrieveDepositCheckout(sessionId: string): Promise<DepositConfirmation> {
  const stripe = requireClient();
  const s = await stripe.checkout.sessions.retrieve(sessionId);
  return {
    paid: s.payment_status === "paid",
    amountUsd: (s.amount_total ?? 0) / 100,
    workspaceId: (s.metadata?.workspaceId as string | undefined) ?? null,
  };
}
