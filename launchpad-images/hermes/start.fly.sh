#!/usr/bin/env bash
# Launchpad Hermes startup — Fly.io edition.
#
# Runs as the container's main process under tini. The Fly Machines API
# spawns one of these per launchpad user. Fly's edge proxy terminates TLS
# and forwards (with WebSocket support) to internal port 8080.
set -euo pipefail

mkdir -p "${HERMES_HOME}" /workspace/.logs

# --- Workspace sandbox instructions --------------------------------------
# Seed AGENTS.md so the agent knows how to use the clawd.run workspace
# sandbox (files + public preview URLs). Seed once: the agent may extend
# this file as memory and a per-boot overwrite would wipe that.
if [ ! -f /workspace/AGENTS.md ] && [ -n "${CLAWD_SANDBOX_API:-}" ]; then
cat > /workspace/AGENTS.md <<'EOF'
# clawd.run workspace sandbox

You have a persistent build workspace for the user. When asked to scaffold,
build, or serve anything, use this HTTP API (curl is available). The base URL
and credentials live in environment variables, so always reference them as
shell variables instead of hardcoding values:

Base URL: $CLAWD_SANDBOX_API
Auth headers (required on every request):
  x-launchpad-user: $LAUNCHPAD_USER_ID
  x-launchpad-token: $LAUNCHPAD_GATEWAY_TOKEN

Example:
  curl -s -X PUT "$CLAWD_SANDBOX_API/sandbox/files" \
    -H "x-launchpad-user: $LAUNCHPAD_USER_ID" \
    -H "x-launchpad-token: $LAUNCHPAD_GATEWAY_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"path":"/home/daytona/workspace/index.html","content":"<h1>hi</h1>"}'

Endpoints:
- GET  /sandbox                  -> sandbox status (created lazily on first use)
- GET  /sandbox/tree             -> file listing
- PUT  /sandbox/files            -> write a file. JSON body: {"path": "...", "content": "..."}
- GET  /sandbox/files?path=...   -> read a file
- POST /sandbox/exec             -> run a command. JSON body: {"command": "...", "background": true|false}
- GET  /preview?port=N           -> public preview URL for a dev server on port N

Rules:
- File paths must be ABSOLUTE under /home/daytona/workspace (relative paths are rejected).
- Start dev servers with "background": true, then give the user the /preview URL.
- The sandbox auto-stops after 15 minutes idle. Files persist, but processes do
  not: restart the dev server via /sandbox/exec if the preview stops responding.
- The user sees these files and the preview in the Workspace panel on clawd.run/agents.
EOF
fi

# --- Hermes provider config ---------------------------------------------
PROVIDER="${LAUNCHPAD_LLM_PROVIDER:-openrouter}"
KEY="${LAUNCHPAD_LLM_KEY:-}"
# Default to Haiku 4.5 — ~3-5x cheaper than Sonnet 4.6 ($1/$5 vs $3/$15 per M
# tokens) with quality that's still good for the dashboard chat tab.
# Users with their own Sonnet/Opus key override via BYOK (HERMES_MODEL env).
MODEL_DEFAULT="x-ai/grok-4.3"

if [ -z "${KEY}" ]; then
  echo "[launchpad-hermes] no LLM key in env, the dashboard will run but cannot reach a model" >&2
fi

# Hermes reads ${HERMES_HOME}/.env on launch
cat > "${HERMES_HOME}/.env" <<EOF
HERMES_PROVIDER=${PROVIDER}
OPENROUTER_API_KEY=${KEY}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
HERMES_MODEL=${HERMES_MODEL:-${MODEL_DEFAULT}}
HERMES_DASHBOARD_TUI=1
HERMES_ACCEPT_HOOKS=1
GATEWAY_ALLOW_ALL_USERS=true
DAYTONA_API_KEY=${DAYTONA_API_KEY:-}
EOF
chmod 600 "${HERMES_HOME}/.env"

