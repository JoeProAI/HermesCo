// HermesCo - the Treasury. Human-in-the-loop money control.
//
// Flow: the agent proposes a money move → it is screened (NemoClaw) and gated by
// hard caps → small, safe spends auto-approve; bigger ones wait for a human tap;
// over-cap or prohibited ones are refused outright. Execution re-checks every
// hard cap (per-action, daily, min-reserve) so even a human-approved move can
// never drop the business below its floor. That is the "can't lose money"
// guarantee, enforced in code rather than promised in a prompt.

import { randomUUID } from "node:crypto";
import type {
  Budget,
  LedgerEntry,
  Proposal,
  ProposalType,
  TreasuryState,
} from "./types";
import {
  appendLedger,
  clearWorkspace,
  getBudget,
  getProposal,
  listLedger,
  listProposals,
  putProposal,
  recordDepositOnce,
  setBudget,
  storageBackend,
} from "./store";
import { screenSpend } from "./safety";
import { listOfferPayments, stripeMode } from "./stripe-skills";

// Starts at $0 - the Treasury holds only real, deposited capital plus what the
// agent actually earns. No seeded money. The human funds it via Stripe deposit.
export const DEFAULT_BUDGET: Budget = {
  startingCapitalUsd: 0,
  maxSpendPerActionUsd: 50,
  autoApproveUnderUsd: 10,
  dailySpendCapUsd: 100,
  minReserveUsd: 20,
};

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export async function ensureWorkspace(id: string): Promise<Budget> {
  const existing = await getBudget(id);
  if (existing) return existing;
  await setBudget(id, DEFAULT_BUDGET);
  return DEFAULT_BUDGET;
}

export async function getState(id: string): Promise<TreasuryState> {
  const budget = await ensureWorkspace(id);
  const [proposals, ledger] = await Promise.all([listProposals(id), listLedger(id)]);

  proposals.sort((a, b) => b.createdAt - a.createdAt);
  ledger.sort((a, b) => b.at - a.at);

  let depositsUsd = 0;
  let revenueUsd = 0;
  let expenseUsd = 0;
  let spentTodayUsd = 0;
  const today = startOfTodayMs();
  for (const e of ledger) {
    if (e.type === "deposit") {
      depositsUsd += e.amountUsd;
    } else if (e.amountUsd >= 0) {
      revenueUsd += e.amountUsd;
    } else {
      expenseUsd += -e.amountUsd;
      if (e.at >= today) spentTodayUsd += -e.amountUsd;
    }
  }
  const balanceUsd = budget.startingCapitalUsd + depositsUsd + revenueUsd - expenseUsd;

  return {
    workspaceId: id,
    budget,
    balanceUsd,
    depositsUsd,
    revenueUsd,
    expenseUsd,
    netProfitUsd: revenueUsd - expenseUsd,
    spentTodayUsd,
    pendingCount: proposals.filter((p) => p.status === "pending").length,
    proposals,
    ledger,
    stripeMode: stripeMode(),
    backend: storageBackend(),
  };
}

function newProposal(base: Omit<Proposal, "id" | "createdAt">): Proposal {
  return { ...base, id: `prop_${randomUUID().slice(0, 8)}`, createdAt: Date.now() };
}

// EARN - credit ONLY the real revenue Stripe confirms was collected on an offer's
// Payment Link. Idempotent on the Stripe checkout-session id, so re-running never
// double-counts. No fabricated charge: money must really have been paid in.
export async function collectOfferRevenue(
  id: string,
  paymentLinkId: string,
): Promise<{ newRevenueUsd: number; creditedCount: number; state: TreasuryState }> {
  await ensureWorkspace(id);
  const paid = await listOfferPayments(paymentLinkId);
  const ledger = await listLedger(id);
  const seen = new Set(ledger.map((e) => e.stripeRef).filter(Boolean));

  let newRevenueUsd = 0;
  let creditedCount = 0;
  for (const pmt of paid) {
    if (seen.has(pmt.sessionId)) continue;
    const entry: LedgerEntry = {
      id: `led_${randomUUID().slice(0, 8)}`,
      workspaceId: id,
      type: "earn",
      amountUsd: Math.max(0, pmt.amountUsd),
      description: pmt.customer ? `Customer payment from ${pmt.customer}` : "Customer payment",
      stripeRef: pmt.sessionId,
      at: Date.now(),
    };
    await appendLedger(entry);
    newRevenueUsd += entry.amountUsd;
    creditedCount += 1;
  }
  return { newRevenueUsd, creditedCount, state: await getState(id) };
}

