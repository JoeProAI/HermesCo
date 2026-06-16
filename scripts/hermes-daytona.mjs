#!/usr/bin/env node
/**
 * Hermes on Daytona — run Hermes exactly like local, on a Daytona sandbox.
 *
 * Why: the Fly deployment ran `hermes dashboard --insecure`, which disables the
 * chat ("Chat unavailable: 1"). This runs Hermes the way it works on your
 * machine — normal dashboard, LOCAL terminal backend, no --insecure — on a
 * Daytona box, exposed via Daytona's preview URL. Uses your Daytona credits.
 *
 * Usage (from repo root, where .env.local has DAYTONA_API_KEY):
 *   node scripts/hermes-daytona.mjs
 *   node scripts/hermes-daytona.mjs --recreate   # destroy existing + make fresh
 *
 * Env used (read from .env.local automatically):
 *   DAYTONA_API_KEY              (required)
 *   DAYTONA_TARGET               (us | eu, default us)
 *   LAUNCHPAD_OPENROUTER_POOL_KEY or OPENROUTER_API_KEY  (LLM key)
 *   HERMES_MODEL                 (default anthropic/claude-haiku-4.5)
 */
import { Daytona } from "@daytonaio/sdk";
import { existsSync, readFileSync } from "node:fs";

// Load env from a file path (argv[2]) or common defaults, without dotenv.
// Pass the path explicitly when running outside the repo, e.g.:
//   node hermes-daytona.mjs /mnt/c/Projects/AI_Projects/cagent-studio/.env.local
const envCandidates = [
  process.argv.find((a, i) => i >= 2 && !a.startsWith("--")),
  ".env.local",
  ".env",
].filter(Boolean);
for (const f of envCandidates) {
  if (!existsSync(f)) continue;
  for (const raw of readFileSync(f, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
  break;
}

const TARGET = (process.env.DAYTONA_TARGET || "us").toLowerCase();
const LLM_KEY =
  process.env.LAUNCHPAD_OPENROUTER_POOL_KEY || process.env.OPENROUTER_API_KEY || "";
const MODEL = process.env.HERMES_MODEL || "anthropic/claude-haiku-4.5";
const HERMES_VERSION = process.env.HERMES_VERSION || "0.14.0"; // 0.15.x wheel is missing dashboard_auth; 0.14.0 runs
const LABEL = { app: "hermes", platform: "clawd.run", role: "dashboard" };
const RECREATE = process.argv.includes("--recreate");

const log = (...a) => console.log("[hermes-daytona]", ...a);
const die = (m) => { console.error("[hermes-daytona] FATAL:", m); process.exit(1); };

if (!process.env.DAYTONA_API_KEY) die("DAYTONA_API_KEY not set (check .env.local)");
if (!LLM_KEY) log("WARN: no OpenRouter key found — chat won't reach a model until you add one in the dashboard /env page.");

// run a shell command in the sandbox, fail loudly
async function sh(sandbox, cmd, { timeout = 120, quiet = false } = {}) {
  const r = await sandbox.process.executeCommand(cmd, undefined, undefined, timeout);
  if (!quiet) log(`$ ${cmd.length > 90 ? cmd.slice(0, 90) + "…" : cmd}  -> exit ${r.exitCode}`);
  if (r.exitCode !== 0 && !quiet) log("  output:", (r.result || "").trim().slice(0, 600));
  return r;
}

async function main() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY, target: TARGET });

  // Reuse an existing hermes sandbox unless --recreate
  let sandbox = null;
  try {
    const existing = await daytona.list(LABEL, 1, 10);
    const found = (existing.items || [])[0];
    if (found?.id) {
      if (RECREATE) {
        log(`--recreate: deleting existing sandbox ${found.id}`);
        try { await daytona.delete(await daytona.get(found.id)); } catch (e) { log("delete warn:", String(e).slice(0, 120)); }
      } else {
        log(`reusing existing sandbox ${found.id}`);
        sandbox = await daytona.get(found.id);
      }
    }
  } catch (e) { log("list warn:", String(e).slice(0, 160)); }

  if (!sandbox) {
    log("creating new Daytona sandbox (default image)…");
    sandbox = await daytona.create({
      name: `hermes-${Date.now().toString(36)}`,
      labels: LABEL,
      autoStopInterval: 0, // 0 = never auto-stop; keep the dashboard warm
      envVars: {},
    });
    log("created sandbox:", sandbox.id);
  }

  // 1. Python + Hermes (public PyPI). venv keeps it clean.
  log("installing Hermes (this takes a minute)…");
  await sh(sandbox, "python3 -m venv ~/hermes-venv 2>/dev/null; true");
  const spec = HERMES_VERSION ? `hermes-agent[web]==${HERMES_VERSION}` : "hermes-agent[web]";
  const inst = await sh(
    sandbox,
    `~/hermes-venv/bin/pip install --quiet --upgrade pip && ~/hermes-venv/bin/pip install --quiet "${spec}" "uvicorn[standard]" fastapi websockets python-multipart`,
    { timeout: 420 }
  );
  if (inst.exitCode !== 0) die("Hermes install failed — see output above");

  // Diagnostic: does the wheel ship the secure-dashboard auth module?
  const authCheck = await sh(
    sandbox,
    "ls ~/hermes-venv/lib/python*/site-packages/hermes_cli/ | grep -i dashboard_auth || echo 'NO dashboard_auth in wheel'",
    { quiet: true }
  );
  log("dashboard_auth in wheel? ->", (authCheck.result || "").trim());

  // 2. Config: provider/model + LOCAL terminal backend (the part that makes chat work)
  const envBody = [
    "HERMES_PROVIDER=openrouter",
    `OPENROUTER_API_KEY=${LLM_KEY}`,
    `HERMES_MODEL=${MODEL}`,
    "HERMES_ACCEPT_HOOKS=1",
    "HERMES_DASHBOARD_TUI=1",
    "GATEWAY_ALLOW_ALL_USERS=true",
  ].join("\n");
  const cfgBody = [
    "provider: openrouter",
    `model: ${MODEL}`,
    "base_url: https://openrouter.ai/api/v1",
    "terminal:",
    "  backend: local",
  ].join("\n");
  await sh(sandbox, `mkdir -p ~/.hermes && printf '%s\\n' ${shq(envBody)} > ~/.hermes/.env && chmod 600 ~/.hermes/.env`);
  await sh(sandbox, `printf '%s\\n' ${shq(cfgBody)} > ~/.hermes/config.yaml`);

  // 3. Start the dashboard like LOCAL: bind 127.0.0.1 (trusted -> no --insecure
  //    needed -> chat stays enabled). Expose it with a Cloudflare quick tunnel
  //    (bypasses Daytona's preview proxy, which 502s).
  log("starting Hermes dashboard on 127.0.0.1:8082 (secure, no --insecure)…");
  await sh(sandbox, "pkill -f 'hermes.*dashboard' 2>/dev/null; pkill -f cloudflared 2>/dev/null; pkill -f 'proxy.py' 2>/dev/null; sleep 1; true");
  await sh(
    sandbox,
    "cd ~ && nohup ~/hermes-venv/bin/hermes --accept-hooks --tui dashboard --host 127.0.0.1 --port 8082 --no-open --skip-build > ~/hermes.log 2>&1 & sleep 1; echo started"
  );

  // 4. Wait for Hermes to bind on localhost:8082
  let bound = false;
  for (let i = 0; i < 20; i++) {
    const c = await sh(sandbox, "curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:8082/ 2>/dev/null || echo down", { quiet: true });
    if ((c.result || "").trim().match(/^(200|3\d\d|401)$/)) { bound = true; break; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  log(bound ? "Hermes is up on 127.0.0.1:8082 (secure mode)" : "Hermes not responding on :8082 — check log below");

  const tailLog = await sh(sandbox, "tail -25 ~/hermes.log 2>/dev/null", { quiet: true });
  log("--- hermes.log (tail) ---\n" + (tailLog.result || "(empty)"));

  // 5. Mint a Daytona SSH access token. Port-forwarding the dashboard over SSH
  //    is the way Nous prescribes for remote access: it's a raw TCP tunnel, so
  //    your browser hits 127.0.0.1 same-origin -> Host check passes and the chat
  //    WebSocket authenticates. Full dashboard, full functionality.
  log("minting Daytona SSH access token (valid 60 min)…");
  let sshCmd = "";
  try {
    const ssh = await sandbox.createSshAccess(60);
    const token = (ssh && (ssh.token || ssh.sshToken)) || ssh;
    sshCmd = `ssh -L 8082:localhost:8082 ${token}@ssh.app.daytona.io`;
  } catch (e) {
    sshCmd = "FAILED to mint SSH token: " + String(e).slice(0, 200) +
      "\n  (create it from the Daytona dashboard instead: Sandboxes -> ⋮ -> Create SSH Access, then: ssh -L 8082:localhost:8082 <token>@ssh.app.daytona.io)";
  }

  console.log("\n========================================");
  console.log("Sandbox ID : " + sandbox.id);
  console.log("Model      : " + MODEL + (LLM_KEY ? "" : "  (NO LLM KEY SET)"));
  console.log("Terminal   : local (in-sandbox shell)");
  console.log("");
  console.log("STEP 1 — in a SEPARATE terminal, start the SSH tunnel and LEAVE IT RUNNING:");
  console.log("  " + sshCmd);
  console.log("");
  console.log("STEP 2 — open the full Nous dashboard in your browser:");
  console.log("  http://127.0.0.1:8082");
  console.log("");
  console.log("Chat, sessions, skills, tools — all work, because the browser is");
  console.log("same-origin with Hermes over the SSH tunnel. Compute runs on Daytona.");
  console.log("========================================");
}

// minimal single-quote shell escaping for printf payloads
function shq(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

main().catch((e) => die(e?.stack || String(e)));
