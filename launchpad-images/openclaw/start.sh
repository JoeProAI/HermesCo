#!/usr/bin/env bash
# Launchpad OpenClaw startup
set -euo pipefail

mkdir -p "${OPENCLAW_HOME}" /workspace/.logs

# Cloudflare tunnel — connects this sandbox to https://openclaw-<uid8>.clawd.run.
if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  cloudflared tunnel --no-autoupdate run --token "${CF_TUNNEL_TOKEN}" \
    >> /workspace/.logs/cloudflared.log 2>&1 &
  echo "[launchpad-openclaw] cloudflared started (public: ${LAUNCHPAD_PUBLIC_URL:-unknown})"
else
  echo "[launchpad-openclaw] CF_TUNNEL_TOKEN not set — running without tunnel" >&2
fi

PROVIDER="${LAUNCHPAD_LLM_PROVIDER:-openrouter}"
KEY="${LAUNCHPAD_LLM_KEY:-}"

# Build openclaw.json from template + env
python3 - <<'PY'
import json, os
tpl_path = "/opt/launchpad/openclaw.template.json"
out_path = os.path.join(os.environ["OPENCLAW_HOME"], "openclaw.json")
with open(tpl_path) as f:
    cfg = json.load(f)

cfg.setdefault("env", {})
cfg["env"]["OPENROUTER_API_KEY"] = os.environ.get("LAUNCHPAD_LLM_KEY", "")
cfg["env"]["ANTHROPIC_API_KEY"] = os.environ.get("ANTHROPIC_API_KEY", "")
cfg["env"]["OPENAI_API_KEY"] = os.environ.get("OPENAI_API_KEY", "")
cfg["env"]["XAI_API_KEY"] = os.environ.get("XAI_API_KEY", "")
cfg["env"]["LAUNCHPAD_USER_ID"] = os.environ.get("LAUNCHPAD_USER_ID", "")

cfg.setdefault("gateway", {})["port"] = 42069
cfg["gateway"]["bind"] = "0.0.0.0"

with open(out_path, "w") as f:
    json.dump(cfg, f, indent=2)
print(f"[launchpad-openclaw] wrote {out_path}")
PY

cd /workspace
# Foreground: gateway
exec openclaw gateway start --config "${OPENCLAW_HOME}/openclaw.json" \
  2>&1 | tee /workspace/.logs/openclaw.log