// SPEND - screened + gated. Auto-approves only small, safe spends.
export async function createSpend(
  id: string,
  input: { title: string; amountUsd: number; vendor: string; purpose: string },
): Promise<Proposal> {
  const budget = await ensureWorkspace(id);
  const amountUsd = Math.max(0, input.amountUsd);
  const verdict = await screenSpend({
    amountUsd,
    vendor: input.vendor,
    purpose: input.purpose,
    budget,
  });

  const base = {
    workspaceId: id,
    type: "spend" as ProposalType,
    title: input.title,
    description: input.purpose,
    amountUsd,
    counterparty: input.vendor,
    risk: verdict.risk,
    safetyReason: verdict.reason,
  };

  if (verdict.risk === "blocked") {
    const p = newProposal({
      ...base,
      status: "denied",
      autoApproved: false,
      decidedAt: Date.now(),
      decidedBy: "policy",
    });
    await putProposal(p);
    return p;
  }

  const autoOk = verdict.risk === "safe" && amountUsd < budget.autoApproveUnderUsd;
  if (autoOk) {
    const p = newProposal({
      ...base,
      status: "approved",
      autoApproved: true,
      decidedAt: Date.now(),
      decidedBy: "policy",
    });
    await putProposal(p);
    return executeProposal(id, p);
  }

  // Needs a human tap.
  const p = newProposal({ ...base, status: "pending", autoApproved: false });
  await putProposal(p);
  return p;
}

export async function decide(
  id: string,
  proposalId: string,
  decision: "approve" | "deny",
  operator?: string,
): Promise<Proposal | null> {
  const p = await getProposal(id, proposalId);
  if (!p || p.status !== "pending") return p;

  const by = operator?.trim() || "human";

  if (decision === "deny") {
    const denied: Proposal = { ...p, status: "denied", decidedAt: Date.now(), decidedBy: by };
    await putProposal(denied);
    return denied;
  }

  const approved: Proposal = { ...p, status: "approved", decidedAt: Date.now(), decidedBy: by };
  await putProposal(approved);
  return executeProposal(id, approved);
}

// SPEND execution. Defense-in-depth: re-check every hard cap at execution time,
// so even a human-approved move can never breach the "can't lose money" floor.
async function executeProposal(id: string, p: Proposal): Promise<Proposal> {
  if (p.status !== "approved") return p;
  const state = await getState(id);
  const { budget, balanceUsd, spentTodayUsd } = state;

  const fail = (reason: string): Proposal => ({ ...p, status: "failed", error: reason });
  if (p.amountUsd > budget.maxSpendPerActionUsd) {
    const f = fail(`Refused: exceeds per-action hard cap ($${budget.maxSpendPerActionUsd}).`);
    await putProposal(f);
    return f;
  }
  if (spentTodayUsd + p.amountUsd > budget.dailySpendCapUsd) {
    const f = fail(`Refused: would breach the daily spend cap ($${budget.dailySpendCapUsd}).`);
    await putProposal(f);
    return f;
  }
  if (balanceUsd - p.amountUsd < budget.minReserveUsd) {
    const f = fail(`Refused: would drop below the minimum reserve ($${budget.minReserveUsd}).`);
    await putProposal(f);
    return f;
  }

  try {
    // A spend debits the Treasury's REAL deposited capital. The signed ledger
    // entry is the source of truth - no fabricated Stripe charge, no test card.
    const entry: LedgerEntry = {
      id: `led_${randomUUID().slice(0, 8)}`,
      workspaceId: id,
      proposalId: p.id,
      type: "spend",
      amountUsd: -p.amountUsd,
      description: `${p.title} (${p.counterparty})`,
      at: Date.now(),
    };
    await appendLedger(entry);

    const executed: Proposal = { ...p, status: "executed", executedAt: Date.now() };
    await putProposal(executed);
    return executed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failed: Proposal = { ...p, status: "failed", error: `Execution error: ${msg}` };
    await putProposal(failed);
    return failed;
  }
}

// DEPOSIT - record real capital the human added via Stripe Checkout. Idempotent
// on the Stripe ref so a page refresh or webhook retry can't double-credit.
export async function recordDeposit(
  id: string,
  input: { amountUsd: number; stripeRef: string; description?: string },
): Promise<{ duplicate: boolean; entry?: LedgerEntry; state: TreasuryState }> {
  await ensureWorkspace(id);
  const entry: LedgerEntry = {
    id: `led_dep_${randomUUID().slice(0, 8)}`,
    workspaceId: id,
    type: "deposit",
    amountUsd: Math.max(0, input.amountUsd),
    description: input.description || "Treasury deposit",
    stripeRef: input.stripeRef,
    at: Date.now(),
  };
  const { duplicate } = await recordDepositOnce(entry, input.stripeRef);
  if (duplicate) {
    return { duplicate: true, state: await getState(id) };
  }
  return { duplicate: false, entry, state: await getState(id) };
}

export async function resetWorkspace(id: string, budget?: Budget): Promise<TreasuryState> {
  await clearWorkspace(id);
  await setBudget(id, budget ?? DEFAULT_BUDGET);
  return getState(id);
}

export function backend(): "convex" | "memory" {
  return storageBackend();
}
