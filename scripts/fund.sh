#!/usr/bin/env bash
# Airdrop SOL on the mainnet fork to an address: scripts/fund.sh <pubkey> [sol]
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana airdrop "${2:-5}" "$1" -u "${RPC_URL:-http://127.0.0.1:8999}"
