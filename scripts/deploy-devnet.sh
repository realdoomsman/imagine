#!/usr/bin/env bash
#
# Deploy VISE to devnet and initialise its config.
#
# Everything here is verified: the same program binary has been driven through
# the full launch/lock/trade/claim path against the real pump.fun programs on a
# local validator. This script is the last mile.
#
# Devnet runs Agave 4, which rejects SBPF v0 programs, so this deploys the v3
# binary from scripts/anchor-build.sh (target/deploy/vise.so), not the v0 one
# the LiteSVM harness loads.
#
# Requires ~4.5 SOL in the deploy wallet: rent for MAX_LEN bytes of program
# data plus fees. https://faucet.solana.com gives 5 SOL with a GitHub sign-in.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/opt/node/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
PROGRAM_ID=VisecyrWrgtRg9wYhXe9ZgJ4tJBD9dPLCHoqXc54FRb
WALLET="${WALLET:-$HOME/.config/solana/id.json}"
# Room for upgrades without paying rent on double the binary (the default).
# `solana program extend` grows it later if a build outgrows this.
MAX_LEN="${MAX_LEN:-560000}"
NEEDED=4.3

cd "$ROOT"

BALANCE=$(solana balance -u devnet -k "$WALLET" | awk '{print $1}')
echo "deploy wallet $(solana address -k "$WALLET") holds ${BALANCE} SOL"
if ! awk -v b="$BALANCE" -v n="$NEEDED" 'BEGIN{exit !(b>=n)}'; then
  echo "need at least ${NEEDED} SOL; top up and re-run" >&2
  exit 1
fi

if [ "${SKIP_BUILD:-0}" != 1 ]; then
  echo "==> building (SBPF v3)"
  bash scripts/anchor-build.sh
fi
SIZE=$(stat -c %s target/deploy/vise.so)
echo "binary ${SIZE} bytes, max len ${MAX_LEN}"
if [ "$SIZE" -gt "$MAX_LEN" ]; then
  echo "binary exceeds MAX_LEN" >&2
  exit 1
fi

echo "==> deploying"
solana program deploy target/deploy/vise.so \
  --program-id target/deploy/vise-keypair.json \
  --max-len "$MAX_LEN" \
  --upgrade-authority "$WALLET" \
  -k "$WALLET" -u devnet

echo "==> confirming the program is live"
solana program show "$PROGRAM_ID" -u devnet

echo "==> initialising config (upgrade authority signs)"
cd apps/api
node --env-file=.env.devnet scripts/init-config.ts "$WALLET"

echo
echo "done. Point the API at devnet (RPC_URL=https://api.devnet.solana.com) and restart the indexer."
