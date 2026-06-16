# Launchpad Daytona Images

Prebuilt container images that the Launchpad provisioner spins up on demand.

| Image | Purpose | Exposed port |
|---|---|---|
| `joeproai/launchpad-hermes:latest` | One-click Hermes agent (v0.11.0+) | 4242 |
| `joeproai/launchpad-openclaw:latest` | One-click OpenClaw gateway | 8080 |

Both images:
- Read every secret from env vars at startup (no baked-in keys).
- Resolve LLM provider from `LAUNCHPAD_LLM_KEY` + `LAUNCHPAD_LLM_PROVIDER`. If BYOK is supplied, it overrides the pooled key.
- Auto-shutdown when idle for 30 minutes (Daytona `autoStopInterval=30`).
- Write logs to `/workspace/.logs/` so users can pull them from the dashboard.

## Build and publish

```bash
# Hermes
docker build -t joeproai/launchpad-hermes:latest launchpad-images/hermes
docker push joeproai/launchpad-hermes:latest

# OpenClaw
docker build -t joeproai/launchpad-openclaw:latest launchpad-images/openclaw
docker push joeproai/launchpad-openclaw:latest
```

Then set in Vercel env:
- `LAUNCHPAD_HERMES_IMAGE=joeproai/launchpad-hermes:latest`
- `LAUNCHPAD_OPENCLAW_IMAGE=joeproai/launchpad-openclaw:latest`

## Smoke test against Daytona

```bash
# from repo root
DAYTONA_API_KEY=... node scripts/launchpad-smoke.mjs
```

The smoke script provisions one Hermes + one OpenClaw, checks the preview URL responds
with 200, then stops + deletes both. Used to validate Phase 0 before flipping the
public flag.
