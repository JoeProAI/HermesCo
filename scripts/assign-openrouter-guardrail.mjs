#!/usr/bin/env node
/**
 * Backfill: attach the "launchpad-metered" guardrail (model allowlist) to all
 * existing Launchpad OpenRouter sub-keys.
 *
 * New sub-keys get the guardrail automatically at mint time
 * (src/lib/launchpad/openrouter.ts). This script covers keys minted before
 * that change, or where the mint-time assignment failed.
 *
 * Usage:
 *   OPENROUTER_MANAGEMENT_KEY=... node scripts/assign-openrouter-guardrail.mjs [--dry-run]
 */

const OR_BASE = "https://openrouter.ai/api/v1";
const GUARDRAIL_NAME = "launchpad-metered";
const ALLOWED_MODELS = ["x-ai/grok-4.3", "x-ai/grok-4.20-multi-agent"];
const DRY_RUN = process.argv.includes("--dry-run");

const mgmtKey = process.env.OPENROUTER_MANAGEMENT_KEY;
if (!mgmtKey) {
  console.error("OPENROUTER_MANAGEMENT_KEY not set");
  process.exit(1);
}

async function orFetch(path, init) {
  const res = await fetch(`${OR_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${mgmtKey}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(
      `OpenRouter ${init?.method || "GET"} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`
    );
  }
  return res.json();
}

async function ensureGuardrail() {
  const list = await orFetch("/guardrails");
  const existing = (list.data || []).find((g) => g.name === GUARDRAIL_NAME);
  if (existing) {
    console.log(`Guardrail "${GUARDRAIL_NAME}" exists: ${existing.id}`);
    return existing.id;
  }
  if (DRY_RUN) {
    console.log(`[dry-run] would create guardrail "${GUARDRAIL_NAME}"`);
    return null;
  }
  const created = await orFetch("/guardrails", {
    method: "POST",
    body: JSON.stringify({
      name: GUARDRAIL_NAME,
      description:
        "Launchpad metered sub-keys: platform models only. Other models require BYOK/OAuth.",
      allowed_models: ALLOWED_MODELS,
    }),
  });
  console.log(`Created guardrail "${GUARDRAIL_NAME}": ${created.data.id}`);
  return created.data.id;
}

async function listLaunchpadKeyHashes() {
  const hashes = [];
  let offset = 0;
  for (;;) {
    const page = await orFetch(`/keys?offset=${offset}`);
    const keys = page.data || [];
    if (keys.length === 0) break;
    for (const k of keys) {
      if (k.name?.startsWith("launchpad-") && !k.disabled) hashes.push(k.hash);
    }
    offset += keys.length;
  }
  return hashes;
}

const guardrailId = await ensureGuardrail();
const hashes = await listLaunchpadKeyHashes();
console.log(`Found ${hashes.length} active launchpad sub-key(s)`);

if (hashes.length === 0) process.exit(0);
if (DRY_RUN) {
  console.log(`[dry-run] would assign ${hashes.length} key(s) to guardrail`);
  process.exit(0);
}

const result = await orFetch(`/guardrails/${guardrailId}/assignments/keys`, {
  method: "POST",
  body: JSON.stringify({ key_hashes: hashes }),
});
console.log(`Assigned ${result.assigned_count ?? hashes.length} key(s) to "${GUARDRAIL_NAME}"`);
console.log(
  "NOTE: also assign this guardrail to the pool key / main API keys in the OpenRouter dashboard if desired."
);
