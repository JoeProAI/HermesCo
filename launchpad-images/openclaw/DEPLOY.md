# Launchpad OpenClaw on Fly — deploy

The native OpenClaw Control UI (the gateway's web dashboard) hosted on Fly, where
WebSockets work. Supersedes the Daytona/cloudflared `Dockerfile` + `start.sh` in
this folder (those used a QUIC tunnel Daytona blocks, called `openclaw gateway
start --config` which the current CLI doesn't use, and predate the
`gateway.controlUi.allowedOrigins` requirement that silently breaks the UI).

## What the image runs (verified against openclaw 2026.5.28)
`openclaw gateway --bind lan --port 8080 --auth token --allow-unconfigured --force`
- binds 0.0.0.0:8080; serves the Control UI (`/`, `/dashboard`) + the WS gateway
- gateway token bridged from clawd.run's `LAUNCHPAD_GATEWAY_TOKEN`
- `gateway.controlUi.allowedOrigins` seeded with this machine's `*.fly.dev` host
  (+ clawd.run) so the dashboard's cross-origin WS/API calls are accepted

## Build + push (Docker Hub: joeproai)
    cd launchpad-images/openclaw
    docker build -f Dockerfile.fly -t joeproai/launchpad-openclaw:2026.5.28-fly .
    docker push joeproai/launchpad-openclaw:2026.5.28-fly

## Wire into clawd.run
`src/lib/launchpad/fly.ts` already defaults to this tag. Redeploy clawd.run, or
set `LAUNCHPAD_OPENCLAW_IMAGE=joeproai/launchpad-openclaw:2026.5.28-fly` in Vercel
Production env.

## Roll the running machine
The provisioner rolls the machine when the image tag changes. After clawd.run is
redeployed, re-launch OpenClaw from /agents (or hit /api/launchpad/provision) to
move the existing machine onto the new image.

## Verify
Open OpenClaw → the `…fly.dev/#token=…` URL should load the OpenClaw Control
dashboard with a live WS connection (not the old 8s hang). `fly logs -a lp-<app>`
should show `[gateway] ready` and the `dashboard: https://…/#token=…` line.
