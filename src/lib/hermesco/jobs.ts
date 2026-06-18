// HermesCo - the Job Desk. This is the real business: HermesCo sells units of
// compute work. A customer (a person, or another agent) brings a brief; Hermes
// quotes it as a real Stripe payment link; the customer pays; Hermes spends real
// compute (screened by NemoClaw, held to the Treasury hard caps) to provision a
// Fly machine, runs the real job on it, returns the real deliverable, and books
// profit = price minus compute cost.
//
// Every step is real: Stripe creates the link and confirms payment, the work
// runs on an actual Fly machine, and the compute spend is a real Treasury entry.
// Nothing is simulated.

import { randomUUID } from "node:crypto";
import type { Job, Proposal } from "./types";
import { getJob, getProposal, listJobs as storeListJobs, putJob } from "./store";
import { createOffer, listOfferPayments } from "./stripe-skills";
import { collectOfferRevenue, createSpend } from "./treasury";
import { runForAgent } from "./sandbox";
import { getService, SERVICES } from "./services";
import { AGENT_SPEC } from "./fly";

const COMPUTE_USD_PER_MIN = Number(process.env.HERMESCO_COMPUTE_USD_PER_MIN) || 0.0016;
// Each job reserves a dedicated compute window on the agent's Fly machine. We
// book that real, labelled Fly cost as a Treasury spend before running. Fly bills
// for the machine while it exists, so this is a genuine cost, not a markup.
const JOB_RESERVED_MIN = Math.max(1, Number(process.env.HERMESCO_JOB_RESERVED_MIN) || 60);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeCostForJob(): number {
  return Math.max(0.01, round2(JOB_RESERVED_MIN * COMPUTE_USD_PER_MIN));
}

