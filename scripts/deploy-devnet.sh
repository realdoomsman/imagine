#!/usr/bin/env bash
#
# Deploy VISE to devnet and initialise its config.
#
# Everything here is verified: the same program binary has been driven through
# the full launch/lock/trade/claim path against the real pump.fun programs on a
# local validator. This script is the last mile.
#
# Requires ~5 SOL in the deploy wallet. The public faucet rate-limits hard;
# https://faucet.solana.com works with a GitHub sign-in.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROGRAM_ID=VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb
NODE="${NODE:-/opt/node/bin/node}"
WALLET="${WALLET:-$HOME/.config/solana/id.json}"
NEEDED=5

cd "$ROOT"

BALANCE=$(solana balance -u devnet -k "$WALLET" | awk '{print $1}')
echo "deploy wallet $(solana address -k "$WALLET") holds ${BALANCE} SOL"
if ! awk -v b="$BALANCE" -v n="$NEEDED" 'BEGIN{exit !(b>=n)}'; then
  echo "need at least ${NEEDED} SOL to deploy a ~470KB program; top up and re-run" >&2
  exit 1
fi

echo "==> building"
anchor build

echo "==> deploying"
anchor deploy --provider.cluster devnet --provider.wallet "$WALLET"

echo "==> confirming the program is live"
solana program show "$PROGRAM_ID" -u devnet

echo "==> initialising config (upgrade authority signs)"
cd apps/api
"$NODE" --env-file=.env.devnet scripts/init-config.ts "$WALLET"

echo
echo "deployed. Point the API at devnet and redeploy the web image:"
echo "  railway variables --service api --set RPC_URL=https://api.devnet.solana.com"
