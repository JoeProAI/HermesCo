/**
 * Build a new Daytona snapshot with OpenClaw pre-installed and workspace pre-configured.
 *
 * Usage:
 *   DAYTONA_API_KEY=... npx tsx scripts/create-openclaw-snapshot.ts
 *
 * After it completes:
 *   1. Update OPENCLAW_SNAPSHOT in src/app/api/clawdbot/route.ts
 *   2. Update OPENCLAW_TARGET_VERSION to match the installed version
 *   3. Deploy — only NEW sandboxes use the new snapshot; existing are unaffected
 *
 * What's baked into this snapshot:
 *   - Node.js 22 (bookworm base)
 *   - OpenClaw (latest) via official install script
 *   - curl, git, python3, jq — common tools
 *   - ~/.openclaw/ directory with minimal starter config
 *   - ~/clawd/ workspace directory structure
 *   - SOUL.md, IDENTITY.md, AGENTS.md, BOOTSTRAP.md stubs (overwritten at provision time)
 *   - clawd-run skill pre-installed
 *
 * Security note: NO API keys baked in. Keys are injected at provision time via
 * executeCommand and stored in /home/node/.openclaw/.keys (chmod 600).
 */

import { Daytona, Image } from "@daytonaio/sdk";

const SNAPSHOT_NAME    = "openclaw-ready-v10";
const OPENCLAW_VERSION = "latest"; // pin to specific version after testing, e.g. "2026.2.17"

async function createSnapshot() {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) { console.error("Missing DAYTONA_API_KEY"); process.exit(1); }

  const daytona = new Daytona({ apiKey, target: "us" });

  console.log(`Building snapshot: ${SNAPSHOT_NAME}`);
  console.log("This takes 3–8 minutes...\n");

  const image = Image.base("node:22-bookworm")
    .runCommands(
      // ── System deps ────────────────────────────────────────────────────────
      "apt-get update && apt-get install -y curl git python3 python3-pip jq unzip && rm -rf /var/lib/apt/lists/*",

      // ── OpenClaw via official install script ────────────────────────────────
      // DO NOT use npm install -g openclaw — wrong package (WhatsApp CLI)
      `curl -fsSL https://openclaw.ai/install.sh | bash`,

      // ── Workspace directory structure ───────────────────────────────────────
      "mkdir -p /home/node/.openclaw",
      "mkdir -p /home/node/clawd/memory",
      "mkdir -p /home/node/clawd/skills/clawd-run",
      "mkdir -p /tmp/clawd-uploads",

      // ── Starter openclaw config (overwritten at provision time with tier config) ──
      `cat > /home/node/.openclaw/openclaw.json << 'ENDCONFIG'
{
  "gateway": {
    "model": "xai/grok-4-1-fast-non-reasoning",
    "bind": "lan",
    "port": 8400
  },
  "memory": {
    "backend": "builtin"
  },
  "skills": {
    "entries": {}
  }
}
ENDCONFIG`,

      // ── Stub workspace files (overwritten at provision time) ─────────────────
      `cat > /home/node/clawd/SOUL.md << 'ENDSOUL'
# SOUL.md
Provisioning in progress. Your soul will be restored shortly.
ENDSOUL`,

      `cat > /home/node/clawd/IDENTITY.md << 'ENDID'
# IDENTITY.md
## Name
Agent

## Emoji
🤖
ENDID`,

      `cat > /home/node/clawd/BOOTSTRAP.md << 'ENDBOOT'
# BOOTSTRAP.md
Read: SOUL.md → IDENTITY.md → PLATFORM.md → MEMORY.md → AGENTS.md
ENDBOOT`,

      `cat > /home/node/clawd/AGENTS.md << 'ENDAGENTS'
# AGENTS.md
Provisioning in progress. Full AGENTS.md will be written at startup.
ENDAGENTS`,

      // ── clawd-run self-mint skill (pre-installed, always available) ──────────
      `cat > /home/node/clawd/skills/clawd-run/SKILL.md << 'ENDSKILL'
# clawd-run Skill

Register and mint your soul on clawd.run.
Full skill: https://clawd.run/skills/self-mint/SKILL.md

Quick start:
  POST https://clawd.run/api/agent/auth/start
  Body: { "name": "YourName", "description": "..." }
  → Approve the link, poll for apiKey
  Then: POST https://clawd.run/api/agent/salvage
  Bearer: ns_<yourkey>
  Body: { "soul": { ... }, "encrypt": false }
ENDSKILL`,

      // ── Permissions ──────────────────────────────────────────────────────────
      "chown -R node:node /home/node",
      "chmod 755 /home/node/clawd",
      "chmod 700 /home/node/.openclaw",

      // ── Verify install ───────────────────────────────────────────────────────
      "su -c 'export HOME=/home/node && openclaw --version' node || true",
    )
    .workdir("/home/node");

  try {
    await daytona.snapshot.create(
      { image, name: SNAPSHOT_NAME },
      { onLogs: (chunk: string) => process.stdout.write(chunk) }
    );
    console.log(`\n✅ Snapshot created: ${SNAPSHOT_NAME}`);
    console.log(`\nNext steps:`);
    console.log(`  1. In src/app/api/clawdbot/route.ts:`);
    console.log(`     OPENCLAW_SNAPSHOT       = "${SNAPSHOT_NAME}"`);
    console.log(`     OPENCLAW_TARGET_VERSION = "<version from build log>"`);
    console.log(`  2. Deploy to Vercel — existing sandboxes unaffected`);
    console.log(`  3. Test a fresh provision before announcing`);
  } catch (err) {
    console.error("\n❌ Snapshot creation failed:", err);
    process.exit(1);
  }
}

createSnapshot();
