/**
 * platform-context.ts
 *
 * Builds a platform-awareness block injected into agent system prompts.
 * Tells the agent: what tier the user is on, what's connected, what it can do,
 * and how to help the user navigate the platform.
 *
 * Used in:
 * - Free tier web chat (injected as system context alongside user's system prompt)
 * - Paid tier sandbox PLATFORM.md (written to workspace at provision time)
 * - GET /api/agent/context (agents can pull this from inside a sandbox)
 */

import { getAdminDb } from "./firebase-admin";
import { getCachedUserData } from "./cache";

export interface PlatformContext {
  userId:        string;
  agentId?:      string;
  agentName?:    string;
  plan:          string;
  channels:      string[];
  latestTxId:    string | null;
  latestTxAt:    string | null;
  mintUsed:      number;
  mintLimit:     number | "unlimited";
  mintRemaining: number | "unlimited";
  systemPrompt?: string;
}

import { getMintLimit } from "./stripe";

export async function getPlatformContext(
  userId: string,
  agentId?: string
): Promise<PlatformContext> {
  const db = getAdminDb();

  // User data cached for 60s (invalidated on plan changes via Stripe webhooks / admin API).
  // Agent data stays direct since agents update more frequently and per-agent cache adds churn.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [userData, agentDoc] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getCachedUserData<any>(userId, async () => {
      const snap = await db.collection("users").doc(userId).get();
      return snap.data() ?? {};
    }),
    agentId ? db.collection("agents").doc(agentId).get() : Promise.resolve(null),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentData: any = agentDoc?.data?.() ?? {};

  const plan      = userData.plan ?? agentData.plan ?? "free";
  const mintLimit = getMintLimit(plan) as number | "unlimited";

  const now          = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const mintUsed     = agentData.mintMonth === currentMonth ? Number(agentData.mintCount ?? 0) : 0;
  const mintRemaining =
    mintLimit === "unlimited" ? "unlimited" :
    mintLimit === 0           ? 0 :
    Math.max(0, (mintLimit as number) - mintUsed);

  const channels: string[] = [];
  if (agentData.channel && agentData.channel !== "none") channels.push(agentData.channel);

  return {
    userId,
    agentId,
    agentName:    agentData.name,
    plan,
    channels,
    latestTxId:   agentData.latestTxId  ?? null,
    latestTxAt:   agentData.latestTxAt  ?? null,
    mintUsed,
    mintLimit,
    mintRemaining,
    systemPrompt: agentData.systemPrompt,
  };
}

/**
 * Builds the platform context string to inject into a system prompt.
 * Concise — agents don't need a wall of text, just the actionable facts.
 */
export function buildContextBlock(ctx: PlatformContext): string {
  const vaultLine = ctx.plan === "free"
    ? "Arweave vault: not available on free tier"
    : ctx.latestTxId
      ? `Arweave vault: active — last snapshot https://arweave.net/${ctx.latestTxId}`
      : "Arweave vault: no snapshots yet — use mint_genesis() in the dashboard";

  const mintLine = ctx.plan === "free"
    ? ""
    : `Monthly mints: ${ctx.mintUsed}/${ctx.mintLimit} used (${ctx.mintRemaining} remaining)`;

  const channelLine = ctx.channels.length > 0
    ? `Channels connected: ${ctx.channels.join(", ")}`
    : "Channels connected: none";

  const upgradeHint = ctx.plan === "free"
    ? `\nFree tier includes web chat only. Upgrade for Arweave identity, channels, and sandbox at https://clawd.run/pricing`
    : "";

  const canMint = ctx.plan !== "free" && ctx.mintRemaining !== 0;

  const helpLines = [
    `- Connect channels or manage this agent: https://clawd.run/dashboard${ctx.agentId ? `/agent/${ctx.agentId}` : ""}`,
    ctx.plan === "free" ? `- Upgrade your plan: https://clawd.run/pricing` : null,
    canMint ? `- Mint a soul snapshot: click "mint_snapshot()" in the dashboard or ask the agent to call POST /api/agent/salvage` : null,
    `- Docs: https://clawd.run/docs`,
  ].filter(Boolean).join("\n");

  return `
---
[CLAWD.RUN — PLATFORM CONTEXT]
Plan: ${ctx.plan}${upgradeHint}
${vaultLine}
${mintLine ? mintLine + "\n" : ""}${channelLine}

How to help your user:
${helpLines}

If the user asks about connecting WhatsApp, Telegram, or Discord — send them to the dashboard link above.
If they ask about Arweave or permanent memory — explain that ${ctx.plan === "free" ? "this requires upgrading to Starter or higher" : "their soul is backed up on Arweave and can survive platform shutdown"}.
[END PLATFORM CONTEXT]
---`.trim();
}

