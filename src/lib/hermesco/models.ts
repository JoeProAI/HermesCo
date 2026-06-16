// HermesCo — model registry + OpenRouter chat helper.
//
// The brain is Hermes 4 405B (Nous Research). Because its only OpenRouter
// provider does not expose native function-calling, HermesCo drives tools via
// Hermes's own native <tool_call> XML protocol, parsed server-side. The exact
// same text protocol is used for Nemotron 3 Ultra (NVIDIA), giving one
// provider-agnostic tool path and full server-side control over the money gate.

import type { ModelKey } from "./types";

export interface ModelInfo {
  key: ModelKey;
  id: string;
  label: string;
  vendor: string;
  blurb: string;
}

export const MODELS: Record<ModelKey, ModelInfo> = {
  hermes: {
    key: "hermes",
    id: "nousresearch/hermes-4-405b",
    label: "Hermes 4 405B",
    vendor: "Nous Research",
    blurb: "The messenger. Drives the business via the native Hermes tool protocol.",
  },
  nemotron: {
    key: "nemotron",
    id: "nvidia/nemotron-3-ultra-550b-a55b",
    label: "Nemotron 3 Ultra",
    vendor: "NVIDIA",
    blurb: "NVIDIA's flagship. Tool-native co-pilot and NemoClaw safety screen.",
  },
};

export const DEFAULT_MODEL: ModelKey = "hermes";

// NVIDIA model used by the NemoClaw safety screen (a Nemotron-class classifier).
export const SAFETY_MODEL_ID = "nvidia/nemotron-3-ultra-550b-a55b";

const OR_BASE = "https://openrouter.ai/api/v1";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface OrChoiceMessage {
  content?: string | null;
}
interface OrChoice {
  message?: OrChoiceMessage;
}
interface OrResponse {
  choices?: OrChoice[];
  error?: { message?: string };
}

export interface ChatResult {
  content: string;
}

export async function chatComplete(opts: {
  modelId: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<ChatResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45000);
  try {
    const res = await fetch(`${OR_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://hermesco.app",
        "X-Title": "HermesCo",
      },
      body: JSON.stringify({
        model: opts.modelId,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 800,
        temperature: opts.temperature ?? 0.4,
      }),
      signal: controller.signal,
    });
    const data = (await res.json()) as OrResponse;
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${data?.error?.message ?? "request failed"}`);
    }
    const content = data.choices?.[0]?.message?.content ?? "";
    return { content };
  } finally {
    clearTimeout(timeout);
  }
}
