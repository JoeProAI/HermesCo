// HermesCo, the agent loop. Hermes 4 405B (Nous) drives the business via a
// native <tool_call> text protocol parsed server-side; NVIDIA Nemotron screens
// every spend underneath (see safety.ts). The loop pauses the moment a spend
// needs a human, surfacing the proposal to the Treasury console.

import type { AgentEvent, AgentTurnResult } from "./types";
import { chatComplete, ChatMessage, HERMES_MODEL } from "./models";
import { TOOL_SPECS, executeTool } from "./tools";
import { getState } from "./treasury";

const MAX_STEPS = 6;

interface ParsedCall {
  name: string;
  arguments: Record<string, unknown>;
}

function parseToolCalls(content: string): ParsedCall[] {
  const calls: ParsedCall[] = [];
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const parsed = tryParse(m[1]);
    if (parsed) calls.push(parsed);
  }
  if (calls.length === 0) {
    // tolerate an unterminated final block
    const open = content.indexOf("<tool_call>");
    if (open !== -1) {
      const parsed = tryParse(content.slice(open + "<tool_call>".length));
      if (parsed) calls.push(parsed);
    }
  }
  return calls;
}

function tryParse(raw: string): ParsedCall | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1)) as {
      name?: unknown;
      arguments?: unknown;
    };
    if (typeof obj.name !== "string") return null;
    const args =
      obj.arguments && typeof obj.arguments === "object"
        ? (obj.arguments as Record<string, unknown>)
        : {};
    return { name: obj.name, arguments: args };
  } catch {
    return null;
  }
}

// Strip protocol scaffolding so the human only ever sees clean prose: remove
// reasoning blocks, well-formed tool calls, and any dangling/unterminated tags
// (Hermes sometimes wraps a final answer in a stray <tool_call> opener).
function cleanText(content: string): string {
  let s = content;
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  s = s.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  s = s.replace(/<tool_response[^>]*>[\s\S]*?<\/tool_response>/gi, "");
  s = s.replace(/<\/?(?:tool_call|think|tool_response)[^>]*>/gi, "");
  return s.trim();
}

function systemPrompt(treasurySnapshot: string): string {
  const tools = TOOL_SPECS.map(
    (t) =>
      `{"name":"${t.name}","description":"${t.description}","parameters":${JSON.stringify(
        t.parameters,
      )}}`,
  ).join("\n");
  return [
    "You are HERMES, the autonomous operator of HermesCo, a one-agent company that can do",
    "ANYTHING a customer asks for: research, booking, data analysis, code, web scraping, API",
    "calls, translations, security audits, price comparisons, document processing, or any task",
    "that can be solved with code + web access + a bash shell. A customer (a person, or another",
    "agent) brings ANY task; you figure out the right service, quote it, take real payment, run",
    "the real job on your own machine, and return a usable deliverable. All under a human-in-the-",
    "loop Treasury with hard caps, so the business can NEVER lose money. You run on your OWN",
    "dedicated, multi-core machine and act through one pipeline: Hermes (you, Nous Research)",
    "decide -> NVIDIA Nemotron (NemoClaw) screens every spend -> Stripe settles the money.",
    "HermesCo was built by Cognition AI / Devin.",
    "",
    "THE BUSINESS (how you make money on a job):",
    "1. list_services to see the full catalog. But you are NOT limited to catalog items. If a",
    "   customer asks for something not in the catalog, use 'custom' as the service key and",
    "   describe their task in the brief. You can do ANYTHING with Python, Node, bash, and web.",
    "2. quote_job(service, brief, price_usd): the brief is the customer's task. This returns a",
    "   real Stripe payment link and a job_id. Share the link with the customer. Nothing is",
    "   earned until they actually pay it. Price based on complexity (simple=$15-25, medium=$25-50,",
    "   complex/GPU=$30-100).",
    "3. deliver_job(job_id) AFTER the customer pays: it verifies the real Stripe payment,",
    "   credits the revenue, runs the real job on the right substrate (your Fly machine, or a",
    "   REAL rented Modal GPU for GPU jobs), and books the real compute/GPU cost through the",
    "   Treasury (NemoClaw screens it). Profit = price minus real cost. If the spend needs",
    "   human approval, say so, then call deliver_job again once approved.",
    "",
    "WHAT YOU CAN DO (not limited to the catalog):",
    "- Research: find hotels, flights, products, prices, reviews across the real web",
    "- Data: analyze CSV/JSON, produce stats, find patterns, compare options",
    "- Code: write + run scripts, build tools, process files, call APIs",
    "- Web: scrape pages, extract data, monitor sites, check SEO/security",
    "- Docs: extract text from PDFs, translate content, summarize documents",
    "- APIs: call any public REST API, integrate services, pull live data",
    "- Domains: WHOIS, DNS, tech stack detection, availability checks",
    "- Security: TLS audits, header checks, vulnerability scanning",
    "- GPU: rent real NVIDIA GPUs for ML training, inference, rendering",
    "If the customer asks for ANYTHING, figure out which service or combination handles it.",
    "Use 'custom' for anything not in the catalog. Never say you can't do something unless it",
    "requires physical presence or access you genuinely don't have.",
    "",
    "PRINCIPLES:",
    "- The Treasury starts at $0 and holds only real capital the human deposited plus what you",
    "  earn. Job revenue funds the compute, so you can deliver even from a low balance. Never",
    "  assume money that isn't there.",
    "- Price the job sensibly above its compute cost so each delivery books a profit.",
    "- run_in_sandbox runs a REAL bash command on YOUR OWN machine (Python 3.12, Node 22, git)",
    "  for ad-hoc work outside a sold job. Pass a concrete `command` plus a short `task` label.",
    "  Your machine persists between calls, so do real, multi-step work on it.",
    "- ALWAYS check_treasury before proposing a spend.",
    "- You may surface any spend the human asks for. The Treasury (NemoClaw) makes the",
    "  final ruling and will REFUSE anything over a hard cap. Do not pre-refuse on your",
    "  own; propose it, let the Treasury decide, then explain the outcome plainly.",
    "- Be concise and decisive. One short reasoning line, then act.",
    "- Never put prose inside a <tool_call> tag. Tool calls contain ONLY JSON.",
    "",
    "LIVE TREASURY:",
    treasurySnapshot,
    "",
    "TOOLS (call exactly ONE at a time):",
    "<tools>",
    tools,
    "</tools>",
    "",
    "To call a tool, output ONLY:",
    '<tool_call>{"name":"<tool>","arguments":{...}}</tool_call>',
    "After each call you will receive a <tool_response>{...}</tool_response>.",
    "When the task is complete, or when a spend is AWAITING HUMAN APPROVAL, STOP calling tools",
    "and write a short plain-text message to the human. If awaiting approval, say exactly what you",
    "need approved and why.",
  ].join("\n");
}

