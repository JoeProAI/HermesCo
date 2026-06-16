export type SkillRisk = "safe" | "warn" | "blocked";

export interface SkillScanResult {
  risk: SkillRisk;
  flags: string[];
  permissions: string[];
}

const ALLOWED_PERMISSIONS = new Set([
  "browser",
  "web_fetch",
  "web_search",
  "exec",
  "memory_read",
  "memory_write",
  "email",
  "calendar",
  "social_post",
]);

const BLOCKED_PATTERNS: Array<{ regex: RegExp; flag: string }> = [
  { regex: /curl\s+.+\|\s*(sh|bash)/i, flag: "Remote code execution via curl pipe" },
  { regex: /wget\s+.+\|\s*(sh|bash)/i, flag: "Remote code execution via wget pipe" },
  { regex: /rm\s+-rf\s+[\/~]/i, flag: "Destructive filesystem command (rm -rf / or ~)" },
  {
    regex: /ignore\s+(your\s+)?(previous|prior|system|safety)\s+(instructions?|prompt|rules?)/i,
    flag: "Prompt-injection attempt to ignore safety/system instructions",
  },
  {
    regex: /disregard\s+(your\s+)?(safety|instructions?|rules?)/i,
    flag: "Prompt-injection attempt to disregard safety/instructions",
  },
];

const WARN_PATTERNS: Array<{ regex: RegExp; flag: string }> = [
  { regex: /\bexec\s*\(/i, flag: "Potential dynamic execution detected: exec(" },
  { regex: /\beval\s*\(/i, flag: "Potential dynamic execution detected: eval(" },
  {
    regex: /\b(send\s+email|email\s+someone|post\s+autonomously|autonomous(?:ly)?\s+post|publish\s+automatically)\b/i,
    flag: "Autonomous outbound communication instruction detected",
  },
  { regex: /\bsudo\b/i, flag: "Privileged command usage detected: sudo" },
  { regex: /\bchmod\s+777\b/i, flag: "Unsafe permission change detected: chmod 777" },
  { regex: /\broot\s+access\b/i, flag: "Root access requirement detected" },
];

function parsePermissions(manifestContent?: string): string[] {
  if (!manifestContent) return [];
  try {
    const parsed: unknown = JSON.parse(manifestContent);
    const permissionsRaw = (parsed as { permissions?: unknown })?.permissions;
    if (!Array.isArray(permissionsRaw)) return [];
    return permissionsRaw.filter(
      (p): p is string => typeof p === "string" && ALLOWED_PERMISSIONS.has(p)
    );
  } catch {
    return [];
  }
}

function hasExfilPattern(content: string): boolean {
  const memoryOrSoul = /(MEMORY\.md|SOUL\.md)/i.test(content);
  if (!memoryOrSoul) return false;

  const lines = content.split("\n");
  for (const line of lines) {
    if (!/(MEMORY\.md|SOUL\.md)/i.test(line)) continue;
    const exfil = /(https?:\/\/|curl\s+|wget\s+|fetch\s*\(|nc\s+|netcat\s+|scp\s+)/i.test(line);
    if (exfil) return true;
  }

  return /(cat|type)\s+[^|\n]*(MEMORY\.md|SOUL\.md)[^|\n]*\|\s*(curl|wget|nc|netcat)\b/i.test(content);
}

function hasWriteOutsideSkills(content: string): boolean {
  const lines = content.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Typical shell writes to absolute paths.
    const writeLike =
      /(cat\s*>|cat\s*>>|echo\s+.+>|echo\s+.+>>|tee\s+|cp\s+.+\s+|mv\s+.+\s+|write\s+to\s+)/i.test(line);
    if (!writeLike) continue;

    const paths = line.match(/\/[A-Za-z0-9._\-\/]+/g) ?? [];
    const outside = paths.some((p) => !p.startsWith("/workspace/skills/"));
    if (outside) return true;
  }
  return false;
}

export function scanSkill(skillMdContent: string, manifestContent?: string): SkillScanResult {
  const content = `${skillMdContent}\n${manifestContent ?? ""}`;
  const flags: string[] = [];
  const permissions = parsePermissions(manifestContent);

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.regex.test(content)) flags.push(pattern.flag);
  }
  if (hasExfilPattern(content)) {
    flags.push("Potential exfiltration of MEMORY.md/SOUL.md to external destination");
  }
  if (flags.length > 0) {
    return { risk: "blocked", flags, permissions };
  }

  const warnFlags: string[] = [];
  for (const pattern of WARN_PATTERNS) {
    if (pattern.regex.test(content)) warnFlags.push(pattern.flag);
  }
  if (hasWriteOutsideSkills(content)) {
    warnFlags.push("File write outside /workspace/skills/ detected");
  }

  if (warnFlags.length > 0) {
    return { risk: "warn", flags: warnFlags, permissions };
  }

  return { risk: "safe", flags: [], permissions };
}