# --- Hermes config.yaml -------------------------------------------------
# Model + provider must be in config.yaml — Hermes ignores HERMES_MODEL env
# var for the primary model. Without an explicit model here Hermes defaults
# to claude-opus-4.7 which the pooled OpenRouter key cannot afford → silent
# 402 → "can't chat" UX.
#
# Terminal backend: canonical Hermes pattern is the dashboard runs here
# (Fly, where WS works) and shell commands execute in an ephemeral Daytona
# workspace (HTTP-only, fine). container_persistent=true stops/resumes the
# Daytona workspace between sessions, cutting Daytona credit burn ~10x.
HERMES_MODEL_RESOLVED="${HERMES_MODEL:-${MODEL_DEFAULT}}"
# Only seed the default config on first boot. After the user signs into a
# provider (the OAuth flow rewrites config.yaml), preserve their choice so
# scale-to-zero stop/start does not reset them to the pooled default. The
# config lives on the persistent volume at ${HERMES_HOME}, so it survives.
if [ ! -f "${HERMES_HOME}/config.yaml" ]; then
cat > "${HERMES_HOME}/config.yaml" <<EOF
provider: ${PROVIDER}
model: ${HERMES_MODEL_RESOLVED}
base_url: https://openrouter.ai/api/v1
terminal:
  backend: local
# Disable the remote model-catalog manifest so the OpenRouter model picker
# can't re-expand past the platform-allowed models. With it off, Hermes falls
# back to the in-image OPENROUTER_MODELS list, which the Dockerfile pins to
# grok-4.3 + grok-4.20-multi-agent (matches the "launchpad-metered" guardrail).
model_catalog:
  enabled: false
EOF
fi

# --- Web dashboard ------------------------------------------------------
# Bind to 0.0.0.0 so Fly's proxy can reach us. --insecure tells Hermes
# we're behind a proxy doing its own auth (Fly proxy gates inbound, our
# session token authenticates dashboard ops). The ephemeral session token
# is regenerated on each restart and embedded in index.html.
#
# --skip-build uses the pre-built dist that ships in the wheel
# (hermes_cli/web_dist/), so no Node/npm at runtime.
mkdir -p "${HERMES_HOME}/logs"
# Auto-start the gateway (chat/agent runtime + cron) so the dashboard's Chat
# tab has a live backend without the user clicking "Restart Gateway". Runs in
# the background; the dashboard stays the container's main process. Self-heals
# if the gateway exits while the machine is up.
(
  sleep 8
  while true; do
    hermes gateway restart >> "${HERMES_HOME}/logs/gateway-boot.log" 2>&1 || true
    sleep 5
  done
) &

cd /workspace
# Run the dashboard in the background so the idle watchdog owns the exit code.
hermes --accept-hooks --tui dashboard \
  --host 0.0.0.0 \
  --port 8080 \
  --insecure \
  --no-open \
  --skip-build &
APP_PID=$!

# --- Idle watchdog -------------------------------------------------------
# Fly's proxy autostop does NOT reliably sleep long-lived WebSocket gateways
# (observed 15h+ uptime with no users), so the machine sleeps itself. After
# IDLE_STOP_SEC with no external (non-loopback) traffic on the gateway port we
# scale down. Preferred: ask the control plane to SUSPEND this machine (RAM
# snapshot) so the next request resumes WARM in ~0.3s with the gateway already
# bound -- vs a cold ~12s boot if we fully stopped. Fallback: if suspend is
# unavailable twice in a row, exit 0 to STOP (cold) so scale-down -- and the
# cost guarantee -- still happen (a suspended/stopped machine bills $0 compute;
# autostart wakes it on the next request). A real crash exits non-zero -> Fly
# restarts (self-heal). The Fly proxy holds a connection to the port only while
# a user session (dashboard/WS) is live, so zero = idle.
IDLE_STOP_SEC="${LAUNCHPAD_IDLE_STOP_SEC:-900}"
IDLE_BYTES="${LAUNCHPAD_IDLE_BYTES:-80000}"   # < this many bytes/min on the wire = idle
net_bytes() { awk 'NR>2{gsub(/:/," "); if($1!="lo") s+=$2} END{print s+0}' /proc/net/dev 2>/dev/null || echo 0; }  # rx only: the dashboard's outbound push chatter must not count as activity

