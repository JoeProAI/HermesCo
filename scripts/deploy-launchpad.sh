#!/usr/bin/env bash
# One-shot deploy for the launchpad agents. Run from WSL:
#   bash scripts/deploy-launchpad.sh
#
# Builds + pushes BOTH agent images and pushes the repo, so the provisioner
# (Vercel) and Docker Hub are both current. After this finishes: destroy any
# old apps in Fly, then Launch both agents from /agents to get fresh machines
# that carry the new image (idle watchdog, scale-to-zero, etc.).
set -euo pipefail

HERMES_TAG="joeproai/launchpad-hermes:0.14.17-fly"
OPENCLAW_TAG="joeproai/launchpad-openclaw:2026.6.5-fly13"

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "repo: $ROOT"

echo ""
echo "==> [1/3] Hermes image -> $HERMES_TAG"
docker build -f launchpad-images/hermes/Dockerfile.fly -t "$HERMES_TAG" launchpad-images/hermes
docker push "$HERMES_TAG"

echo ""
echo "==> [2/3] OpenClaw image -> $OPENCLAW_TAG"
docker build -f launchpad-images/openclaw/Dockerfile.fly -t "$OPENCLAW_TAG" launchpad-images/openclaw
docker push "$OPENCLAW_TAG"

echo ""
echo "==> [3/3] git push (deploys the new provisioner: image tags, min:0, auto-heal)"
git push origin main

echo ""
echo "DONE."
echo "Next, by hand:"
echo "  1) fly apps list                         # see what's left"
echo "  2) fly apps destroy <old-app> --yes      # remove any old machines"
echo "  3) Launch both agents from /agents        # fresh machines, new image"
echo "  4) close all tabs, wait ~15m, then: fly machine list -a <new-app>  -> should read 'stopped'"
