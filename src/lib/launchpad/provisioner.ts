/**
 * Launchpad provisioner — orchestrates per-user dashboard machines on Fly.io.
 *
 * Hermes/OpenClaw dashboards run on Fly Machines (one app per user, one
 * machine per app) because Fly's L4-aware proxy supports WebSockets that
 * Daytona's HTTP-only proxy strips. Inside the dashboard, Hermes is
 * configured with `terminal.backend: daytona` so all shell commands the
 * agent runs execute on the Daytona compute (where the $20k credit pool
 * lives).
 *
 * This file used to live as `daytona.ts` and exported the same function
 * names. Routes that imported from `@/lib/launchpad/daytona` should be
 * updated to import from `@/lib/launchpad/provisioner` instead.
 */

import {
  LAUNCHPAD_PLANS,
  LaunchpadPlanId,
  LaunchpadProduct,
} from "@/lib/launchpad/plans";
import { loadByok } from "@/lib/launchpad/byok";
import { getLaunchpadUser } from "@/lib/launchpad/usage";
import { decryptUserKey } from "@/lib/launchpad/openrouter";
import {
  provisionWorkspaceFly,
  stopWorkspaceFly,
  startWorkspaceFly,
  suspendWorkspaceFly,
  deleteWorkspaceFly,
  statusOfFly,
  checkFlyAuth,
  imageFor,
} from "@/lib/launchpad/fly";
import { createHash } from "crypto";

export interface ProvisionResult {
  /** Fly app name, e.g. lp-hermes-3dvgcodv */
  flyApp: string;
  /** Fly machine ID inside the app */
  flyMachineId: string;
  /** Public dashboard URL */
  previewUrl: string;
  product: LaunchpadProduct;
  startedAt: string;
}

export function launchpadGatewayTokenFor(userId: string): string {
  const secret = process.env.PLATFORM_SECRET || "launchpad-dev-secret";
  return createHash("sha256")
    .update(`launchpad-gateway:${userId}:${secret}`)
    .digest("hex")
    .slice(0, 32);
}

export function withGatewayToken(url: string, token: string): string {
  try {
    const u = new URL(url);
    u.hash = `token=${token}`;
    return u.toString();
  } catch {
    return `${url.replace(/#.*$/, "").replace(/\/$/, "")}/#token=${token}`;
  }
}

/**
 * Spin up a Fly Machine for (userId, product). Idempotent — returns the
 * existing app/machine if one already exists for this user+product.
 *
 * Injects:
 *   - LAUNCHPAD_LLM_KEY: pooled OpenRouter key (or BYOK if user supplied)
 *   - DAYTONA_API_KEY: so Hermes can spawn workspaces for shell exec
 *   - HERMES_MODEL: cheap default (Haiku 4.5) — users override via OAuth
 */
