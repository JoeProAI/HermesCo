#!/usr/bin/env node

/**
 * create-snapshot.js
 *
 * Builds a fresh Daytona snapshot for clawd.run sandboxes.
 * Creates a sandbox from the existing base, upgrades OpenClaw to the latest
 * version, writes standard workspace files, and saves it as a new snapshot.
 *
 * Usage:
 *   DAYTONA_API_KEY=... node scripts/create-snapshot.js
 *
 * Output: new snapshot name (update OPENCLAW_SNAPSHOT in clawdbot/route.ts)
 *
 * What goes into the snapshot:
 * - Latest openclaw (npm install -g openclaw@latest)
 * - Standard workspace directories: ~/.openclaw/workspace/, ~/clawd/
 * - Standard skills directory structure
 * - Moltbook skill pre-installed
 * - Sensible default openclaw.json (no API keys — injected at runtime)
 */

const { Daytona } = require("@daytonaio/sdk");
const https = require("https");

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
if (!DAYTONA_API_KEY) {
  console.error("❌ DAYTONA_API_KEY not set");
  process.exit(1);
}

const BASE_SNAPSHOT  = "openclaw-ready-v9";
const NEW_SNAPSHOT   = "openclaw-ready-v10";
const OPENCLAW_VERSION = "2026.3.11"; // latest stable

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run(sandbox, cmd, label) {
  console.log(`  ▸ ${label || cmd.slice(0, 60)}`);
  const result = await sandbox.process.executeCommand(cmd);
  if (result.exitCode !== 0 && result.exitCode !== undefined) {
    console.warn(`    ⚠ exit ${result.exitCode}: ${(result.result || "").slice(0, 200)}`);
  }
  return result.result || "";
}

