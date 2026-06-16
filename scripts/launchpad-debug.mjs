// Debug helper: list launchpad sandboxes + exec into one to read cloudflared.log
// Usage:
//   node scripts/launchpad-debug.mjs            # list
//   node scripts/launchpad-debug.mjs <id>       # exec into sandbox <id> and read tunnel logs

import { Daytona } from "@daytonaio/sdk";

const apiKey = process.env.DAYTONA_API_KEY;
if (!apiKey) { console.error("DAYTONA_API_KEY not set"); process.exit(1); }
const client = new Daytona({ apiKey, target: process.env.DAYTONA_TARGET || "us" });

const arg = process.argv[2];

async function listLaunchpad() {
  const all = await client.list();
  const items = Array.isArray(all) ? all : (all?.items || []);
  const lp = items.filter((s) => s?.labels?.launchpad === "true");
  console.log(`# total sandboxes: ${items.length}, launchpad: ${lp.length}`);
  for (const sb of lp) {
    console.log(`${sb.id}  state=${sb.state}  product=${sb.labels?.product}  user=${sb.labels?.userId}  name=${sb.name}`);
  }
}

async function diag(id) {
  const sb = await client.get(id);
  console.log(`# sandbox ${id} state=${sb.state} image=${sb.image || "?"}`);
  if (sb.state !== "started" && sb.state !== "running") {
    console.log("not running, attempting start...");
    await sb.start();
  }
  const cmds = [
    ["pgrep -af cloudflared || echo 'NO CLOUDFLARED PROCESS'", "ps:cloudflared"],
    ["pgrep -af python || echo 'NO PYTHON'", "ps:python"],
    ["ls -la /workspace/.logs/ 2>/dev/null || echo 'no logs dir'", "logs:list"],
    ["tail -n 80 /workspace/.logs/cloudflared.log 2>/dev/null || echo 'no cloudflared.log'", "logs:cloudflared"],
    ["tail -n 30 /workspace/.logs/hermes.log 2>/dev/null || echo 'no hermes.log'", "logs:hermes"],
    ["env | grep -E 'CF_|LAUNCHPAD_|HERMES_' | sed 's/=.*$/=<redacted>/g'", "env:keys"],
    ["which cloudflared && cloudflared --version", "cloudflared:version"],
    ["curl -fsS http://127.0.0.1:4242/healthz 2>&1 || echo 'shim not responding'", "shim:healthz"],
  ];
  for (const [cmd, label] of cmds) {
    console.log(`\n=== ${label} ===`);
    try {
      const r = await sb.process.executeCommand(cmd, undefined, undefined, 15);
      console.log((r.result || r.output || "").trim().slice(0, 4000));
    } catch (err) {
      console.log(`ERR: ${err.message}`);
    }
  }
}

if (!arg) {
  await listLaunchpad();
} else {
  await diag(arg);
}
