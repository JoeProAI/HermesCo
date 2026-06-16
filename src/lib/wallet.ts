/**
 * wallet.ts — Dollar-denominated prepaid wallet
 *
 * Replaces the old "credits" system. Balance is real USD.
 * Every API call deducts actual cost + platform markup.
 * Users top up via Stripe. Subscriptions include monthly credit.
 *
 * Firestore: users/{userId}.wallet = { balance, totalSpent, totalTopups, ... }
 */

import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { calculateCost, type ApiCallCost } from "@/lib/pricing";

// Minimum balance to allow API calls (prevent going deeply negative from race conditions)
const MIN_BALANCE_USD = -0.50;

export interface WalletState {
  /** Current balance in USD */
  balance: number;
  /** Total spent all-time in USD */
  totalSpent: number;
  /** Total topped up all-time in USD */
  totalTopups: number;
  /** Total included from subscription all-time */
  totalIncluded: number;
  /** Last top-up timestamp */
  lastTopupAt?: Date;
  /** Last charge timestamp */
  lastChargeAt?: Date;
}

/**
 * Get current wallet balance for a user.
 * Creates wallet with $0 if none exists.
 */
export async function getWallet(userId: string): Promise<WalletState> {
  const db = getAdminDb();
  const userDoc = await db.collection("users").doc(userId).get();
  const data = userDoc.data();

  if (!data) {
    return { balance: 0, totalSpent: 0, totalTopups: 0, totalIncluded: 0 };
  }

  const wallet = data.wallet || {};
  return {
    balance: wallet.balance ?? migrateOldCredits(data),
    totalSpent: wallet.totalSpent ?? 0,
    totalTopups: wallet.totalTopups ?? 0,
    totalIncluded: wallet.totalIncluded ?? 0,
    lastTopupAt: wallet.lastTopupAt?.toDate?.() ?? undefined,
    lastChargeAt: wallet.lastChargeAt?.toDate?.() ?? undefined,
  };
}

/**
 * Check if user can afford a message on the given model.
 * Returns estimated cost so caller can show it.
 */
export async function canAfford(
  userId: string,
  model: string,
  estimatedInputTokens: number = 2000,
  estimatedOutputTokens: number = 1000
): Promise<{ allowed: boolean; balance: number; estimatedCost: number; reason?: string }> {
  const wallet = await getWallet(userId);
  const estimate = calculateCost(model, estimatedInputTokens, estimatedOutputTokens);

  if (wallet.balance < MIN_BALANCE_USD) {
    return {
      allowed: false,
      balance: wallet.balance,
      estimatedCost: estimate.totalCost,
      reason: `Insufficient balance ($${wallet.balance.toFixed(2)}). Top up to continue.`,
    };
  }

  return {
    allowed: true,
    balance: wallet.balance,
    estimatedCost: estimate.totalCost,
  };
}

/**
 * Charge the user's wallet for an API call.
 * Call AFTER the API call succeeds (we know actual token counts).
 * Returns the cost details and new balance.
 */
export async function chargeForApiCall(
  userId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0,
  metadata?: Record<string, string>
): Promise<{ cost: ApiCallCost; newBalance: number; success: boolean }> {
  const cost = calculateCost(model, inputTokens, outputTokens, cachedTokens);
  const db = getAdminDb();
  const userRef = db.collection("users").doc(userId);

  const newBalance = await db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const data = doc.data() || {};
    const wallet = data.wallet || {};
    const currentBalance = wallet.balance ?? migrateOldCredits(data);
    const updatedBalance = Math.round((currentBalance - cost.totalCost) * 1_000_000) / 1_000_000;

    tx.update(userRef, {
      "wallet.balance": updatedBalance,
      "wallet.totalSpent": FieldValue.increment(cost.totalCost),
      "wallet.lastChargeAt": FieldValue.serverTimestamp(),
    });

    return updatedBalance;
  });

  // Log the charge to usage_log collection for detailed billing history
  await db.collection("usage_log").add({
    userId,
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    providerCost: cost.providerCost,
    markupAmount: cost.markupAmount,
    totalCharged: cost.totalCost,
    balanceAfter: newBalance,
    timestamp: FieldValue.serverTimestamp(),
    ...(metadata || {}),
  });

  return { cost, newBalance, success: true };
}

/**
 * Add funds to a user's wallet (from Stripe top-up or subscription credit).
 */
export async function addFunds(
  userId: string,
  amount: number,
  source: "topup" | "subscription" | "bonus" | "admin",
  reference?: string
): Promise<{ newBalance: number }> {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(userId);

  const fieldToIncrement = source === "subscription" ? "wallet.totalIncluded" : "wallet.totalTopups";

  const newBalance = await db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const data = doc.data() || {};
    const wallet = data.wallet || {};
    const currentBalance = wallet.balance ?? migrateOldCredits(data);
    const updatedBalance = Math.round((currentBalance + amount) * 1_000_000) / 1_000_000;

    tx.update(userRef, {
      "wallet.balance": updatedBalance,
      [fieldToIncrement]: FieldValue.increment(amount),
      "wallet.lastTopupAt": FieldValue.serverTimestamp(),
    });

    return updatedBalance;
  });

  // Log the top-up
  await db.collection("wallet_transactions").add({
    userId,
    type: source,
    amount,
    balanceAfter: newBalance,
    reference: reference || null,
    timestamp: FieldValue.serverTimestamp(),
  });

  console.log(`[Wallet] Added $${amount.toFixed(2)} (${source}) to ${userId}. New balance: $${newBalance.toFixed(2)}`);
  return { newBalance };
}

/**
 * Get recent usage log entries for a user (for dashboard).
 */
export async function getUsageLog(
  userId: string,
  limit: number = 50
): Promise<Array<{
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalCharged: number;
  providerCost: number;
  timestamp: Date;
}>> {
  const db = getAdminDb();
  const snap = await db.collection("usage_log")
    .where("userId", "==", userId)
    .orderBy("timestamp", "desc")
    .limit(limit)
    .get();

  return snap.docs.map(d => {
    const data = d.data();
    return {
      model: data.model,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      totalCharged: data.totalCharged,
      providerCost: data.providerCost,
      timestamp: data.timestamp?.toDate() || new Date(),
    };
  });
}

/**
 * Get aggregated spending for the current billing period.
 */
export async function getSpendingSummary(
  userId: string,
  periodStart?: Date
): Promise<{
  totalSpent: number;
  byModel: Record<string, { count: number; spent: number }>;
  messageCount: number;
}> {
  const db = getAdminDb();
  const start = periodStart || getMonthStart();

  const snap = await db.collection("usage_log")
    .where("userId", "==", userId)
    .where("timestamp", ">=", start)
    .get();

  const byModel: Record<string, { count: number; spent: number }> = {};
  let totalSpent = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const model = data.model || "unknown";
    if (!byModel[model]) byModel[model] = { count: 0, spent: 0 };
    byModel[model].count += 1;
    byModel[model].spent += data.totalCharged || 0;
    totalSpent += data.totalCharged || 0;
  }

  return { totalSpent, byModel, messageCount: snap.size };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Migrate old credit-based balance to wallet balance.
 * Old system: 1 credit ≈ $0.01. Convert remaining credits to dollars.
 */
function migrateOldCredits(userData: Record<string, unknown>): number {
  const oldCredits = (userData.creditsRemaining ?? userData.credits ?? 0) as number;
  if (typeof oldCredits === "number" && oldCredits > 0) {
    // 1 old credit ≈ $0.01, give them the benefit
    return oldCredits * 0.01;
  }
  return 0;
}

function getMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