/**
 * Full system prompt = agent's own systemPrompt + platform context block.
 * Use this for free tier web chat injection.
 */
export async function buildFullSystemPrompt(
  userId: string,
  agentId?: string,
  fallbackPrompt = "You are a helpful AI assistant."
): Promise<string> {
  try {
    const ctx     = await getPlatformContext(userId, agentId);
    const base    = ctx.systemPrompt ?? fallbackPrompt;
    const context = buildContextBlock(ctx);
    return `${base}\n\n${context}`;
  } catch (err) {
    console.error("[platform-context] Failed to build context:", err);
    return fallbackPrompt;
  }
}

/**
 * Returns a PLATFORM.md string for writing to a sandbox workspace.
 * The agent reads this at boot as part of its standard startup protocol.
 */
export async function buildPlatformMd(
  userId: string,
  agentId?: string
): Promise<string> {
  const ctx = await getPlatformContext(userId, agentId);
  const now = new Date().toISOString();

  return `# PLATFORM.md — clawd.run context
_Generated: ${now}_

## Your account
- **Plan**: ${ctx.plan}
- **Agent**: ${ctx.agentName ?? "unnamed"}${ctx.agentId ? ` (${ctx.agentId})` : ""}

## Arweave vault
${ctx.plan === "free"
  ? "- Not available on free tier — upgrade to mint your soul permanently"
  : ctx.latestTxId
    ? `- Latest snapshot: https://arweave.net/${ctx.latestTxId}\n- Minted: ${ctx.latestTxAt ?? "unknown"}\n- Mints this month: ${ctx.mintUsed}/${ctx.mintLimit}`
    : "- No snapshots yet. Use mint_genesis() in dashboard or POST /api/agent/salvage with your ns_ key"}

## Channels
${ctx.channels.length > 0 ? ctx.channels.map(c => `- ${c}: connected`).join("\n") : "- None connected"}

## What you can do on this plan
${ctx.plan === "free" ? `
- Web chat only
- No channels, no Arweave minting, no sandbox
- Upgrade at https://clawd.run/pricing` : `
- Arweave soul minting (${ctx.mintRemaining} mints remaining this month)
- Channels: connect via dashboard
- Isolated OpenClaw sandbox (you're running in one now)
- Self-mint skill: https://clawd.run/skills/self-mint/SKILL.md`}

## Links
- Dashboard: https://clawd.run/dashboard${ctx.agentId ? `/agent/${ctx.agentId}` : ""}
- Pricing: https://clawd.run/pricing
- Docs: https://clawd.run/docs
- Self-mint API: POST https://clawd.run/api/agent/salvage

## How to help your user
- "How do I connect WhatsApp?" → Dashboard → Agent → Channels
- "What is Arweave?" → Your soul is encrypted and stored permanently on the Arweave permaweb. It survives platform shutdown.
- "How do I upgrade?" → https://clawd.run/pricing
- "Can you remember me after reset?" → ${ctx.plan === "free" ? "Memory persists within the session, but Arweave backup requires upgrading" : "Yes — your soul is on Arweave. Restore from TX ID anytime."}
`;
}
