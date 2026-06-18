// HermesCo, the agent's tools. Every money tool routes through the Treasury,
// so the agent can act autonomously while a human stays in control of the cash.

import type { Proposal } from "./types";
import { createSpend, getState } from "./treasury";
import { runForAgent } from "./sandbox";
import { fulfillJob, quoteJob } from "./jobs";
import { serviceCatalog } from "./services";

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, string>; // name -> short description
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "check_treasury",
    description: "Read the live balance, revenue, expenses, net profit, and the hard caps before acting.",
    parameters: {},
  },
  {
    name: "list_services",
    description:
      "List the real services HermesCo can sell. Each one runs a concrete job and returns a usable deliverable. Most run on your own Fly machine; the GPU sweep rents a REAL cloud GPU from Modal (see each service's runs_on). Read this to pick the right service for the customer's task.",
    parameters: {},
  },
  {
    name: "quote_job",
    description:
      "Quote a real customer job. Pick a `service` (from list_services), pass the customer's `brief` (a URL, a Git repo, or a task to run), and a `price_usd`. This stands up a real Stripe payment link and records the job as quoted. Share the link with the customer; nothing is earned until they pay it.",
    parameters: {
      service: "string (service key from list_services, e.g. web-extract)",
      brief: "string (the customer's task: a URL, a repo, or a command)",
      price_usd: "number (what to charge the customer)",
    },
  },
  {
    name: "deliver_job",
    description:
      "Fulfil a quoted job once the customer has paid. Pass the `job_id` from quote_job. This verifies the real Stripe payment, credits the revenue, runs the real job on the right substrate (your Fly machine, or a REAL rented Modal GPU for GPU jobs), and books the real compute/GPU cost through the Treasury (NemoClaw screens it, hard caps hold). For GPU jobs the cost is Modal's real metered per-second rate. If the spend needs human approval it will say so; approve it in the Treasury, then call deliver_job again.",
    parameters: { job_id: "string (the id returned by quote_job)" },
  },
  {
    name: "propose_spend",
    description:
      "Propose paying a vendor for a tool/SaaS/API you need. Small safe spends auto-approve; bigger ones wait for the human; over-cap or prohibited ones are refused. Always check_treasury first.",
    parameters: { amount_usd: "number", vendor: "string", purpose: "string" },
  },
  {
    name: "run_in_sandbox",
    description:
      "Do real work on YOUR OWN machine, the dedicated, multi-core Fly machine you were spun up on (Python 3.12, Node 22, git, bash). Pass a bash `command` to run (e.g. write+run a script, build a file, clone a repo, call a CLI). Returns the real exit code and stdout. Your machine persists between calls, so files you create stay.",
    parameters: { command: "string (bash command to run on your machine)", task: "string (short label of what this accomplishes)" },
  },
];

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : v == null ? fallback : String(v);
}

export interface ToolOutcome {
  observation: string;
  proposal?: Proposal;
}

export async function executeTool(
  workspaceId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  switch (name) {
    case "check_treasury": {
      const s = await getState(workspaceId);
      return {
        observation: JSON.stringify({
          balance_usd: round(s.balanceUsd),
          revenue_usd: round(s.revenueUsd),
          expense_usd: round(s.expenseUsd),
          net_profit_usd: round(s.netProfitUsd),
          spent_today_usd: round(s.spentTodayUsd),
          caps: {
            max_spend_per_action_usd: s.budget.maxSpendPerActionUsd,
            auto_approve_under_usd: s.budget.autoApproveUnderUsd,
            daily_spend_cap_usd: s.budget.dailySpendCapUsd,
            min_reserve_usd: s.budget.minReserveUsd,
          },
          pending_proposals: s.pendingCount,
        }),
      };
    }

    case "list_services": {
      return { observation: JSON.stringify({ ok: true, services: serviceCatalog() }) };
    }

    case "quote_job": {
      const service = str(args.service, "");
      const brief = str(args.brief, "");
      const price = num(args.price_usd, 0);
      try {
        const job = await quoteJob(workspaceId, { service, brief, priceUsd: price });
        return {
          observation: JSON.stringify({
            ok: true,
            job_id: job.id,
            service: job.service,
            service_name: job.serviceName,
            brief: job.brief,
            price_usd: job.priceUsd,
            payment_link: job.paymentLinkUrl,
            status: job.status,
            next: "Share payment_link with the customer. Once they pay it, call deliver_job with this job_id to fulfil the work and book the revenue.",
          }),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { observation: JSON.stringify({ ok: false, error: msg }) };
      }
    }

    case "deliver_job": {
      const jobId = str(args.job_id, "");
      if (!jobId.trim()) {
        return {
          observation: JSON.stringify({
            ok: false,
            error: "Pass the job_id from quote_job.",
          }),
        };
      }
      try {
        const r = await fulfillJob(workspaceId, jobId);
        return {
          proposal: r.spend,
          observation: JSON.stringify({
            ok: r.outcome === "delivered",
            outcome: r.outcome,
            job_id: r.job.id,
            status: r.job.status,
            customer: r.job.customer ?? null,
            price_usd: r.job.priceUsd,
            compute_cost_usd: r.job.computeCostUsd ?? null,
            net_profit_usd:
              r.job.computeCostUsd != null ? round(r.job.priceUsd - r.job.computeCostUsd) : null,
            machine_id: r.job.machineId ?? null,
            deliverable: r.job.deliverable ?? null,
            message: r.message,
          }),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { observation: JSON.stringify({ ok: false, error: msg }) };
      }
    }

    case "propose_spend": {
      const amount = num(args.amount_usd, 0);
      const vendor = str(args.vendor, "vendor");
      const purpose = str(args.purpose, "tooling");
      const proposal = await createSpend(workspaceId, {
        title: purpose,
        amountUsd: amount,
        vendor,
        purpose,
      });
      const human =
        proposal.status === "pending"
          ? "AWAITING HUMAN APPROVAL. Pause and tell the human what you need and why."
          : proposal.status === "denied"
            ? "REFUSED by the Treasury. Do not retry this spend."
            : proposal.status === "executed"
              ? "AUTO-APPROVED and paid."
              : proposal.status === "failed"
                ? "FAILED a hard cap. Do not retry."
                : proposal.status;
      return {
        proposal,
        observation: JSON.stringify({
          proposal_id: proposal.id,
          amount_usd: amount,
          vendor,
          status: proposal.status,
          risk: proposal.risk,
          reason: proposal.safetyReason || proposal.error || "",
          next: human,
        }),
      };
    }

    case "run_in_sandbox": {
      const command = str(args.command, str(args.task, ""));
      const task = str(args.task, "");
      if (!command.trim()) {
        return {
          observation: JSON.stringify({
            ok: false,
            error: "No command provided. Pass a bash `command` to run in the sandbox.",
          }),
        };
      }
      try {
        const run = await runForAgent(workspaceId, command, { goal: task });
        return {
          observation: JSON.stringify({
            ok: run.ok,
            substrate: run.substrate,
            machine_id: run.sandboxId,
            task,
            command: run.command,
            exit_code: run.exitCode,
            duration_ms: run.durationMs,
            output: run.output,
          }),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          observation: JSON.stringify({
            ok: false,
            error: `Execution substrate unavailable: ${msg}`,
          }),
        };
      }
    }

    default:
      return { observation: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
