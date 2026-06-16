#!/usr/bin/env bash
# Launchpad OpenClaw startup — Fly.io edition.
# Runs the native OpenClaw Control UI (gateway) as the container main process.
# Fly's edge terminates TLS and forwards (with WebSocket upgrades) to 8080.
set -euo pipefail

export HOME=/workspace
export OPENCLAW_HOME=/workspace/.openclaw
mkdir -p "$OPENCLAW_HOME" "$OPENCLAW_HOME/.openclaw/workspace" /workspace/.logs

# --- Workspace sandbox instructions --------------------------------------
# Make sure AGENTS.md carries the clawd.run workspace sandbox section (files +
# public preview URLs). OpenClaw's gateway writes its own stock AGENTS.md on
# first boot, so a missing-file check is not enough: append the section when
# the marker is absent. Append-only (never overwrite): the agent treats
# AGENTS.md as memory and may edit it freely.
# OpenClaw resolves its agent workspace as .openclaw/workspace under
# OPENCLAW_HOME (verified against the live Control UI file panel).
AGENTS_MD="$OPENCLAW_HOME/.openclaw/workspace/AGENTS.md"
SANDBOX_MARKER="# clawd.run workspace sandbox"
if [ -n "${CLAWD_SANDBOX_API:-}" ] && ! grep -qF "$SANDBOX_MARKER" "$AGENTS_MD" 2>/dev/null; then
{ [ -s "$AGENTS_MD" ] && printf '\n'; cat <<'EOF'; } >> "$AGENTS_MD"
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

PORT="${OPENCLAW_GATEWAY_PORT:-8080}"

# The openclaw CLI can intermittently hang forever on config/model commands
# during boot. Every pre-gateway CLI call is best-effort (|| true), so cap each
# one: a hang must never block the gateway launch (nothing binds ${PORT} until
# we get there, and Fly's proxy spins on "instance refused connection").
OC_TIMEOUT="timeout -k 5 30"

# clawd.run's provisioner passes the per-user token as LAUNCHPAD_GATEWAY_TOKEN
# and builds the Open URL as .../#token=<that token>. OpenClaw's gateway reads
# OPENCLAW_GATEWAY_TOKEN. Bridge them so the dashboard token authenticates.
TOKEN="${OPENCLAW_GATEWAY_TOKEN:-${LAUNCHPAD_GATEWAY_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
export OPENCLAW_GATEWAY_TOKEN="$TOKEN"

# Public host this machine answers on (Fly sets FLY_APP_NAME).
PUBLIC_HOST="${LAUNCHPAD_PUBLIC_HOST:-${FLY_APP_NAME:-localhost}.fly.dev}"

# Gateway settings below are written into ${OPENCLAW_HOME} (on the Fly volume),
# so they persist across restarts. Re-running the openclaw CLI every boot is
# pure latency -- each call is a cold Node CLI spawn (~5-10s total on a shared
# CPU before the gateway can bind). Run them only when something that affects
# them changes: the image (FLY_IMAGE_REF -> config schema/defaults) or the
# runtime identity baked into allowedOrigins/port (PUBLIC_HOST, PORT). A fresh
# volume (first boot) has no marker, so it always runs. Without a real image
# ref to key on we can't detect an image bump, so fall back to running each boot.
GW_CFG_MARKER="${OPENCLAW_HOME}/.lp_gw_cfg"
GW_CFG_SIG="${FLY_IMAGE_REF:-}|${PUBLIC_HOST}|${PORT}"
if [ -n "${FLY_IMAGE_REF:-}" ] && [ "$(cat "${GW_CFG_MARKER}" 2>/dev/null || true)" = "${GW_CFG_SIG}" ]; then
  echo "[launchpad-openclaw] gateway config already current; skipping config set" >&2
else

# Control UI origin allowlist: the dashboard's WS/API calls come from the public
# origin; without this they're rejected (gateway.controlUi.allowedOrigins,
# required since openclaw v2026.2.26).
$OC_TIMEOUT openclaw config set gateway.controlUi.allowedOrigins \
  "[\"https://${PUBLIC_HOST}\",\"https://${FLY_APP_NAME:-localhost}.clawd.run\",\"https://clawd.run\",\"http://127.0.0.1:${PORT}\",\"http://localhost:${PORT}\"]" \
  >/workspace/.logs/config.log 2>&1 || true

# Disable the Control UI device-pairing step for hosted use. Each Fly machine
# is per-user, behind Fly TLS, and gated by the per-user token (--auth token),
# so the extra device-identity check is just friction. Token still authenticates.
$OC_TIMEOUT openclaw config set gateway.controlUi.dangerouslyDisableDeviceAuth true \
  >>/workspace/.logs/config.log 2>&1 || true

# Record the gateway port in config so local CLI commands (used below to
# approve the workspace node pairing) dial the right port instead of the
# 18789 default. The gateway itself still gets --port explicitly.
$OC_TIMEOUT openclaw config set gateway.port "${PORT}" \
  >>/workspace/.logs/config.log 2>&1 || true

