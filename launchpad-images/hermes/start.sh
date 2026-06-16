#!/usr/bin/env bash
# Launchpad Hermes startup
# Run by the Launchpad provisioner after the Daytona sandbox boots (Daytona
# ignores the image CMD; provisionWorkspace executes this script via the SDK).
set -euo pipefail

mkdir -p "${HERMES_HOME}" /workspace/.logs

# --- Cloudflare tunnel ---------------------------------------------------
# Daytona blocks UDP outbound (QUIC), so force --protocol http2. Without this
# cloudflared spins forever on "Failed to dial a quic connection" and the
# user gets Cloudflare error 1033.
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  setsid nohup cloudflared tunnel --no-autoupdate --protocol http2 run \
    --token "${CF_TUNNEL_TOKEN}" \
    >> /workspace/.logs/cloudflared.log 2>&1 < /dev/null &
  disown 2>/dev/null || true
  echo "[launchpad-hermes] cloudflared started (public: ${LAUNCHPAD_PUBLIC_URL:-unknown})"
else
  echo "[launchpad-hermes] CF_TUNNEL_TOKEN not set, running without tunnel" >&2
fi

# --- Hermes provider config ---------------------------------------------
PROVIDER="${LAUNCHPAD_LLM_PROVIDER:-openrouter}"
KEY="${LAUNCHPAD_LLM_KEY:-}"
# Default to Haiku 4.5 — ~3-5x cheaper than Sonnet 4.6 ($1/$5 vs $3/$15 per M
# tokens) with quality that's still good enough for the dashboard chat tab.
# Users with their own Sonnet/Opus key can override via BYOK (HERMES_MODEL env).
MODEL_DEFAULT="anthropic/claude-haiku-4.5"

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
EOF
chmod 600 "${HERMES_HOME}/.env"

# --- Web dashboard (real chat UI) ---------------------------------------
# `hermes dashboard --tui` exposes:
#   - /                   the dashboard SPA (config, sessions, skills)
#   - /chat tab           browser PTY -> hermes --tui via WebSocket
#   - /api/*              dashboard JSON API
# `--skip-build` uses the pre-built dist that ships in the wheel
# (hermes_cli/web_dist/), so no Node/npm at runtime.
# Bind to 127.0.0.1 only; cloudflared in this same container is the only
# thing that hits it.
cd /workspace
# --accept-hooks and --tui are global flags (before subcommand)
exec hermes --accept-hooks --tui dashboard \
  --host 127.0.0.1 \
  --port 4242 \
  --no-open \
  --skip-build
