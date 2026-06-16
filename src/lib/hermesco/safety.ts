// HermesCo — NemoClaw safe-runtime screen.
//
// Every money move is screened before it can execute. Two layers:
//  1. Deterministic policy: prohibited-use patterns + hard numeric caps. This
//     layer is authoritative and cannot be talked around by the model.
//  2. An NVIDIA Nemotron classifier pass (best-effort) that flags actions for
//     human review. On any error it fails SAFE-by-deferring to layer 1, never
//     blocking the happy path on a model outage.

import { chatComplete, SAFETY_MODEL_ID } from "./models";
import type { Budget, RiskLevel } from "./types";

const PROHIBITED = [
  /\b(money\s*launder|laundering|structuring)\b/i,
  /\b(stolen|cloned)\s+(card|cards|credit)\b/i,
  /\b(carding|chargeback\s+scheme|bust[\s-]?out)\b/i,
  /\b(weapon|firearm|narcotic|cocaine|heroin|fentanyl)\b/i,
  /\b(child|csam|terror|extremist)\b/i,
];

export interface SafetyVerdict {
  risk: RiskLevel;
  reason: string;
}

// Deterministic numeric gate — the inviolable part of "can't lose money".
export function capVerdict(amountUsd: number, budget: Budget): SafetyVerdict {
  if (amountUsd > budget.maxSpendPerActionUsd) {
    return {
      risk: "blocked",
      reason: `Exceeds the per-action hard cap ($${budget.maxSpendPerActionUsd}). NemoClaw refuses.`,
    };
  }
  if (amountUsd >= budget.autoApproveUnderUsd) {
    return {
      risk: "review",
      reason: `$${amountUsd} is at or above the auto-approve threshold ($${budget.autoApproveUnderUsd}) — needs a human tap.`,
    };
  }
  return { risk: "safe", reason: "Within the auto-approve band and all hard caps." };
}

export function prohibitedVerdict(text: string): SafetyVerdict | null {
  for (const re of PROHIBITED) {
    if (re.test(text)) {
      return { risk: "blocked", reason: "Matched a prohibited-use pattern (NemoClaw policy)." };
    }
  }
  return null;
}

interface ClassifierJson {
  risk?: string;
  reason?: string;
}

// Best-effort NVIDIA Nemotron screen. Returns "review" if the model raises a
// concern, otherwise null (defer to the deterministic layers).
export async function classifyWithNemotron(input: {
  action: string;
  details: string;
}): Promise<SafetyVerdict | null> {
  try {
    const { content } = await chatComplete({
      modelId: SAFETY_MODEL_ID,
      temperature: 0,
      maxTokens: 160,
      timeoutMs: 12000,
      messages: [
        {
          role: "system",
          content:
            "You are NemoClaw, an NVIDIA Nemotron safety screen for an autonomous business agent. " +
            "Classify the proposed action. Respond with ONLY compact JSON: " +
            '{"risk":"safe|review|blocked","reason":"<one short sentence>"}. ' +
            'Use "blocked" only for clearly illegal or abusive activity; "review" for anything ' +
            "unusual, risky, or worth a human glance; otherwise \"safe\".",
        },
        {
          role: "user",
          content: `Action: ${input.action}\nDetails: ${input.details}`,
        },
      ],
    });
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as ClassifierJson;
    const risk = parsed.risk === "blocked" || parsed.risk === "review" ? parsed.risk : null;
    if (!risk) return null;
    return { risk, reason: parsed.reason || "Flagged by NemoClaw (NVIDIA Nemotron) screen." };
  } catch {
    return null; // model unavailable — defer to deterministic layers
  }
}

// Combine all layers into a single verdict. The strictest layer wins.
export async function screenSpend(input: {
  amountUsd: number;
  vendor: string;
  purpose: string;
  budget: Budget;
}): Promise<SafetyVerdict> {
  const text = `${input.vendor} ${input.purpose}`;
  const prohibited = prohibitedVerdict(text);
  if (prohibited) return prohibited;

  const cap = capVerdict(input.amountUsd, input.budget);
  if (cap.risk === "blocked") return cap;

  const llm = await classifyWithNemotron({
    action: `Spend $${input.amountUsd} with vendor "${input.vendor}"`,
    details: input.purpose,
  });
  if (llm?.risk === "blocked") return llm;
  if (llm?.risk === "review") {
    return { risk: "review", reason: `NemoClaw: ${llm.reason}` };
  }
  return cap; // safe or review from the numeric band
}