// Call Daytona REST API for snapshot operations (not in SDK yet)
async function daytonaRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.daytona.io",
      path,
      method,
      headers: {
        "Authorization": `Bearer ${DAYTONA_API_KEY}`,
        "Content-Type": "application/json",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`\n🔧 Building clawd.run sandbox snapshot: ${NEW_SNAPSHOT}\n`);

  const daytona = new Daytona({
    apiKey: DAYTONA_API_KEY,
    target: process.env.DAYTONA_TARGET || "us",
  });

  // ── 1. Create sandbox from current base snapshot ──────────────────────────
  console.log(`📦 Resolving base snapshot "${BASE_SNAPSHOT}"...`);
  const allSnaps = await daytona.snapshot.list();
  const snapArr = Array.isArray(allSnaps) ? allSnaps : (allSnaps.items || allSnaps.snapshots || Object.values(allSnaps));
  const baseSnap = snapArr.find(s => s.name === BASE_SNAPSHOT);
  if (!baseSnap) throw new Error(`Base snapshot "${BASE_SNAPSHOT}" not found`);
  const baseId = baseSnap.id;
  console.log(`  ✓ ID: ${baseId}`);

  console.log(`📦 Creating sandbox from ${BASE_SNAPSHOT}...`);
  const sandbox = await daytona.create({ snapshot: baseId });
  console.log(`  ✓ Sandbox: ${sandbox.id}`);

  await sleep(3000);

  // ── 2. Update OpenClaw to latest ─────────────────────────────────────────
  console.log(`\n📦 Installing openclaw@${OPENCLAW_VERSION}...`);
  await run(sandbox,
    `export HOME=/home/node && npm install -g openclaw@${OPENCLAW_VERSION} --no-fund --no-audit 2>&1 | tail -5`,
    `npm install -g openclaw@${OPENCLAW_VERSION}`
  );

  // Verify version
  const version = await run(sandbox, "openclaw --version", "openclaw --version");
  console.log(`  ✓ OpenClaw: ${version.trim()}`);

  // ── 3. Set up workspace directory structure ───────────────────────────────
  console.log(`\n📂 Setting up workspace structure...`);
  await run(sandbox, `
    export HOME=/home/node
    mkdir -p ~/.openclaw/workspace/skills/clawd-run
    mkdir -p ~/.openclaw/workspace/memory
    mkdir -p ~/.openclaw/sessions
    mkdir -p ~/clawd/memory
    mkdir -p ~/clawd/skills
    echo "workspace directories ready"
  `, "create directories");

  // ── 4. Write default openclaw.json (no API keys — injected at runtime) ───
  const defaultConfig = JSON.stringify({
    gateway: { mode: "local" },
    agents: {
      defaults: {
        model: {
          primary: "xai/grok-4-1-fast-non-reasoning",
          fallbacks: ["anthropic/claude-sonnet-4-5", "openrouter/google/gemini-2.5-flash"],
        },
        subagents: { model: "openrouter/google/gemini-2.5-flash", maxConcurrent: 4 },
        contextTokens: 64000,
      },
    },
    memory: {
      backend: "builtin",
    },
    skills: {
      entries: {},
    },
  }, null, 2);

  await run(sandbox, `
    export HOME=/home/node
    mkdir -p ~/.openclaw
    cat > ~/.openclaw/openclaw.json << 'EOF_CONFIG'
${defaultConfig}
EOF_CONFIG
    echo "config written"
  `, "write default openclaw.json");

  // ── 5. Install Moltbook skill ─────────────────────────────────────────────
  console.log(`\n📦 Installing Moltbook skill...`);
  await run(sandbox, `
    export HOME=/home/node
    mkdir -p ~/.openclaw/skills/moltbook
    curl -s https://www.moltbook.com/skill.md > ~/.openclaw/skills/moltbook/SKILL.md 2>/dev/null || echo "# Moltbook - load from https://www.moltbook.com/skill.md" > ~/.openclaw/skills/moltbook/SKILL.md
    curl -s https://www.moltbook.com/heartbeat.md > ~/.openclaw/skills/moltbook/HEARTBEAT.md 2>/dev/null || true
    echo "moltbook installed"
  `, "install moltbook skill");

  // ── 6. Write clawd-run self-mint skill ────────────────────────────────────
  console.log(`\n📦 Writing clawd-run self-mint skill...`);
  await run(sandbox, `
    export HOME=/home/node
    mkdir -p ~/.openclaw/skills/clawd-run
    cat > ~/.openclaw/skills/clawd-run/SKILL.md << 'EOF_SKILL'
# clawd-run Self-Mint Skill
# Full skill at: https://clawd.run/skills/self-mint/SKILL.md
# Or fetch platform context: GET https://clawd.run/api/agent/context
# Your API key (ns_ or mb_) is in PLATFORM.md
EOF_SKILL
    echo "clawd-run skill written"
  `, "write clawd-run skill");

  // ── 7. Write startup gateway script ──────────────────────────────────────
  await run(sandbox, `
    cat > /home/node/start-gateway.sh << 'EOF_SCRIPT'
#!/bin/bash
export HOME=/home/node
pkill -f "openclaw gateway" 2>/dev/null || true
sleep 1
exec openclaw gateway --bind lan --port 8400 run
EOF_SCRIPT
    chmod +x /home/node/start-gateway.sh
    echo "startup script ready"
  `, "write start-gateway.sh");

  // ── 8. Final cleanup ─────────────────────────────────────────────────────
  await run(sandbox, `
    export HOME=/home/node
    npm cache clean --force 2>/dev/null || true
    rm -rf /tmp/* 2>/dev/null || true
    echo "cleanup done"
  `, "cleanup npm cache");

  // ── 9. Save as new snapshot ───────────────────────────────────────────────
  console.log(`\n💾 Saving snapshot as "${NEW_SNAPSHOT}"...`);

  // Try Daytona snapshot API (v2 endpoint)
  const snapResult = await daytonaRequest("POST", `/v1/sandbox/${sandbox.id}/snapshot`, {
    name: NEW_SNAPSHOT,
    description: `clawd.run production snapshot — openclaw ${version.trim()}, moltbook skill, clawd-run skill`,
  });

  if (snapResult.status === 200 || snapResult.status === 201) {
    console.log(`  ✓ Snapshot saved: ${NEW_SNAPSHOT}`);
  } else {
    console.warn(`  ⚠ Snapshot API returned ${snapResult.status}:`, snapResult.body);
    console.log(`\n  Manual step: In Daytona dashboard, save sandbox ${sandbox.id} as "${NEW_SNAPSHOT}"`);
  }

  // ── 10. Stop (don't delete — might need to inspect) ──────────────────────
  console.log(`\n🛑 Stopping sandbox...`);
  await sandbox.stop();

  console.log(`
✅ Done!

Snapshot: ${NEW_SNAPSHOT}
OpenClaw: ${version.trim()}
Sandbox:  ${sandbox.id} (stopped — delete when verified)

Next step: update OPENCLAW_SNAPSHOT constant in:
  src/app/api/clawdbot/route.ts
  (search for "openclaw-ready-v6" and replace with "${NEW_SNAPSHOT}")
`);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
