/**
 * credits.ts — Shared credit check/deduct for all billable operations
 *
 * Used by: chat route, mint routes, any future billable API.
 * 1 credit ≈ $0.01. Mint = 5 credits.
 */

import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export const MINT_CREDIT_COST = 5;

/**
 * Check if a user has enough credits for an operation.
 * Does NOT deduct — call deductCredits() after the operation succeeds.
 */
export async function checkCredits(
  userId: string,
  required: number = 1
): Promise<{ hasCredits: boolean; current: number; error?: string }> {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(userId);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return { hasCredits: false, current: 0, error: "User not found" };
  }

  const userData = userDoc.data() || {};
  let currentCredits = userData.creditsRemaining ?? userData.credits;

  // Fix string-typed credits
  if (typeof currentCredits === "string") {
    currentCredits = parseFloat(currentCredits) || 0;
    await userRef.update({ credits: currentCredits, creditsRemaining: currentCredits });
  }
  currentCredits = currentCredits || 0;

  if (currentCredits < required) {
    return {
      hasCredits: false,
      current: currentCredits,
      error: `Insufficient credits. Have ${currentCredits}, need ${required}`,
    };
  }

  return { hasCredits: true, current: currentCredits };
}

/**
 * Atomically deduct credits after a successful operation.
 */
export async function deductCredits(
  userId: string,
  cost: number,
  reason: string = "unknown"
): Promise<{ success: boolean; remaining: number }> {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(userId);

  const remaining = await db.runTransaction(async (tx) => {
    const doc = await tx.get(userRef);
    const data = doc.data() || {};

    let currentCredits = data.creditsRemaining ?? data.credits;
    if (typeof currentCredits === "string") currentCredits = parseFloat(currentCredits) || 0;
    currentCredits = currentCredits || 0;

    const newCredits = Math.max(0, currentCredits - cost);

    tx.update(userRef, {
      creditsRemaining: newCredits,
      credits: newCredits,
      totalUsage: FieldValue.increment(cost),
      lastDeductedAt: FieldValue.serverTimestamp(),
    });

    return newCredits;
  });

  console.log(`[Credits] Deducted ${cost} for ${reason} from user ${userId}. Remaining: ${remaining}`);
  return { success: true, remaining };
}