# Ask our own server to suspend this machine. No Fly token lives in here -- the
# machine authenticates with its per-user gateway token (the same one the
# sandbox API uses) and the server holds the Fly credential. Returns 0 if the
# machine is now (or is about to be) suspended, 1 if the request was rejected.
request_suspend() {
  [ -n "${CLAWD_SANDBOX_API:-}" ] && [ -n "${FLY_APP_NAME:-}" ] && [ -n "${FLY_MACHINE_ID:-}" ] || return 1
  local t0 t1 code
  t0=$SECONDS
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 8 -m 30 -X POST \
    "${CLAWD_SANDBOX_API}/idle-suspend" \
    -H "x-launchpad-user: ${LAUNCHPAD_USER_ID:-}" \
    -H "x-launchpad-token: ${LAUNCHPAD_GATEWAY_TOKEN:-}" \
    -H 'content-type: application/json' \
    -d "{\"flyApp\":\"${FLY_APP_NAME}\",\"flyMachineId\":\"${FLY_MACHINE_ID}\"}" 2>/dev/null || true)"
  t1=$SECONDS
  # 200 -> suspend accepted. The machine can freeze mid-request and only resume
  # (warm) on the next inbound request, so a blank/000 code returned after a
  # long hang is that freeze-then-resume -- also a success. A fast 000
  # (connection refused) or any 4xx/5xx is a real failure (endpoint down).
  if [ "$code" = "200" ]; then return 0; fi
  if { [ "$code" = "000" ] || [ -z "$code" ]; } && [ "$((t1 - t0))" -ge 8 ]; then return 0; fi
  echo "[idle-watchdog] suspend request failed (code=${code:-none}, $((t1 - t0))s)" >&2
  return 1
}
idle=0
suspend_fails=0
prev_bytes="$(net_bytes)"
while true; do
  sleep 60
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "[idle-watchdog] dashboard exited; failing for restart" >&2
    exit 1
  fi
  if command -v ss >/dev/null 2>&1; then
    conns="$( set +o pipefail; ss -tnH state established "( sport = :8080 )" 2>/dev/null | grep -vE '127\.0\.0\.1|::1' | wc -l )"
  else
    conns=1
  fi
  cur_bytes="$(net_bytes)"
  delta=$((cur_bytes - prev_bytes)); if [ "$delta" -lt 0 ]; then delta=0; fi
  prev_bytes="$cur_bytes"
  # Active only when a session is connected AND real inbound traffic is flowing.
  # An open-but-idle tab (keepalives/polls under IDLE_BYTES/min) accrues idle and
  # sleeps. A dead/zero byte counter no longer pins the machine awake -- for a
  # cost-capped product we would rather sleep and cold-start than burn the cap.
  # A warm resume brings real traffic, which resets idle AND clears any stale
  # suspend-failure count (so a one-off freeze-then-resume read as a "failure"
  # never accumulates toward the stop fallback).
  if [ "${conns:-0}" -gt 0 ] && [ "$delta" -ge "$IDLE_BYTES" ]; then idle=0; suspend_fails=0; else idle=$((idle + 60)); fi
  echo "[idle-watchdog] conns=${conns} rxdelta=${delta}B idle=${idle}/${IDLE_STOP_SEC}s fails=${suspend_fails}" >&2
  if [ "$idle" -ge "$IDLE_STOP_SEC" ]; then
    echo "[idle-watchdog] idle threshold reached after ${idle}s; requesting suspend" >&2
    if request_suspend; then
      # The machine froze above and only resumes on the next request; reset the
      # window so the resumed session gets a fresh idle budget.
      suspend_fails=0
      idle=0
      prev_bytes="$(net_bytes)"
    else
      # Suspend was rejected (endpoint down / not yet deployed). Keep idle at the
      # threshold so the next ~60s tick retries and reaches the stop fallback in
      # ~1 min, instead of burning another full IDLE_STOP_SEC of compute first.
      suspend_fails=$((suspend_fails + 1))
      prev_bytes="$(net_bytes)"
      if [ "$suspend_fails" -ge 2 ]; then
        echo "[idle-watchdog] suspend unavailable x${suspend_fails}; stopping instead" >&2
        kill -TERM "$APP_PID" 2>/dev/null || true
        sleep 2
        exit 0
      fi
    fi
  fi
done
