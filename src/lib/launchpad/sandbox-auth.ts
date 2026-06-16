/**
 * Auth + entitlement gate shared by the launchpad sandbox routes.
 *
 * Two callers are accepted:
 *   1. The dashboard (browser): Firebase ID token via Authorization: Bearer.
 *   2. The agent machine on Fly: x-launchpad-user + x-launchpad-token headers,
 *      where the token is the per-user gateway token already injected into the
 *      machine env as LAUNCHPAD_GATEWAY_TOKEN. This is what lets OpenClaw and
 *      Hermes use the sandbox as a tool (write files, run commands, get a
 *      preview URL) without holding Firebase credentials.
 */

import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { verifyAuth } from "@/lib/auth";
import { launchpadGatewayTokenFor } from "@/lib/launchpad/provisioner";
import { getLaunchpadUser } from "@/lib/launchpad/usage";

export interface SandboxAuthResult {
  userId: string;
  via: "firebase" | "agent-token";
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function authenticateSandboxRequest(
  request: NextRequest
): Promise<SandboxAuthResult | null> {
  const agentUser = request.headers.get("x-launchpad-user");
  const agentToken = request.headers.get("x-launchpad-token");
  if (agentUser && agentToken) {
    if (safeEqual(agentToken, launchpadGatewayTokenFor(agentUser))) {
      return { userId: agentUser, via: "agent-token" };
    }
    return null;
  }

  try {
    const decoded = await verifyAuth(request);
    return { userId: decoded.uid, via: "firebase" };
  } catch {
    return null;
  }
}

export type SandboxGateError =
  | "unauthorized"
  | "no_plan"
  | "hour_cap_reached"
  | "inference_cap_reached";

/**
 * Authenticate and verify the user is entitled to sandbox compute.
 * Mirrors the provision route's gates: plan required, hour cap and
 * inference cap both stop sandbox use cold.
 */
export async function requireSandboxAccess(
  request: NextRequest
): Promise<{ userId: string } | { error: SandboxGateError; status: number }> {
  const auth = await authenticateSandboxRequest(request);
  if (!auth) return { error: "unauthorized", status: 401 };

  const user = await getLaunchpadUser(auth.userId);
  if (!user.plan) return { error: "no_plan", status: 403 };
  if (user.hardStopped) return { error: "hour_cap_reached", status: 403 };
  if (user.inferenceExhausted && !user.byok) {
    return { error: "inference_cap_reached", status: 403 };
  }

  return { userId: auth.userId };
}
