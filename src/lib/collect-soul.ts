/**
 * collect-soul.ts — Pull workspace files from a Daytona sandbox and package as soul payload
 *
 * Used by: dashboard mint, agent self-mint, auto-mint on genesis.
 */

import { Daytona } from "@daytonaio/sdk";
import { getDaytona } from "@/lib/daytona";
import { scrubPII } from "@/lib/pii-scrubber";

const WORKSPACE_ROOT = "/home/node/.openclaw/workspace";
const PERSISTENT_ROOT = "/home/node/clawd";

/** Sandbox type from Daytona SDK */
type Sandbox = Awaited<ReturnType<Daytona["get"]>>;

/** Files that make up an agent's soul */
const SOUL_FILES = [
  "SOUL.md",
  "IDENTITY.md",
  "MEMORY.md",
  "USER.md",
  "AGENTS.md",
  "TOOLS.md",
  "HEARTBEAT.md",
  "PLATFORM.md",
  "BOOTSTRAP.md",
  "SESSION_CONTEXT.md",
];

/** Patterns to strip from TOOLS.md (API keys, tokens, secrets) */
const SECRET_PATTERNS = [
  /^.*(?:token|key|secret|password|Bearer)\s*[:=].*(?:sk-|vcp_|ns_|mb_|ghp_|apify_api_|eyJ|xszKG|fF8Hf).*/gim,
  /^\s*-\s*\*\*(?:Token|Key|Secret|Password|Bearer|Consumer)\*\*.*$/gim,
  /^\s*-\s*(?:OAuth|Bearer|Consumer|Client)\s+(?:Key|Secret|Token|ID):\s*\S+.*$/gim,
];

function sanitizeTools(content: string): string {
  let result = content;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  // Also strip any line with obvious key patterns
  result = result
    .split("\n")
    .map((line) => {
      const lower = line.toLowerCase();
      // If line contains a key-value with a long alphanumeric value, redact it
      if (
        (lower.includes("token") ||
          lower.includes("key") ||
          lower.includes("secret") ||
          lower.includes("password")) &&
        /[`'"]\s*[:=]\s*[`'"]?\w{20,}/.test(line)
      ) {
        return "[REDACTED]";
      }
      return line;
    })
    .join("\n");
  return result;
}

async function readSandboxFile(
  sandbox: Sandbox,
  path: string
): Promise<string | null> {
  try {
    const result = await sandbox.process.executeCommand(`cat "${path}" 2>/dev/null`);
    const content = result.result?.trim();
    if (!content || content === "") return null;
    return content;
  } catch {
    return null;
  }
}

async function listSkillFiles(sandbox: Sandbox): Promise<string[]> {
  const cmd = `
    for root in "${WORKSPACE_ROOT}/skills" "${PERSISTENT_ROOT}/skills"; do
      if [ -d "$root" ]; then
        find "$root" -type f \
          \( -name "*.md" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" \) 2>/dev/null
      fi
    done | sort -u | head -200
  `;

  try {
    const result = await sandbox.process.executeCommand(cmd);
    return (result.result ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export interface SoulPayload {
  format: string;
  agentId: string;
  agentName: string;
  platform: string;
  timestamp: string;
  files: Record<string, string>;
  memory: Record<string, string>;
  credentials: Record<string, string>;
  skills: Record<string, string>;
  restoration: {
    instructions: string;
    targetPath: string;
  };
}

/**
 * Collect all workspace files from a sandbox and package as a soul payload.
 * Returns null if the sandbox has no meaningful content (no SOUL.md or IDENTITY.md).
 */
export async function collectSoulFromSandbox(
  sandboxId: string,
  agentId: string,
  agentName: string
): Promise<SoulPayload | null> {
  const daytona = getDaytona();
  const sandbox = await daytona.get(sandboxId);

  const files: Record<string, string> = {};

  // Collect soul files (prefer workspace, fallback to persistent clawd dir)
  for (const filename of SOUL_FILES) {
    const workspacePath = `${WORKSPACE_ROOT}/${filename}`;
    const persistentPath = `${PERSISTENT_ROOT}/${filename}`;
    const content =
      (await readSandboxFile(sandbox, workspacePath)) ??
      (await readSandboxFile(sandbox, persistentPath));

    if (content) {
      // Sanitize TOOLS.md secrets, then scrub PII from all files
      const sanitized = filename === "TOOLS.md" ? sanitizeTools(content) : content;
      files[filename] = scrubPII(sanitized);
    }
  }

  // Must have at least SOUL.md or IDENTITY.md to be worth minting
  if (!files["SOUL.md"] && !files["IDENTITY.md"]) {
    return null;
  }

  // Collect recent daily memory notes (last 7 days)
  const memory: Record<string, string> = {};
  try {
    const lsResult = await sandbox.process.executeCommand(
      `ls -1 ${WORKSPACE_ROOT}/memory/*.md ${PERSISTENT_ROOT}/memory/*.md 2>/dev/null | sort -u | tail -7`
    );
    const memFiles = (lsResult.result?.trim() ?? "")
      .split("\n")
      .filter((f) => f.endsWith(".md"));

    for (const memPath of memFiles) {
      const content = await readSandboxFile(sandbox, memPath);
      if (content) {
        const filename = memPath.split("/").pop() ?? memPath;
        memory[filename] = content;
      }
    }
  } catch {
    // Memory collection is best-effort
  }

  const credentials: Record<string, string> = {};
  const credentialsRaw =
    (await readSandboxFile(sandbox, `${WORKSPACE_ROOT}/.config/moltbook/credentials.json`)) ??
    (await readSandboxFile(sandbox, `${PERSISTENT_ROOT}/.config/moltbook/credentials.json`));

  if (credentialsRaw) {
    credentials["moltbook/credentials.json"] = credentialsRaw;
  }

  const skills: Record<string, string> = {};
  const skillPaths = await listSkillFiles(sandbox);
  for (const skillPath of skillPaths) {
    const content = await readSandboxFile(sandbox, skillPath);
    if (!content) continue;

    const key = skillPath.startsWith(`${WORKSPACE_ROOT}/`)
      ? skillPath.slice(`${WORKSPACE_ROOT}/`.length)
      : skillPath.startsWith(`${PERSISTENT_ROOT}/`)
      ? skillPath.slice(`${PERSISTENT_ROOT}/`.length)
      : skillPath;

    skills[key] = content;
  }

  return {
    format: "openclaw-workspace-v1",
    agentId,
    agentName,
    platform: "clawd.run",
    timestamp: new Date().toISOString(),
    files,
    memory,
    credentials,
    skills,
    restoration: {
      instructions:
        "Write each key in files{} as a path relative to workspace root. Write each key in memory{} to the memory/ directory. Restore credentials{} to .config and skills{} to skills/.",
      targetPath: WORKSPACE_ROOT,
    },
  };
}
