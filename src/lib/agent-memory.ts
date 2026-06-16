/**
 * agent-memory.ts — Long-term distilled memory for agents
 *
 * Separate from raw conversation_history (14-day TTL).
 * This persists indefinitely and is injected into every conversation.
 *
 * Schema lives at: agent_memory/{userId}/channels/{channel}
 *
 * Distillation runs async after each assistant response (fire-and-forget).
 * Uses Grok Fast — cheap, fast, good enough for extraction.
 */

import { getAdminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DISTILL_MODEL   = "xai/grok-4-1-fast-non-reasoning";

export interface AgentMemory {
  facts:        string[];   // stable facts about the user/context
  preferences:  string[];   // how user likes things done
  decisions:    string[];   // key decisions made
  pendingTasks: string[];   // things the user is working on / wants done
  updatedAt:    Date;
  messageCount: number;     // total messages processed for this memory
}

export const EMPTY_MEMORY: AgentMemory = {
  facts:        [],
  preferences:  [],
  decisions:    [],
  pendingTasks: [],
  updatedAt:    new Date(),
  messageCount: 0,
};

// ── Read ──────────────────────────────────────────────────────────────────────

export async function loadMemory(userId: string, channel = "web"): Promise<AgentMemory> {
  try {
    const db  = getAdminDb();
    const ref = db.collection("agent_memory").doc(userId).collection("channels").doc(channel);
    const doc = await ref.get();
    if (!doc.exists) return EMPTY_MEMORY;
    return doc.data() as AgentMemory;
  } catch {
    return EMPTY_MEMORY;
  }
}

// ── Format for system prompt injection ───────────────────────────────────────

export function formatMemoryBlock(memory: AgentMemory): string {
  const lines: string[] = [];

  if (memory.facts.length)        lines.push(`Facts:\n${memory.facts.map(f => `- ${f}`).join("\n")}`);
  if (memory.preferences.length)  lines.push(`Preferences:\n${memory.preferences.map(p => `- ${p}`).join("\n")}`);
  if (memory.decisions.length)    lines.push(`Key decisions:\n${memory.decisions.map(d => `- ${d}`).join("\n")}`);
  if (memory.pendingTasks.length) lines.push(`Active tasks:\n${memory.pendingTasks.map(t => `- ${t}`).join("\n")}`);

  if (!lines.length) return "";

  return `\n\n---\nLong-term memory (distilled from past conversations):\n${lines.join("\n\n")}`;
}

// ── Distill ───────────────────────────────────────────────────────────────────

export async function distillMemory(
  userId:   string,
  channel:  string,
  messages: { role: string; content: string }[],
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || messages.length < 2) return;

  // Load existing memory to merge into
  const existing = await loadMemory(userId, channel);

  const transcript = messages
    .slice(-20)  // last 20 messages only
    .map(m => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
    .join("\n");

  const existingBlock = JSON.stringify({
    facts:        existing.facts.slice(0, 20),
    preferences:  existing.preferences.slice(0, 10),
    decisions:    existing.decisions.slice(0, 10),
    pendingTasks: existing.pendingTasks.slice(0, 10),
  });

  const prompt = `You are extracting memory from a conversation between a user and an AI agent.

Existing memory:
${existingBlock}

New conversation:
${transcript}

Extract and return ONLY a JSON object with these arrays. Merge new info with existing — remove outdated items, add new ones. Keep each item concise (one sentence max). Return empty arrays if nothing relevant.

{
  "facts": ["stable facts about the user, their name, projects, context"],
  "preferences": ["how the user likes things done, communication style, tool preferences"],
  "decisions": ["key decisions made in conversations"],
  "pendingTasks": ["things the user is actively working on or asked the agent to do"]
}

Return ONLY the JSON. No explanation.`;

  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://clawd.run",
      },
      body: JSON.stringify({
        model:      DISTILL_MODEL,
        max_tokens: 600,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) return;

    const json   = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw    = json.choices?.[0]?.message?.content?.trim() ?? "{}";
    const parsed = JSON.parse(raw.replace(/^```json\n?|```$/g, "").trim()) as Partial<AgentMemory>;

    const db  = getAdminDb();
    const ref = db.collection("agent_memory").doc(userId).collection("channels").doc(channel);

    await ref.set({
      facts:        (parsed.facts        ?? existing.facts).slice(0, 30),
      preferences:  (parsed.preferences  ?? existing.preferences).slice(0, 15),
      decisions:    (parsed.decisions    ?? existing.decisions).slice(0, 15),
      pendingTasks: (parsed.pendingTasks ?? existing.pendingTasks).slice(0, 15),
      updatedAt:    new Date(),
      messageCount: FieldValue.increment(messages.length),
    }, { merge: true });

  } catch (err) {
    // Fire-and-forget — never let distillation fail the user's chat
    console.error("[memory-distill] failed:", err);
  }
}
