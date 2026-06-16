/**
 * Launchpad usage tracking — active hours per billing cycle, pooled credit burn.
 */

import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {
  LAUNCHPAD_PLANS,
  LaunchpadPlanId,
  LaunchpadProduct,
} from "@/lib/launchpad/plans";
import { deleteWorkspaceFly, statusOfFly } from "@/lib/launchpad/fly";
import {
  createUserKey,
  deleteUserKey,
  resetUserKeyLimit,
  LaunchpadUserKey,
} from "@/lib/launchpad/openrouter";

export interface LaunchpadWorkspaceRecord {
  /** Fly app name, e.g. lp-hermes-3dvgcodv */
  flyApp: string;
  /** Fly machine ID inside the app */
  flyMachineId: string;
  /** Public dashboard URL (https://<flyApp>.fly.dev or branded *.clawd.run CNAME) */
  previewUrl: string;
  startedAt: string;
  lastActiveAt: string;
  lastTickAt?: string;
  status: "starting" | "running" | "stopping" | "stopped" | "error";
  /** Legacy: pre-Fly Daytona sandbox ID. Kept optional for migration. */
  sandboxId?: string;
}

export interface LaunchpadUserDoc {
  plan?: LaunchpadPlanId;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  cycleStart?: string; // ISO
  cycleEnd?: string; // ISO
  hoursUsedThisCycle: number; // float
  hoursCap: number;
  pooledCreditUsdRemaining: number;
  pooledCreditUsdCap: number;
  workspaces: Partial<Record<LaunchpadProduct, LaunchpadWorkspaceRecord>>;
  softCapNotified?: boolean;
  hardStopped?: boolean;
  byok?: unknown; // see byok.ts
  /** OpenRouter sub-key for this user. Created on first subscription,
   *  deleted on cancellation. Limit is enforced by OpenRouter, not us. */
  openrouterKey?: LaunchpadUserKey;
  inferenceExhausted?: boolean;
  /** True when running on the user's own provider sub (BYOK or connected). */
  connectedSub?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const DEFAULT_DOC: LaunchpadUserDoc = {
  hoursUsedThisCycle: 0,
  hoursCap: 0,
  pooledCreditUsdRemaining: 0,
  pooledCreditUsdCap: 0,
  workspaces: {},
};

export async function getLaunchpadUser(userId: string): Promise<LaunchpadUserDoc> {
  const snap = await getAdminDb()
    .collection("launchpad_users")
    .doc(userId)
    .get();
  if (!snap.exists) return { ...DEFAULT_DOC };
  return { ...DEFAULT_DOC, ...(snap.data() as LaunchpadUserDoc) };
}

export async function reconcileLaunchpadPlanEntitlements(
  userId: string,
  doc: LaunchpadUserDoc
): Promise<LaunchpadUserDoc> {
  if (!doc.plan) return doc;
  const plan = LAUNCHPAD_PLANS[doc.plan];
  if (!plan) return doc;

  const currentCap = doc.pooledCreditUsdCap ?? 0;
  const currentRemaining = doc.pooledCreditUsdRemaining ?? 0;
  const targetCap = plan.pooledCreditUsd;
  const targetHoursCap = plan.hoursCap;

  const usedFromCurrentCap = Math.max(0, currentCap - currentRemaining);
  const reconciledRemaining = Math.max(0, round2(targetCap - usedFromCurrentCap));

  let nextOpenrouterKey = doc.openrouterKey;
  const needsOpenrouterLimitFix =
    !!nextOpenrouterKey && nextOpenrouterKey.limitUsd !== targetCap;

  if (
    doc.hoursCap === targetHoursCap &&
    currentCap === targetCap &&
    (!needsOpenrouterLimitFix || !nextOpenrouterKey)
  ) {
    return doc;
  }

  if (needsOpenrouterLimitFix && nextOpenrouterKey) {
    try {
      await resetUserKeyLimit(nextOpenrouterKey.hash, targetCap);
      nextOpenrouterKey = { ...nextOpenrouterKey, limitUsd: targetCap };
    } catch (err) {
      console.warn(
        `[launchpad/usage] OpenRouter sub-key reconcile failed for ${userId}:`,
        err
      );
    }
  }

  await getAdminDb()
    .collection("launchpad_users")
    .doc(userId)
    .set(
      {
        hoursCap: targetHoursCap,
        pooledCreditUsdCap: targetCap,
        pooledCreditUsdRemaining: reconciledRemaining,
        ...(nextOpenrouterKey ? { openrouterKey: nextOpenrouterKey } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return {
    ...doc,
    hoursCap: targetHoursCap,
    pooledCreditUsdCap: targetCap,
    pooledCreditUsdRemaining: reconciledRemaining,
    ...(nextOpenrouterKey ? { openrouterKey: nextOpenrouterKey } : {}),
  };
}

export async function setLaunchpadPlan(
  userId: string,
  planId: LaunchpadPlanId,
  stripe: {
    customerId?: string | null;
    subscriptionId?: string | null;
    priceId?: string | null;
  }
): Promise<void> {
  const plan = LAUNCHPAD_PLANS[planId];
  const cycleStart = new Date();
  const cycleEnd = new Date(cycleStart);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1);

  // Reuse existing OpenRouter sub-key if the user already has one (upgrade
  // path: only adjust the limit). Otherwise mint a new key with the plan's
  // pooledCreditUsd as the hard cap.
  const existing = await getLaunchpadUser(userId);
  let openrouterKey: LaunchpadUserKey | undefined = existing.openrouterKey;
  try {
    if (openrouterKey) {
      if (openrouterKey.limitUsd !== plan.pooledCreditUsd) {
        await resetUserKeyLimit(openrouterKey.hash, plan.pooledCreditUsd);
        openrouterKey = { ...openrouterKey, limitUsd: plan.pooledCreditUsd };
      }
    } else {
      openrouterKey = await createUserKey(userId, plan.pooledCreditUsd);
    }
  } catch (err) {
    // Don't block subscription activation on OpenRouter API hiccups —
    // but note the provisioner refuses to launch a machine without a
    // sub-key (no pool fallback), so this must be backfilled before the
    // user can launch. Log loudly.
    console.error(
      `[launchpad/usage] OpenRouter sub-key mint failed for ${userId}:`,
      err
    );
  }

  await getAdminDb()
    .collection("launchpad_users")
    .doc(userId)
    .set(
      {
        plan: planId,
        stripeCustomerId: stripe.customerId ?? null,
        stripeSubscriptionId: stripe.subscriptionId ?? null,
        stripePriceId: stripe.priceId ?? null,
        cycleStart: cycleStart.toISOString(),
        cycleEnd: cycleEnd.toISOString(),
        hoursUsedThisCycle: 0,
        hoursCap: plan.hoursCap,
        pooledCreditUsdRemaining: plan.pooledCreditUsd,
        pooledCreditUsdCap: plan.pooledCreditUsd,
        softCapNotified: false,
        hardStopped: false,
        ...(openrouterKey ? { openrouterKey } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

export async function ensureUserKey(
  userId: string,
  planId: LaunchpadPlanId
): Promise<void> {
  const existing = await getLaunchpadUser(userId);
  if (existing.openrouterKey) return; // already has a hard-capped sub-key
  const plan = LAUNCHPAD_PLANS[planId];
  try {
    const openrouterKey = await createUserKey(userId, plan.pooledCreditUsd);
    await getAdminDb()
      .collection("launchpad_users")
      .doc(userId)
      .set({ openrouterKey }, { merge: true });
  } catch (err) {
    // The provisioner refuses to launch without a sub-key (no pool
    // fallback), so a failure here must be backfilled before the user can
    // launch. Log loudly.
    console.error(
      `[launchpad/usage] ensureUserKey mint failed for ${userId}:`,
      err
    );
  }
}

export async function clearLaunchpadPlan(userId: string): Promise<void> {
  // Tear down each product's Fly app so we don't leave paying machines
  // running after a subscription cancellation.
  const user = await getLaunchpadUser(userId);
  for (const product of ["hermes", "openclaw"] as LaunchpadProduct[]) {
    const ws = user.workspaces?.[product];
    if (!ws?.flyApp) continue;
    try {
      await deleteWorkspaceFly(ws.flyApp);
    } catch (err) {
      console.warn(
        `[launchpad/usage] fly app cleanup failed for ${userId}/${product}`,
        err
      );
    }
  }

  // Revoke the OpenRouter sub-key so we don't accumulate orphan keys.
  if (user.openrouterKey?.hash) {
    try {
      await deleteUserKey(user.openrouterKey.hash);
    } catch (err) {
      console.warn(
        `[launchpad/usage] OpenRouter sub-key revoke failed for ${userId}:`,
        err
      );
    }
  }

  await getAdminDb()
    .collection("launchpad_users")
    .doc(userId)
    .set(
      {
        plan: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        hoursCap: 0,
        pooledCreditUsdRemaining: 0,
        workspaces: {},
        openrouterKey: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

export async function recordWorkspaceStart(
  userId: string,
  product: LaunchpadProduct,
  record: LaunchpadWorkspaceRecord
): Promise<void> {
  await getAdminDb()
    .collection("launchpad_users")
    .doc(userId)
    .set(
      {
        workspaces: { [product]: record },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

export async function reconcileWorkspaceStates(
  doc: LaunchpadUserDoc
): Promise<LaunchpadUserDoc> {
  // Reflect Fly's actual machine state in the displayed status so the dashboard
  // doesn't show a self-slept ("stopped") machine as "running". statusOfFly is
  // a Fly API call -- it does NOT touch the machine, so it never wakes it.
  // statusOfFly == null is ambiguous (transient vs deleted), so leave the last
  // known status alone in that case; the Stop button clears genuine ghosts.
  const ws = doc.workspaces || {};
  let changed = false;
  const out: Partial<Record<LaunchpadProduct, LaunchpadWorkspaceRecord>> = {};
  for (const product of Object.keys(ws) as LaunchpadProduct[]) {
    const w = ws[product];
    if (!w) continue;
    out[product] = w;
    if (!w.flyApp || !w.flyMachineId) continue;
    try {
      const st = await statusOfFly(w.flyApp, w.flyMachineId);
      let status = w.status;
      if (st?.state === "started") status = "running";
      else if (st?.state) status = "stopped";
      if (status !== w.status) {
        out[product] = { ...w, status };
        changed = true;
      }
    } catch {
      // transient Fly error -> keep the last-known status
    }
  }
  return changed ? { ...doc, workspaces: out } : doc;
}

export async function recordWorkspaceStop(
  userId: string,
  product: LaunchpadProduct
): Promise<void> {
  await getAdminDb()
    .collection("launchpad_users")
    .doc(userId)
    .set(
      {
        workspaces: { [product]: FieldValue.delete() },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/**
 * Add `deltaHours` to the user's used pool. Marks softCapNotified at 80%
 * and hardStopped at 100%.
 */
export async function addHours(
  userId: string,
  deltaHours: number
): Promise<{
  hoursUsedThisCycle: number;
  hoursCap: number;
  shouldSoftWarn: boolean;
  shouldHardStop: boolean;
}> {
  const ref = getAdminDb().collection("launchpad_users").doc(userId);
  return getAdminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const doc = { ...DEFAULT_DOC, ...(snap.data() as LaunchpadUserDoc) };
    const next = Math.max(0, doc.hoursUsedThisCycle + deltaHours);
    const pct = doc.hoursCap > 0 ? next / doc.hoursCap : 0;
    const shouldSoftWarn = pct >= 0.8 && !doc.softCapNotified;
    const shouldHardStop = pct >= 1.0;
    tx.set(
      ref,
      {
        hoursUsedThisCycle: next,
        softCapNotified: doc.softCapNotified || shouldSoftWarn,
        hardStopped: doc.hardStopped || shouldHardStop,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      hoursUsedThisCycle: next,
      hoursCap: doc.hoursCap,
      shouldSoftWarn,
      shouldHardStop,
    };
  });
}

/** Format a launchpad doc for safe client display. */
export function publicView(doc: LaunchpadUserDoc) {
  return {
    plan: doc.plan ?? null,
    hoursUsedThisCycle: round2(doc.hoursUsedThisCycle),
    hoursCap: doc.hoursCap,
    pooledCreditUsdRemaining: round2(doc.pooledCreditUsdRemaining),
    pooledCreditUsdCap: doc.pooledCreditUsdCap,
    cycleStart: doc.cycleStart ?? null,
    cycleEnd: doc.cycleEnd ?? null,
    softCapNotified: !!doc.softCapNotified,
    hardStopped: !!doc.hardStopped,
    workspaces: Object.fromEntries(
      Object.entries(doc.workspaces || {}).map(([k, v]) => [
        k,
        v
          ? {
              previewUrl: v.previewUrl,
              startedAt: v.startedAt,
              lastActiveAt: v.lastActiveAt,
              status: v.status,
            }
          : null,
      ])
    ),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
