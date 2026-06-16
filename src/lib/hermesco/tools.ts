// HermesCo — the agent's tools. Every money tool routes through the Treasury,
// so the agent can act autonomously while a human stays in control of the cash.

import type { Proposal } from "./types";
import { createEarn, createSpend, getState } from "./treasury";
import { createOffer } from "./stripe-skills";
import { runInSandbox } from "./sandbox";

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
    name: "create_offer",
    description: "Stand up a sellable offer: a Stripe product + price + shareable payment link. Use this to start earning.",
    parameters: { product_name: "string", price_usd: "number" },
  },
  {
    name: "collect_payment",
    description: "Take a customer payment for delivered work (Stripe test mode). Records revenue.",
    parameters: { amount_usd: "number", customer: "string", description: "string" },
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
      "Do real work on the HermesCo execution substrate: a fresh, isolated Daytona Linux sandbox. Pass a bash `command` to run (e.g. write+run a Python script, build a file, call a CLI). Returns the real exit code and stdout.",
    parameters: { command: "string (bash command to run)", task: "string (short label of what this accomplishes)" },
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

    case "create_offer": {
      const productName = str(args.product_name, "HermesCo Service");
      const price = num(args.price_usd, 0);
      try {
        const offer = await createOffer(productName, price);
        return {
          observation: JSON.stringify({
            ok: true,
            product: productName,
            price_usd: price,
            payment_link: offer.paymentLinkUrl,
            stripe: offer.kind,
          }),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { observation: JSON.stringify({ ok: false, error: msg }) };
      }
    }

    case "collect_payment": {
      const amount = num(args.amount_usd, 0);
      const customer = str(args.customer, "customer");
      const description = str(args.description, "Delivered work");
      const proposal = await createEarn(workspaceId, {
        title: description,
        amountUsd: amount,
        counterparty: customer,
        description,
      });
      const s = await getState(workspaceId);
      return {
        proposal,
        observation: JSON.stringify({
          ok: proposal.status === "executed",
          recorded_revenue_usd: amount,
          new_balance_usd: round(s.balanceUsd),
          net_profit_usd: round(s.netProfitUsd),
          stripe_ref: proposal.stripeRef,
        }),
      };
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
          ? "AWAITING HUMAN APPROVAL — pause and tell the human what you need and why."
          : proposal.status === "denied"
            ? "REFUSED by the Treasury — do not retry this spend."
            : proposal.status === "executed"
              ? "AUTO-APPROVED and paid."
              : proposal.status === "failed"
                ? "FAILED a hard cap — do not retry."
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
        const run = await runInSandbox(command);
        return {
          observation: JSON.stringify({
            ok: run.ok,
            substrate: "daytona",
            sandbox_id: run.sandboxId,
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
            substrate: "daytona",
            error: `Sandbox unavailable: ${msg}`,
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