# Allow the file-transfer node commands for linux nodes. OpenClaw's default
# node-command allowlist excludes file.* / dir.* on linux, so without this the
# agent's file_write / dir_list tools fail even with a paired node. Scoped to
# exactly the four file-transfer commands; the node itself only ever pairs
# from loopback inside this single-user container.
$OC_TIMEOUT openclaw config set gateway.nodes.allowCommands \
  '["dir.list","dir.fetch","file.fetch","file.write"]' \
  >>/workspace/.logs/config.log 2>&1 || true

# Silence the "Update available" banner. This gateway is pinned to the image we
# ship (users don't control the host), so the on-start update check is just
# noise. With auto-update already off (OPENCLAW_NO_AUTO_UPDATE), checkOnStart
# false makes OpenClaw's update routine early-return: no banner, no periodic
# re-check. Verified: gate is `cfg.update.checkOnStart !== false`.
$OC_TIMEOUT openclaw config set update.checkOnStart false \
  >>/workspace/.logs/config.log 2>&1 || true

printf '%s' "${GW_CFG_SIG}" > "${GW_CFG_MARKER}" 2>/dev/null || true
fi

# Pooled/sub/BYOK model key from clawd.run (OpenRouter fronts all major models,
# incl. Grok-fast). Users connect their own providers in the native dashboard.
if [ -n "${LAUNCHPAD_LLM_KEY:-}" ] && [ -z "${OPENROUTER_API_KEY:-}" ]; then
  export OPENROUTER_API_KEY="${LAUNCHPAD_LLM_KEY}"
fi

# Point the agent at OpenRouter (has our injected key, fronts all major models
# incl. Grok-fast) instead of the bundled openai/gpt-5.5 default, which has no
# key here. NB: agentDefaults.model is NOT a valid key; the command is
# "openclaw models set". Users override by signing in in the dashboard.
# Deep-search option: Grok 4.20 Multi-Agent runs 4 agents in parallel at
# reasoning=medium (16 at high/xhigh). Configure it + a "deepsearch" alias,
# then set Grok 4.3 as the cheap everyday default (last set wins).
# Seed default models only on first boot. Once the user signs into a provider
# and picks a model, that choice lives in ${OPENCLAW_HOME} (on the volume);
# re-running "models set" every boot would reset them to Grok after every
# scale-to-zero restart. The marker makes the seed idempotent.
if [ ! -f "${OPENCLAW_HOME}/.lp_seeded" ]; then
  $OC_TIMEOUT openclaw models set "openrouter/x-ai/grok-4.20-multi-agent" >>/workspace/.logs/config.log 2>&1 || true
  $OC_TIMEOUT openclaw models aliases add deepsearch "openrouter/x-ai/grok-4.20-multi-agent" >>/workspace/.logs/config.log 2>&1 || true
  $OC_TIMEOUT openclaw models set "openrouter/x-ai/grok-4.3" >>/workspace/.logs/config.log 2>&1 || true
  mkdir -p "${OPENCLAW_HOME}" && touch "${OPENCLAW_HOME}/.lp_seeded"
fi

# The gateway only loads a channel plugin when the channel config is
# "meaningful" (has settings beyond enabled/disabled — hasMeaningfulChannelConfig).
# Seed enabled + the recommended dmPolicy so the WhatsApp web login provider is
# available and Show QR works out of the box. Marker keeps user edits intact.
if [ ! -f "${OPENCLAW_HOME}/.lp_whatsapp_channel" ]; then
  if $OC_TIMEOUT openclaw config set plugins.entries.whatsapp.enabled true \
       >>/workspace/.logs/config.log 2>&1 \
     && $OC_TIMEOUT openclaw config set channels.whatsapp.enabled true \
       >>/workspace/.logs/config.log 2>&1 \
     && $OC_TIMEOUT openclaw config set channels.whatsapp.dmPolicy pairing \
       >>/workspace/.logs/config.log 2>&1; then
    touch "${OPENCLAW_HOME}/.lp_whatsapp_channel"
  fi
fi

echo "[launchpad-openclaw] public host: ${PUBLIC_HOST}"
echo "[launchpad-openclaw] dashboard:   https://${PUBLIC_HOST}/#token=${OPENCLAW_GATEWAY_TOKEN}"

cd /workspace
# Run the gateway in the background so the idle watchdog owns the exit code.
openclaw gateway \
  --bind lan \
  --port "${PORT}" \
  --auth token \
  --allow-unconfigured \
  --force &
APP_PID=$!

