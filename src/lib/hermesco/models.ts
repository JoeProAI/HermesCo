// HermesCo - model registry + OpenRouter chat helper.
//
// There is no model switch. HermesCo runs ONE unified pipeline:
//   Hermes 4 405B (Nous) decides  →  Nemotron (NVIDIA) screens  →  Stripe settles.
// Hermes 4 405B is the operator brain. Because its only OpenRouter provider does
// not expose native function-calling, HermesCo drives tools via Hermes's own
// native <tool_call> XML protocol, parsed server-side. NVIDIA Nemotron is the
// always-on NemoClaw layer riding underneath - it screens every spend and
// verifies risky actions before they execute (see safety.ts). Not a choice
// between them; a second pair of eyes that is always on.

export interface ModelInfo {
  id: string;
  label: string;
  vendor: string;
  blurb: string;
}

// The operator brain.
export const HERMES_MODEL: ModelInfo = {
  id: "nousresearch/hermes-4-405b",
  label: "Hermes 4 405B",
  vendor: "Nous Research",
  blurb: "The messenger. Decides and drives the business via the native Hermes tool protocol.",
};

// The always-on NemoClaw screen/verify layer.
export const NEMO_MODEL: ModelInfo = {
  id: "nvidia/nemotron-3-ultra-550b-a55b",
  label: "Nemotron 3 Ultra",
  vendor: "NVIDIA",
  blurb: "NVIDIA's flagship. The always-on NemoClaw safety screen on every spend.",
};

// NVIDIA model used by the NemoClaw safety screen (a Nemotron-class classifier).
export const SAFETY_MODEL_ID = NEMO_MODEL.id;

const OR_BASE = "https://openrouter.ai/api/v1";
// NVIDIA's own hosted API (NIM). When a key is present the NemoClaw screen calls
// Nemotron directly on NVIDIA infrastructure; otherwise it reaches the same
// model through OpenRouter. Either way the screen runs a real Nemotron model.
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";

export function nvidiaConfigured(): boolean {
  return !!process.env.NVIDIA_API_KEY;
}

// Where the safety screen actually ran, for honest UI/telemetry.
export function safetyProvider(): "nvidia" | "openrouter" {
  return nvidiaConfigured() ? "nvidia" : "openrouter";
}

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
  provider?: "openrouter" | "nvidia";
}): Promise<ChatResult> {
  const provider = opts.provider ?? "openrouter";
  const key =
    provider === "nvidia" ? process.env.NVIDIA_API_KEY : process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(`${provider === "nvidia" ? "NVIDIA_API_KEY" : "OPENROUTER_API_KEY"} not set`);
  }
  const base = provider === "nvidia" ? NVIDIA_BASE : OR_BASE;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://hermesco.ai";
    headers["X-Title"] = "HermesCo";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
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
