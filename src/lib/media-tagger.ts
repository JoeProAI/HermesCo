/**
 * media-tagger.ts — AI-powered Arweave tag generation for any media type
 *
 * Feed it a file, get back rich semantic Arweave tags.
 * Used by the salvage route to enrich mints automatically.
 *
 * Uses OpenRouter for all inference — no separate OpenAI SDK required.
 *
 * Supported:
 *   image/*   → Vision analysis: style, subject, mood, colors, keywords
 *   text/*    → Topic + keyword extraction from content
 *   audio/*   → Metadata-only tags (transcription not yet implemented)
 *   video/*   → Metadata-only tags
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const VISION_MODEL    = "google/gemini-2.5-flash";
const TEXT_MODEL      = "xai/grok-4-1-fast-non-reasoning";  // cheap + fast

export interface ArweaveTag {
  name:  string;
  value: string;
}

export interface TagAnalysis {
  tags:        ArweaveTag[];
  description: string;
  mediaType:   "image" | "audio" | "text" | "video" | "unknown";
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function analyzeMedia(
  buffer:   Buffer,
  mimeType: string,
  opts: { filename?: string; agentId?: string } = {}
): Promise<TagAnalysis> {
  const type = resolveMediaType(mimeType);

  try {
    switch (type) {
      case "image": return await analyzeImage(buffer, mimeType, opts);
      case "text":  return await analyzeText(buffer, opts);
      case "audio": return audioMetaTags(mimeType, opts);
      default:      return fallbackTags(mimeType, opts);
    }
  } catch (err) {
    console.error("[media-tagger] analysis failed:", err);
    return fallbackTags(mimeType, opts);
  }
}

// ── Image analysis (vision model via OpenRouter) ─────────────────────────────

async function analyzeImage(
  buffer:   Buffer,
  mimeType: string,
  opts:     { filename?: string; agentId?: string }
): Promise<TagAnalysis> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return fallbackTags(mimeType, opts);

  const b64     = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://clawd.run",
    },
    body: JSON.stringify({
      model:      VISION_MODEL,
      max_tokens: 500,
      messages: [{
        role:    "user",
        content: [
          {
            type: "text",
            text: `Analyze this image and return ONLY a JSON object with these fields:
{
  "subject": "primary subject in 3-5 words",
  "style": "art style (e.g. photographic, digital art, oil painting, cyberpunk, anime, minimalist)",
  "medium": "medium (e.g. photography, digital, oil, watercolor, 3D render)",
  "mood": "emotional mood in 1-2 words",
  "colors": ["3-5 dominant colors as descriptive names"],
  "keywords": ["5-8 semantic keywords for discoverability"],
  "description": "one sentence describing the image"
}
Return ONLY the JSON, no markdown, no explanation.`,
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
        ],
      }],
    }),
  });

  if (!res.ok) {
    console.error("[media-tagger] vision API error:", res.status);
    return fallbackTags(mimeType, opts);
  }

  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const raw  = json.choices?.[0]?.message?.content?.trim() ?? "{}";

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw.replace(/^```json\n?|```$/g, "").trim());
  } catch { /* use defaults */ }

  const tags: ArweaveTag[] = [
    { name: "Media-Type",   value: "image" },
    { name: "MIME-Type",    value: mimeType },
    { name: "AI-Tagged",    value: "true" },
    { name: "Tagger-Model", value: VISION_MODEL },
  ];

  if (parsed.subject)  tags.push({ name: "Subject",   value: String(parsed.subject) });
  if (parsed.style)    tags.push({ name: "Art-Style",  value: String(parsed.style) });
  if (parsed.medium)   tags.push({ name: "Medium",     value: String(parsed.medium) });
  if (parsed.mood)     tags.push({ name: "Mood",       value: String(parsed.mood) });

  const colors = Array.isArray(parsed.colors) ? parsed.colors : [];
  if (colors.length)   tags.push({ name: "Color-Palette", value: (colors as string[]).slice(0, 5).join(", ") });

  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];
  (keywords as string[]).slice(0, 8).forEach((kw, i) => {
    tags.push({ name: `Keyword-${i + 1}`, value: String(kw) });
  });

  if (opts.filename) tags.push({ name: "Filename", value: opts.filename });
  if (opts.agentId)  tags.push({ name: "Agent-Id", value: opts.agentId });

  return {
    tags,
    description: String(parsed.description ?? ""),
    mediaType: "image",
  };
}

