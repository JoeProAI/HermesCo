#!/bin/bash
# set-arweave-wallet.sh
# Run once after `vercel login` to set the platform Arweave wallet in Vercel.
#
# Usage:
#   vercel login
#   bash scripts/set-arweave-wallet.sh
#
# The wallet file is at: /mnt/c/Users/Joe/openclaw-workspace/arweave-platform-wallet.json
# Platform wallet address: h3TVIH855QWophLBWQi4MffvDFtHdfwS3kh0wuSm4ho
# Fund this address with AR before minting (even 0.01 AR is enough for ~66 mints).

set -e

WALLET_FILE="/mnt/c/Users/Joe/openclaw-workspace/arweave-platform-wallet.json"

if [ ! -f "$WALLET_FILE" ]; then
  echo "ERROR: Wallet file not found at $WALLET_FILE"
  exit 1
fi

WALLET_JSON=$(cat "$WALLET_FILE")
COMPACT=$(echo "$WALLET_JSON" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))")

echo "Setting ARWEAVE_WALLET_JSON in Vercel (production)..."
echo "$COMPACT" | vercel env add ARWEAVE_WALLET_JSON production --force 2>/dev/null || \
  vercel env add ARWEAVE_WALLET_JSON production < <(echo "$COMPACT")

echo ""
echo "Done. Redeploy to activate: vercel --prod"
echo ""
echo "Platform wallet address: h3TVIH855QWophLBWQi4MffvDFtHdfwS3kh0wuSm4ho"
echo "Fund with AR at: https://viewblock.io/arweave/address/h3TVIH855QWophLBWQi4MffvDFtHdfwS3kh0wuSm4ho"