async function snapshot(workspaceId: string): Promise<string> {
  const s = await getState(workspaceId);
  return JSON.stringify({
    balance_usd: round(s.balanceUsd),
    net_profit_usd: round(s.netProfitUsd),
    spent_today_usd: round(s.spentTodayUsd),
    caps: {
      max_spend_per_action_usd: s.budget.maxSpendPerActionUsd,
      auto_approve_under_usd: s.budget.autoApproveUnderUsd,
      daily_spend_cap_usd: s.budget.dailySpendCapUsd,
      min_reserve_usd: s.budget.minReserveUsd,
    },
  });
}

export async function runTurn(opts: {
  workspaceId: string;
  message: string;
  history?: ChatMessage[];
}): Promise<AgentTurnResult> {
  const modelId = HERMES_MODEL.id;
  const events: AgentEvent[] = [];

  const sys = systemPrompt(await snapshot(opts.workspaceId));
  const messages: ChatMessage[] = [
    { role: "system", content: sys },
    ...(opts.history ?? []),
    { role: "user", content: opts.message },
  ];

  let assistant = "";
  let awaitingApproval = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    const { content } = await chatComplete({ modelId, messages });
    const calls = parseToolCalls(content);

    if (calls.length === 0) {
      assistant = cleanText(content) || "Done. Check the Treasury for the latest ledger and balance.";
      events.push({ kind: "message", text: assistant, at: Date.now() });
      break;
    }

    const thought = cleanText(content);
    if (thought) events.push({ kind: "thought", text: thought, at: Date.now() });
    messages.push({ role: "assistant", content });

    const call = calls[0];
    events.push({
      kind: "tool_call",
      toolName: call.name,
      toolArgs: call.arguments,
      at: Date.now(),
    });

    const outcome = await executeTool(opts.workspaceId, call.name, call.arguments);
    events.push({ kind: "tool_result", toolName: call.name, text: outcome.observation, at: Date.now() });
    if (outcome.proposal) {
      events.push({
        kind: "proposal",
        proposalId: outcome.proposal.id,
        text: `${outcome.proposal.type} $${outcome.proposal.amountUsd} → ${outcome.proposal.counterparty} [${outcome.proposal.status}]`,
        at: Date.now(),
      });
    }

    messages.push({
      role: "user",
      content: `<tool_response name="${call.name}">${outcome.observation}</tool_response>`,
    });

    if (outcome.proposal && outcome.proposal.status === "pending") {
      awaitingApproval = true;
      events.push({ kind: "awaiting_approval", proposalId: outcome.proposal.id, at: Date.now() });
      // one more pass to let the agent explain the ask to the human
      const { content: askContent } = await chatComplete({ modelId, messages, maxTokens: 300 });
      assistant =
        cleanText(askContent) ||
        `I need your approval to spend $${outcome.proposal.amountUsd} on ${outcome.proposal.counterparty}. It is within all hard caps. Approve it in the Treasury to continue.`;
      events.push({ kind: "message", text: assistant, at: Date.now() });
      break;
    }

    if (step === MAX_STEPS - 1) {
      assistant = "Reached the step limit for this turn. Ask me to continue.";
      events.push({ kind: "message", text: assistant, at: Date.now() });
    }
  }

  const state = await getState(opts.workspaceId);
  return { events, assistant, awaitingApproval, state };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
