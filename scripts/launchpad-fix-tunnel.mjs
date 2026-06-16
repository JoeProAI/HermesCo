// Restart cloudflared inside an existing Launchpad sandbox using --protocol http2.
// Daytona's network blocks QUIC (UDP 7844 outbound), so the default cloudflared
// protocol (quic) hangs forever. http2 falls back to TCP and works.
//
// Usage:
//   node scripts/launchpad-fix-tunnel.mjs <sandbox-id>

import { Daytona } from "@daytonaio/sdk";

const id = process.argv[2];
if (!id) { console.error("usage: node scripts/launchpad-fix-tunnel.mjs <sandbox-id>"); process.exit(1); }
const apiKey = process.env.DAYTONA_API_KEY;
if (!apiKey) { console.error("DAYTONA_API_KEY not set"); process.exit(1); }

const client = new Daytona({ apiKey, target: process.env.DAYTONA_TARGET || "us" });
const sb = await client.get(id);
console.log(`# sandbox ${id} state=${sb.state}`);

async function run(cmd, timeout = 15) {
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeout);
  return (r.result || r.output || "").trim();
}

// slim images don't have ps/pgrep; use /proc to find pids.
console.log("# kill existing cloudflared (if any)...");
console.log(await run("for p in /proc/[0-9]*; do c=$(cat $p/comm 2>/dev/null); if [ \"$c\" = cloudflared ]; then kill -9 $(basename $p); echo killed $(basename $p); fi; done; echo done"));

console.log("\n# truncate old QUIC log...");
await run("> /workspace/.logs/cloudflared.log");

console.log("\n# write + run start script (--protocol http2, detached)...");
const script = `#!/usr/bin/env bash
set -e
mkdir -p /workspace/.logs
setsid nohup cloudflared tunnel --no-autoupdate --protocol http2 run --token "$CF_TUNNEL_TOKEN" >> /workspace/.logs/cloudflared.log 2>&1 < /dev/null &
PID=$!
disown 2>/dev/null || true
echo PID=$PID
`;
// Encode + drop on disk, then exec. Avoids all quoting hell.
const b64 = Buffer.from(script).toString("base64");
console.log(await run(`echo ${b64} | base64 -d > /tmp/cf-restart.sh && chmod +x /tmp/cf-restart.sh && /tmp/cf-restart.sh`));

console.log("\n# waiting 15s for HTTP/2 handshake...");
await new Promise((res) => setTimeout(res, 15000));

console.log("\n=== cloudflared log (last 40 lines) ===");
console.log(await run("tail -n 40 /workspace/.logs/cloudflared.log"));

console.log("\n=== /proc scan for cloudflared ===");
console.log(await run("for p in /proc/[0-9]*; do c=$(cat $p/comm 2>/dev/null); if [ \"$c\" = cloudflared ] || [ \"$c\" = python ] || [ \"$c\" = python3 ]; then echo \"$(basename $p) $c\"; fi; done"));

console.log("\n=== shim healthz via localhost ===");
console.log(await run("curl -fsS http://127.0.0.1:4242/healthz 2>&1 || echo 'shim not responding'"));
