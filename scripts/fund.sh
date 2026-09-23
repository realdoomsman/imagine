#!/usr/bin/env bash
# Airdrop localnet SOL to an address: scripts/fund.sh <pubkey> [sol]
set -euo pipefail
export PATH="/opt/node/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
solana airdrop "${2:-5}" "$1" -u http://127.0.0.1:8899
