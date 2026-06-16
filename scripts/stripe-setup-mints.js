#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const Stripe = require("stripe");

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Error: STRIPE_SECRET_KEY not set.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2025-12-15.clover" });

async function upsertProduct(name, description) {
  const existing = await stripe.products.search({ query: `name:\"${name}\"`, limit: 1 });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.products.create({ name, description, type: "service" });
}

async function upsertOneTimePrice(productId, unitAmount) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
  const match = prices.data.find((p) => p.unit_amount === unitAmount && !p.recurring);
  if (match) return match;
  return stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency: "usd",
  });
}

async function main() {
  const packs = [
    {
      key: "STRIPE_MINT_PACK_STARTER_PRICE_ID",
      name: "Starter Mint Pack",
      description: "50 Arweave soul saves",
      unitAmount: 500,
    },
    {
      key: "STRIPE_MINT_PACK_PRO_PRICE_ID",
      name: "Pro Mint Pack",
      description: "200 Arweave soul saves",
      unitAmount: 1500,
    },
    {
      key: "STRIPE_MINT_PACK_ULTRA_PRICE_ID",
      name: "Ultra Mint Pack",
      description: "1,000 Arweave soul saves - best value",
      unitAmount: 5000,
    },
  ];

  const envVars = {};

  for (const pack of packs) {
    const product = await upsertProduct(pack.name, pack.description);
    const price = await upsertOneTimePrice(product.id, pack.unitAmount);
    envVars[pack.key] = price.id;
    console.log(`${pack.name}: ${price.id} ($${(pack.unitAmount / 100).toFixed(2)})`);
  }

  console.log("\nEnvironment variables:");
  for (const [k, v] of Object.entries(envVars)) {
    console.log(`${k}=${v}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
