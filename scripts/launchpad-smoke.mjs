/**
 * launchpad-smoke.mjs
 *
 * Phase 0 validation: provisions one Hermes + one OpenClaw sandbox via the
 * Daytona SDK using the same code path as the production API, then stops +
 * deletes both. Reports timings + preview URLs.
 *
 * Run:
 *   DAYTONA_API_KEY=... LAUNCHPAD_OPENROUTER_POOL_KEY=... \
 *   node scripts/launchpad-smoke.mjs
 */
import { Daytona } from "@daytonaio/sdk";

const HERMES_IMAGE =
  process.env.LAUNCHPAD_HERMES_IMAGE || "joeproai/launchpad-hermes:latest";
const OPENCLAW_IMAGE =
  process.env.LAUNCHPAD_OPENCLAW_IMAGE || "joeproai/launchpad-openclaw:latest";

if (!process.env.DAYTONA_API_KEY) {
  console.error("DAYTONA_API_KEY not set");
  process.exit(2);
}

const client = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY,
  target: (process.env.DAYTONA_TARGET || "us"),
});

const envVars = {
  LAUNCHPAD_USER_ID: "smoke-test",
  LAUNCHPAD_LLM_PROVIDER: "openrouter",
  LAUNCHPAD_LLM_KEY: process.env.LAUNCHPAD_OPENROUTER_POOL_KEY || "",
  LAUNCHPAD_GATEWAY_TOKEN: "smoke-token-1234567890",
};

async function spin(product, image, port) {
  const t0 = Date.now();
  console.log(`\n[${product}] creating sandbox from ${image} …`);
  const sandbox = await client.create(
    {
      image,
      name: `lp-smoke-${product}-${Date.now()}`,
      envVars,
      resources: { cpu: 2, memory: 4, disk: 10 },
      autoStopInterval: 30,
      autoDeleteInterval: 60 * 24,
      labels: { launchpad: "smoke", product },
    },
    { timeout: 180 }
  );
  console.log(`[${product}] sandbox id=${sandbox.id}`);
  await sandbox.waitUntilStarted(180);
  console.log(`[${product}] started in ${Math.round((Date.now() - t0) / 1000)}s`);
  const preview = await sandbox.getPreviewLink(port);
  console.log(`[${product}] preview: ${preview.url}`);
  return sandbox;
}

async function teardown(label, sandbox) {
  try {
    await client.stop(sandbox);
    console.log(`[${label}] stopped`);
  } catch (e) {
    console.warn(`[${label}] stop failed:`, e?.message || e);
  }
  try {
    await client.delete(sandbox);
    console.log(`[${label}] deleted`);
  } catch (e) {
    console.warn(`[${label}] delete failed:`, e?.message || e);
  }
}

const t0 = Date.now();
let hermes, openclaw;
try {
  hermes = await spin("hermes", HERMES_IMAGE, 4242);
  openclaw = await spin("openclaw", OPENCLAW_IMAGE, 8080);
  console.log(
    `\n✓ Both workspaces up in ${Math.round((Date.now() - t0) / 1000)}s total`
  );
} catch (err) {
  console.error("Smoke run failed:", err?.stack || err);
} finally {
  if (hermes) await teardown("hermes", hermes);
  if (openclaw) await teardown("openclaw", openclaw);
}