export async function provisionWorkspace(
  userId: string,
  product: LaunchpadProduct,
  planId: LaunchpadPlanId
): Promise<ProvisionResult> {
  const plan = LAUNCHPAD_PLANS[planId];
  if (!plan) throw new Error(`Unknown plan ${planId}`);
  const gatewayToken = launchpadGatewayTokenFor(userId);

  const byok = await loadByok(userId);

  // LLM key resolution order:
  //   1. User's BYOK if they configured one (their cost, their cap)
  //   2. User's OpenRouter sub-key (hard USD cap + model-allowlist guardrail,
  //      both OpenRouter-enforced)
  // There is deliberately NO fallback to the shared pool key: it has no
  // per-user cap or model allowlist, so injecting it silently turns a sub-key
  // mint failure into unbounded spend on the platform key. Fail loudly
  // instead so the broken account gets fixed.
  let resolvedKey = "";
  let resolvedProvider: string = "openrouter";
  if (byok?.apiKey) {
    resolvedKey = byok.apiKey;
    resolvedProvider = byok.provider;
  } else {
    const user = await getLaunchpadUser(userId);
    if (user.openrouterKey) {
      try {
        resolvedKey = decryptUserKey(user.openrouterKey);
      } catch (err) {
        console.error(
          `[launchpad/provisioner] failed to decrypt sub-key for ${userId}:`,
          err
        );
      }
    }
    if (!resolvedKey) {
      throw new Error(
        `No LLM key for ${userId}: OpenRouter sub-key missing or undecryptable and no BYOK configured. ` +
          `Refusing to inject the shared pool key. Re-mint the sub-key (check OPENROUTER_MANAGEMENT_KEY and the checkout webhook) or have the user add a BYOK.`
      );
    }
  }

  const envVars: Record<string, string> = {
    LAUNCHPAD_USER_ID: userId,
    LAUNCHPAD_LLM_PROVIDER: resolvedProvider,
    LAUNCHPAD_LLM_KEY: resolvedKey,
    LAUNCHPAD_GATEWAY_TOKEN: gatewayToken,
    // Daytona is the *terminal* backend (where Hermes runs shell commands).
    DAYTONA_API_KEY: process.env.DAYTONA_API_KEY ?? "",
    HERMES_MODEL:
      process.env.LAUNCHPAD_DEFAULT_MODEL || "x-ai/grok-4.3",
    // OpenClaw pins to the image we ship: never auto-apply updates (would
    // drift from our pinned version, can break the container, wiped on a
    // volume-less restart). The "Update available" banner is separate and
    // config-gated -- start.fly.sh sets `update.checkOnStart false`, which with
    // this env off-switch makes the gateway's update routine early-return: no
    // banner, no periodic check. (Hermes ignores OPENCLAW_* vars.)
    OPENCLAW_NO_AUTO_UPDATE: "1",
    // Pin the gateway bind port so even an older image (whose start.fly.sh
    // defaults to 42069) listens where Fly's proxy routes (internal_port 8080).
    // (Hermes ignores OPENCLAW_* vars.)
    OPENCLAW_GATEWAY_PORT: "8080",
    // Workspace sandbox API: the agent can write files, run commands, and get
    // a public preview URL by calling these endpoints with headers
    // x-launchpad-user: $LAUNCHPAD_USER_ID, x-launchpad-token: $LAUNCHPAD_GATEWAY_TOKEN.
    CLAWD_SANDBOX_API:
      process.env.CLAWD_SANDBOX_API || "https://clawd.run/api/launchpad",
    // Idle-watchdog tuning (optional) -- set in Vercel to retune without a
    // docker rebuild; takes effect on the next machine (re)launch.
    ...(process.env.LAUNCHPAD_IDLE_STOP_SEC
      ? { LAUNCHPAD_IDLE_STOP_SEC: process.env.LAUNCHPAD_IDLE_STOP_SEC }
      : {}),
    ...(process.env.LAUNCHPAD_IDLE_BYTES
      ? { LAUNCHPAD_IDLE_BYTES: process.env.LAUNCHPAD_IDLE_BYTES }
      : {}),
  };

  const result = await provisionWorkspaceFly(userId, product, envVars, {
    cpu: plan.resources.cpu,
    // plans.ts memory is in GiB
    memory: plan.resources.memory,
  });

  // When LAUNCHPAD_AGENT_DOMAIN is set (e.g. "clawd.run"), hand out the agent's
  // address on that domain instead of the raw backend host. The Cloudflare worker
  // proxies <app>.<domain> -> <app>.fly.dev, so the backend host stays hidden.
  const agentDomain = process.env.LAUNCHPAD_AGENT_DOMAIN;
  const publicUrl = agentDomain
    ? result.publicUrl.replace(".fly.dev", `.${agentDomain}`)
    : result.publicUrl;

  return {
    flyApp: result.appName,
    flyMachineId: result.machineId,
    previewUrl:
      product === "openclaw"
        ? withGatewayToken(publicUrl, gatewayToken)
        : publicUrl,
    product: result.product,
    startedAt: result.startedAt,
  };
}

export async function stopWorkspace(
  flyApp: string,
  flyMachineId: string
): Promise<void> {
  await stopWorkspaceFly(flyApp, flyMachineId);
}

export async function startWorkspace(
  flyApp: string,
  flyMachineId: string
): Promise<void> {
  await startWorkspaceFly(flyApp, flyMachineId);
}

/**
 * Suspend (RAM-snapshot) a workspace so the next request resumes warm in ~0.3s.
 * Used by the in-image idle watchdog through the /api/launchpad/idle-suspend
 * control-plane endpoint — the watchdog never holds a Fly token itself.
 */
export async function suspendWorkspace(
  flyApp: string,
  flyMachineId: string
): Promise<void> {
  await suspendWorkspaceFly(flyApp, flyMachineId);
}

export async function deleteWorkspace(flyApp: string): Promise<void> {
  await deleteWorkspaceFly(flyApp);
}

export async function statusOf(
  flyApp: string,
  flyMachineId: string
): Promise<{ state: string | undefined; image: string | undefined } | null> {
  return statusOfFly(flyApp, flyMachineId);
}

/** The container image we currently ship for this product (repo:tag). */
export function targetImageFor(product: LaunchpadProduct): string {
  return imageFor(product);
}

/**
 * Liveness check on the Fly API token. Returns `{ ok:false, banned:true }` when
 * the token is revoked/banned — i.e. platform-wide provisioning is down.
 */
export async function flyAuthHealth(): Promise<{
  ok: boolean;
  status: number;
  banned: boolean;
  detail?: string;
}> {
  return checkFlyAuth();
}
