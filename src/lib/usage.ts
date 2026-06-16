import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { PLANS } from "@/lib/stripe";

// ── Usage Metering & Rate Limiting ──────────────────────────────────
// Tracks per-user message counts, enforces tier limits,
// and provides cost estimation for billing dashboards.

interface UsageRecord {
  messagesTotal: number;
  messagesToday: number;
  opusToday: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number;
  lastMessageAt: Date;
  resetDate: string; // YYYY-MM-DD for daily reset
}

// Model cost table (per 1M tokens)
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "minimax/minimax-m2.5": { input: 0.15, output: 1.20 },
  "anthropic/claude-opus-4-6": { input: 5.00, output: 25.00 },
  "anthropic/claude-sonnet-4-5": { input: 3.00, output: 15.00 },
  "openai/gpt-4.1": { input: 2.00, output: 8.00 },
  "xai/grok-4-1-fast-non-reasoning": { input: 0.20, output: 0.50 },
  "xai/grok-4": { input: 3.00, output: 15.00 },
  "google/gemini-2.5-flash": { input: 0.15, output: 0.60 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10.00 },
};

// Average tokens per message (for rough cost estimation)
const AVG_INPUT_TOKENS = 800;
const AVG_OUTPUT_TOKENS = 1200;

/**
 * Get today's date string in UTC for daily reset tracking
 */
function getTodayKey(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Check if user can send a message based on their tier limits.
 * Returns { allowed, reason, remaining }
 */
export async function checkRateLimit(
  userId: string,
  model: string,
  plan: string
): Promise<{ allowed: boolean; reason?: string; remaining?: number }> {
  const db = getAdminDb();
  const today = getTodayKey();
  const tierConfig = PLANS[plan as keyof typeof PLANS] || PLANS.free;

  // Get or create usage doc
  const usageRef = db.collection("usage").doc(userId);
  const usageDoc = await usageRef.get();
  const usage = usageDoc.data() as UsageRecord | undefined;

  // Reset daily counters if new day
  const messagesToday = usage?.resetDate === today ? (usage?.messagesToday || 0) : 0;
  const opusToday = usage?.resetDate === today ? (usage?.opusToday || 0) : 0;

  // Daily message limits removed — system now uses creditsRemaining (see /api/credits/deduct)
  // Opus-per-day cap also removed — Opus credit cost (10cr) self-limits usage naturally
  const isOpus = model.includes("opus");

  // Check model access for tier
  if (!tierConfig.models.includes(model)) {
    // Check if available via openrouter in tier config
    const isAvailable = tierConfig.models.some((m) => 
      m === model || model.endsWith(m.split("/").pop() || "")
    );
    if (!isAvailable) {
      return {
        allowed: false,
        reason: `${model} is not available on the ${tierConfig.name} plan. Upgrade to access this model.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Record a message usage event. Call after successful response.
 */
export async function recordUsage(
  userId: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const db = getAdminDb();
  const today = getTodayKey();
  const usageRef = db.collection("usage").doc(userId);

  // Calculate cost
  const costs = MODEL_COSTS[model] || { input: 1.0, output: 5.0 };
  const cost = (inputTokens / 1_000_000) * costs.input + (outputTokens / 1_000_000) * costs.output;

  const isOpus = model.includes("opus");

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(usageRef);
    const data = doc.data() as UsageRecord | undefined;

    // Reset daily if new day
    const isNewDay = data?.resetDate !== today;

    tx.set(usageRef, {
      messagesTotal: FieldValue.increment(1),
      messagesToday: isNewDay ? 1 : FieldValue.increment(1),
      opusToday: isNewDay ? (isOpus ? 1 : 0) : (isOpus ? FieldValue.increment(1) : (data?.opusToday || 0)),
      tokensIn: FieldValue.increment(inputTokens),
      tokensOut: FieldValue.increment(outputTokens),
      estimatedCost: FieldValue.increment(cost),
      lastMessageAt: FieldValue.serverTimestamp(),
      resetDate: today,
    }, { merge: true });
  });

  // Also log to monthly aggregate for billing dashboard
  const month = today.slice(0, 7); // YYYY-MM
  const monthlyRef = db.collection("usage_monthly").doc(`${userId}_${month}`);
  await monthlyRef.set({
    userId,
    month,
    messages: FieldValue.increment(1),
    tokensIn: FieldValue.increment(inputTokens),
    tokensOut: FieldValue.increment(outputTokens),
    estimatedCost: FieldValue.increment(cost),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Get current usage stats for a user (for dashboard display)
 */
export async function getUsageStats(userId: string): Promise<{
  today: { messages: number; remaining: number | null; opus: number };
  allTime: { messages: number; tokens: number; cost: number };
  plan: string;
}> {
  const db = getAdminDb();
  const today = getTodayKey();

  const [usageDoc, userDoc] = await Promise.all([
    db.collection("usage").doc(userId).get(),
    db.collection("users").doc(userId).get(),
  ]);

  const usage = usageDoc.data() as UsageRecord | undefined;
  const plan = userDoc.data()?.plan || "free";
  const messagesToday = usage?.resetDate === today ? (usage?.messagesToday || 0) : 0;
  const opusToday = usage?.resetDate === today ? (usage?.opusToday || 0) : 0;

  return {
    today: {
      messages: messagesToday,
      remaining: null, // credit-based — check creditsRemaining in users collection
      opus: opusToday,
    },
    allTime: {
      messages: usage?.messagesTotal || 0,
      tokens: (usage?.tokensIn || 0) + (usage?.tokensOut || 0),
      cost: usage?.estimatedCost || 0,
    },
    plan,
  };
}

/**
 * Estimate cost for a single message on a given model
 */
export function estimateMessageCost(model: string): number {
  const costs = MODEL_COSTS[model] || { input: 1.0, output: 5.0 };
  return (AVG_INPUT_TOKENS / 1_000_000) * costs.input + (AVG_OUTPUT_TOKENS / 1_000_000) * costs.output;
}