# --- WhatsApp channel plugin (background install) -------------------------
# The WhatsApp channel lives in an external plugin (@openclaw/whatsapp on
# ClawHub); without it the Control UI's "Show QR" fails with "web login
# provider is not available". Install it onto the volume once, in the
# background so a slow registry/npm never delays the gateway bind (the deps
# install alone can take minutes on shared CPUs). On success, SIGUSR1 asks the
# running gateway to restart in-process and pick the plugin up from disk;
# otherwise it loads on the next boot. Later boots skip via the marker.
if [ ! -f "${OPENCLAW_HOME}/.lp_whatsapp_plugin" ]; then
  (
    # No marker means any extension dir on disk is a partial install from an
    # interrupted run; the installer refuses to overwrite it, so clean it.
    # Leftover installer staging dirs must go too: plugin discovery scans them
    # and a dep-less staged copy shadows the real install with a register error.
    rm -rf "${OPENCLAW_HOME}/.openclaw/extensions/whatsapp" \
           "${OPENCLAW_HOME}/.openclaw/extensions/.openclaw-install-stage-"*
    if timeout -k 10 900 openclaw plugins install clawhub:@openclaw/whatsapp \
        >>/workspace/.logs/config.log 2>&1; then
      touch "${OPENCLAW_HOME}/.lp_whatsapp_plugin"
      rm -rf "${OPENCLAW_HOME}/.openclaw/extensions/.openclaw-install-stage-"*
      kill -USR1 "$APP_PID" 2>/dev/null || true
    else
      rm -rf "${OPENCLAW_HOME}/.openclaw/extensions/whatsapp" \
             "${OPENCLAW_HOME}/.openclaw/extensions/.openclaw-install-stage-"*
    fi
  ) &
fi

# --- Workspace node host --------------------------------------------------
# The agent's node-aware file tools (file_write, dir_list, ...) dispatch to a
# paired node; with zero nodes every call fails with "unknown node". Run a
# headless node host inside this container, paired to the local gateway. It
# needs its own identity dir (reusing the gateway/CLI identity triggers a
# role-upgrade pairing that cannot be auto-approved). The identity lives
# inside the Fly volume mount (/workspace/.openclaw) so pairing survives
# machine destroy/recreate; only the first boot needs the approve step below.
# The run loop restarts the node if it exits (e.g. gateway restart).
NODE_HOME=/workspace/.openclaw/openclaw-node
mkdir -p "$NODE_HOME"
(
  sleep 8  # let the gateway finish binding before the node dials in
  while true; do
    HOME="$NODE_HOME" OPENCLAW_HOME="$NODE_HOME/.openclaw" \
      openclaw node run --host 127.0.0.1 --port "${PORT}" --display-name workspace \
      >>/workspace/.logs/node-host.log 2>&1 || true
    sleep 5
  done
) &

# First-boot pairing approval: the node's pairing request (with its full
# caps/commands) lands in nodes/pending.json; approve it from the gateway-side
# CLI. No-op on later boots (node reconnects with its saved pairing token).
(
  PENDING="$OPENCLAW_HOME/.openclaw/nodes/pending.json"
  for _ in $(seq 1 24); do
    sleep 5
    [ -s "$PENDING" ] || continue
    RIDS="$(node -e 'try{const d=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(Object.keys(d).join("\n"))}catch{}' "$PENDING")"
    [ -n "$RIDS" ] || continue
    for RID in $RIDS; do
      $OC_TIMEOUT openclaw nodes approve "$RID" >>/workspace/.logs/node-host.log 2>&1 || true
    done
  done
) &

# --- Idle watchdog (rationale: see Hermes start.fly.sh) -----------------
# Fly's proxy autostop does not reliably sleep WS gateways, so the machine
# scales itself down after IDLE_STOP_SEC with no external traffic. Preferred:
# ask the control plane to SUSPEND this machine (RAM snapshot) so the next
# request resumes WARM in ~0.3s with the gateway already bound, vs a cold ~12s
# boot. Fallback: if suspend is unavailable twice in a row, exit 0 to STOP
# (cold) so scale-down -- and the cost guarantee -- still happen; autostart
# wakes it on the next request. No Fly token lives in this machine: it
# authenticates to our server with its own per-user gateway token.
IDLE_STOP_SEC="${LAUNCHPAD_IDLE_STOP_SEC:-900}"
IDLE_BYTES="${LAUNCHPAD_IDLE_BYTES:-80000}"   # < this many bytes/min on the wire = idle
net_bytes() { awk 'NR>2{gsub(/:/," "); if($1!="lo") s+=$2} END{print s+0}' /proc/net/dev 2>/dev/null || echo 0; }  # rx only: the dashboard's outbound push chatter must not count as activity

# See Hermes start.fly.sh for the full rationale on freeze-then-resume codes.
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
    echo "[idle-watchdog] gateway exited; failing for restart" >&2
    exit 1
  fi
  if command -v ss >/dev/null 2>&1; then
    conns="$( set +o pipefail; ss -tnH state established "( sport = :${PORT} )" 2>/dev/null | grep -vE '127\.0\.0\.1|::1' | wc -l )"
  else
    conns=1
  fi
  cur_bytes="$(net_bytes)"
  delta=$((cur_bytes - prev_bytes)); if [ "$delta" -lt 0 ]; then delta=0; fi
  prev_bytes="$cur_bytes"
  # Active only when a session is connected AND real inbound traffic is flowing.
  # An open-but-idle tab (keepalives/polls under IDLE_BYTES/min) accrues idle and
  # sleeps. A warm resume brings real traffic, which resets idle AND clears any
  # stale suspend-failure count (a one-off freeze-then-resume must not
  # accumulate toward the stop fallback).
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