// ── Text analysis ────────────────────────────────────────────────────────────

async function analyzeText(
  buffer: Buffer,
  opts:   { filename?: string; agentId?: string }
): Promise<TagAnalysis> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return fallbackTags("text/plain", opts);

  const content = buffer.toString("utf8").slice(0, 3000);

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://clawd.run",
    },
    body: JSON.stringify({
      model:      TEXT_MODEL,
      max_tokens: 300,
      messages: [{
        role:    "user",
        content: `Analyze this text and return ONLY JSON:
{
  "topic": "main topic in 3-5 words",
  "keywords": ["5-8 keywords"],
  "language": "ISO 639-1 code",
  "content_type": "type of content (e.g. poetry, documentation, journal, code, narrative)"
}
Text: "${content}"`,
      }],
    }),
  });

  if (!res.ok) return fallbackTags("text/plain", opts);

  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(json.choices?.[0]?.message?.content?.trim() ?? "{}");
  } catch { /* defaults */ }

  const tags: ArweaveTag[] = [
    { name: "Media-Type",   value: "text" },
    { name: "AI-Tagged",    value: "true" },
    { name: "Tagger-Model", value: TEXT_MODEL },
  ];

  if (parsed.topic)        tags.push({ name: "Topic",                 value: String(parsed.topic) });
  if (parsed.content_type) tags.push({ name: "Content-Type-Semantic", value: String(parsed.content_type) });
  if (parsed.language)     tags.push({ name: "Language",              value: String(parsed.language) });

  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];
  (keywords as string[]).slice(0, 8).forEach((kw, i) => {
    tags.push({ name: `Keyword-${i + 1}`, value: String(kw) });
  });

  if (opts.filename) tags.push({ name: "Filename", value: opts.filename });

  return {
    tags,
    description: String(parsed.topic ?? ""),
    mediaType: "text",
  };
}

// ── Audio — metadata only (transcription not yet implemented) ─────────────────

function audioMetaTags(
  mimeType: string,
  opts:     { filename?: string; agentId?: string }
): TagAnalysis {
  const tags: ArweaveTag[] = [
    { name: "Media-Type", value: "audio" },
    { name: "MIME-Type",  value: mimeType },
    { name: "AI-Tagged",  value: "false" },
  ];
  if (opts.filename) tags.push({ name: "Filename", value: opts.filename });
  if (opts.agentId)  tags.push({ name: "Agent-Id", value: opts.agentId });
  return { tags, description: "", mediaType: "audio" };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveMediaType(mime: string): "image" | "audio" | "text" | "video" | "unknown" {
  if (mime.startsWith("image/"))  return "image";
  if (mime.startsWith("audio/"))  return "audio";
  if (mime.startsWith("text/"))   return "text";
  if (mime.startsWith("video/"))  return "video";
  if (mime === "application/pdf") return "text";
  return "unknown";
}

function fallbackTags(mimeType: string, opts: { filename?: string; agentId?: string }): TagAnalysis {
  const tags: ArweaveTag[] = [
    { name: "MIME-Type", value: mimeType },
    { name: "AI-Tagged", value: "false" },
  ];
  if (opts.filename) tags.push({ name: "Filename", value: opts.filename });
  if (opts.agentId)  tags.push({ name: "Agent-Id", value: opts.agentId });
  return { tags, description: "", mediaType: "unknown" };
}
