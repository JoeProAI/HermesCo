// Manually run /opt/launchpad/start.sh inside an already-provisioned Launchpad
// sandbox. Daytona doesn't honor the image's CMD, so the start script needs
// to be invoked explicitly. This is a one-shot recovery helper for sandboxes
// that were provisioned before the auto-kickstart fix.
//
// Usage:
//   node scripts/launchpad-kickstart.mjs <sandbox-id>

import { Daytona } from "@daytonaio/sdk";

const id = process.argv[2];
if (!id) { console.error("usage: node scripts/launchpad-kickstart.mjs <sandbox-id>"); process.exit(1); }
const apiKey = process.env.DAYTONA_API_KEY;
if (!apiKey) { console.error("DAYTONA_API_KEY not set"); process.exit(1); }

const client = new Daytona({ apiKey, target: process.env.DAYTONA_TARGET || "us" });
const sb = await client.get(id);
console.log(`# sandbox ${id} state=${sb.state}`);

// Detach the start script so the SDK call returns and start.sh keeps running.
const cmd = `mkdir -p /workspace/.logs && setsid nohup /opt/launchpad/start.sh > /workspace/.logs/start.log 2>&1 < /dev/null & echo PID=$! && disown 2>/dev/null || true`;
console.log("# kickstart...");
const r = await sb.process.executeCommand(cmd, undefined, undefined, 15);
console.log((r.result || r.output || "").trim());

// Give cloudflared a few seconds to register before reporting state.
await new Promise((res) => setTimeout(res, 8000));

const checks = [
  ["pgrep -af cloudflared || echo 'NO CLOUDFLARED'", "cloudflared running?"],
  ["pgrep -af python || echo 'NO PYTHON'", "shim running?"],
  ["tail -n 25 /workspace/.logs/cloudflared.log 2>/dev/null || echo '(empty)'", "cloudflared log tail"],
  ["tail -n 15 /workspace/.logs/start.log 2>/dev/null || echo '(empty)'", "start log tail"],
  ["curl -fsS http://127.0.0.1:4242/healthz 2>&1 || echo 'shim not responding'", "shim healthz"],
];
for (const [c, label] of checks) {
  console.log(`\n=== ${label} ===`);
  const out = await sb.process.executeCommand(c, undefined, undefined, 10);
  console.log((out.result || out.output || "").trim().slice(0, 2500));
}