function trimBrief(brief: string, max = 60): string {
  const one = brief.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}...` : one;
}

export type FulfillOutcome =
  | "awaiting_payment"
  | "awaiting_spend_approval"
  | "spend_refused"
  | "delivered"
  | "failed";

export interface FulfillResult {
  job: Job;
  outcome: FulfillOutcome;
  message: string;
  spend?: Proposal;
}

// QUOTE - stand up a real Stripe payment link for a real service + brief, and
// record the job on the order book as "quoted". No money has moved yet.
export async function quoteJob(
  workspaceId: string,
  input: { service: string; brief: string; priceUsd: number },
): Promise<Job> {
  const svc = getService(input.service);
  if (!svc) {
    throw new Error(
      `Unknown service "${input.service}". Available: ${SERVICES.map((s) => s.key).join(", ")}.`,
    );
  }
  const brief = String(input.brief ?? "").trim();
  if (!brief) throw new Error(`The brief is required (${svc.briefLabel}).`);
  const priceUsd = Math.max(1, round2(input.priceUsd || svc.suggestedPriceUsd));

  const productName = `HermesCo ${svc.name}: ${trimBrief(brief)}`;
  const offer = await createOffer(productName, priceUsd);

  const job: Job = {
    id: `job_${randomUUID().slice(0, 8)}`,
    workspaceId,
    service: svc.key,
    serviceName: svc.name,
    brief,
    priceUsd,
    paymentLinkId: offer.ref,
    paymentLinkUrl: offer.paymentLinkUrl,
    status: "quoted",
    createdAt: Date.now(),
  };
  await putJob(job);
  return job;
}

// Idempotently make sure the job's compute is paid for through the Treasury, so
// every provisioning spend is NemoClaw-screened and held to the hard caps.
async function ensureComputeSpend(
  workspaceId: string,
  job: Job,
): Promise<{ ok: boolean; pending: boolean; spend: Proposal | null; costUsd: number }> {
  const costUsd = computeCostForJob();

  if (job.spendProposalId) {
    const existing = await getProposal(workspaceId, job.spendProposalId);
    if (existing) {
      if (existing.status === "executed" || existing.status === "approved") {
        return { ok: true, pending: false, spend: existing, costUsd: existing.amountUsd };
      }
      if (existing.status === "pending") {
        return { ok: false, pending: true, spend: existing, costUsd: existing.amountUsd };
      }
      // denied / failed - fall through and re-propose (e.g. caps later relaxed)
    }
  }

  const spend = await createSpend(workspaceId, {
    title: `Compute for ${job.serviceName}`,
    amountUsd: costUsd,
    vendor: "Fly.io",
    purpose: `Reserve a ${AGENT_SPEC.cpus} vCPU / ${Math.round(
      AGENT_SPEC.memoryMb / 1024,
    )} GB machine for ${JOB_RESERVED_MIN} min to run job ${job.id} (${job.serviceName}).`,
  });
  job.spendProposalId = spend.id;
  await putJob(job);

  if (spend.status === "executed" || spend.status === "approved") {
    return { ok: true, pending: false, spend, costUsd };
  }
  if (spend.status === "pending") {
    return { ok: false, pending: true, spend, costUsd };
  }
  return { ok: false, pending: false, spend, costUsd };
}

// FULFILL - the real delivery pipeline. Verifies payment, credits the revenue,
// books the compute spend, runs the job on the Fly machine, returns the
// deliverable. Idempotent: safe to call repeatedly (e.g. after a human approves
// the compute spend, or to retry a failed run).
export async function fulfillJob(workspaceId: string, jobId: string): Promise<FulfillResult> {
  const job = await getJob(workspaceId, jobId);
  if (!job) throw new Error(`Job ${jobId} not found.`);

  if (job.status === "delivered") {
    return { job, outcome: "delivered", message: "Job already delivered." };
  }

  // 1. Confirm the customer actually paid the Stripe link, then credit revenue.
  if (job.status === "quoted") {
    const payments = await listOfferPayments(job.paymentLinkId);
    if (payments.length === 0) {
      return {
        job,
        outcome: "awaiting_payment",
        message: "No paid Stripe payment on this job's link yet. Share the link with the customer.",
      };
    }
    await collectOfferRevenue(workspaceId, job.paymentLinkId);
    const paid = payments[0];
    job.status = "paid";
    job.customer = paid.customer ?? undefined;
    job.stripeSessionId = paid.sessionId;
    job.paidAt = Date.now();
    await putJob(job);
  }

  // 2. Spend real compute to provision the machine (screened + capped).
  const svc = getService(job.service);
  if (!svc) {
    job.status = "failed";
    job.error = `Service "${job.service}" is no longer available.`;
    await putJob(job);
    return { job, outcome: "failed", message: job.error };
  }

  const compute = await ensureComputeSpend(workspaceId, job);
  if (compute.pending) {
    job.status = "paid";
    await putJob(job);
    return {
      job,
      outcome: "awaiting_spend_approval",
      message: `Compute spend of $${compute.costUsd.toFixed(
        2,
      )} is awaiting human approval in the Treasury. Approve it, then deliver again.`,
      spend: compute.spend ?? undefined,
    };
  }
  if (!compute.ok) {
    job.status = "paid";
    job.error = compute.spend?.safetyReason || compute.spend?.error || "Compute spend refused.";
    await putJob(job);
    return {
      job,
      outcome: "spend_refused",
      message: `Compute spend refused by the Treasury: ${job.error}`,
      spend: compute.spend ?? undefined,
    };
  }

  // 3. Run the real job on the agent's Fly machine.
  job.status = "delivering";
  job.computeCostUsd = compute.costUsd;
  await putJob(job);

  const run = await runForAgent(workspaceId, svc.buildCommand(job.brief), {
    goal: `job ${job.id}: ${svc.name}`,
    timeoutSec: 120,
  });

  job.machineId = run.sandboxId;
  job.deliverable = run.output;
  const artifact = /ARTIFACT:(\S+)/.exec(run.output);
  if (artifact) job.artifactPath = artifact[1];

  if (run.ok) {
    job.status = "delivered";
    job.error = undefined;
    job.deliveredAt = Date.now();
    await putJob(job);
    return {
      job,
      outcome: "delivered",
      message: `Delivered on ${run.substrate} (${run.durationMs} ms). Net profit on this job: $${(
        job.priceUsd - (job.computeCostUsd ?? 0)
      ).toFixed(2)}.`,
      spend: compute.spend ?? undefined,
    };
  }

  job.status = "failed";
  job.error = `Job execution returned exit code ${run.exitCode ?? "unknown"}.`;
  job.deliveredAt = Date.now();
  await putJob(job);
  return { job, outcome: "failed", message: job.error, spend: compute.spend ?? undefined };
}

export async function listJobs(workspaceId: string): Promise<Job[]> {
  const jobs = await storeListJobs(workspaceId);
  return jobs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getJobById(workspaceId: string, jobId: string): Promise<Job | null> {
  return getJob(workspaceId, jobId);
}
